package com.vibora.incidencia;

import com.vibora.almacen.AlmacenFicheros;
import com.vibora.almacen.AlmacenProperties;
import com.vibora.common.exception.LimiteExcedidoException;
import com.vibora.usuario.BloqueoUsuario;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Duration;
import com.vibora.almacen.FicheroNoEncontradoException;
import com.vibora.auth.AutorizacionClub;
import com.vibora.common.exception.ConflictoException;
import com.vibora.common.exception.RecursoNoEncontradoException;
import com.vibora.incidencia.ValidadorImagen.Imagen;
import com.vibora.usuario.Usuario;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

/**
 * Fotos de las incidencias. Quien puede verlas es quien ve la incidencia (reportero, persona asignada y
 * administrador; el resto, 404). Subir: cualquiera de ellos; borrar: quien la subio o el administrador. Ni subir ni
 * borrar en estados terminales (409).
 * <p>
 * Concurrencia: el limite de fotos por incidencia es "contar y luego insertar", con la carrera de siempre. Se
 * serializa bloqueando la fila de la incidencia (SELECT ... FOR UPDATE, PESSIMISTIC_WRITE) ANTES de contar: la
 * segunda peticion espera, y al entrar (READ COMMITTED) ya ve lo que confirmo la primera. Esa misma fila serializa los
 * borrados. El bloqueo no incrementa @Version, asi que no interfiere con los cambios de estado (optimistas).
 * <p>
 * Coherencia fila/fichero (la BD y el disco no comparten transaccion): al subir se inserta la fila, se escribe el
 * fichero (atomico) y, si la transaccion NO llega a confirmarse, un callback posterior borra el fichero huerfano; si
 * la escritura falla, la excepcion deshace la fila. Al borrar, la fila se elimina en la transaccion y el fichero
 * DESPUES de confirmar (si se borrara antes y la transaccion fallara, quedaria una fila sin fichero; asi, lo peor
 * que puede pasar es un fichero huerfano, que se registra en el log).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FotoService {

	static final int MAXIMO_FOTOS = 4;
	private static final int LONGITUD_NOMBRE = 100;
	private static final Duration VENTANA_CUOTA = Duration.ofHours(24);

	private final IncidenciaRepository incidencias;
	private final IncidenciaFotoRepository fotos;
	private final AutorizacionClub autorizacion;
	private final AlmacenFicheros almacen;
	private final HistorialIncidencia historial;
	private final EntityManager em;
	private final PlatformTransactionManager transacciones;
	private final DecodificadorImagenes decodificador;
	private final BloqueoUsuario bloqueoUsuario;
	private final AlmacenProperties propiedades;
	private final Clock reloj;

	/**
	 * Tres fases, y SOLO la tercera es una transaccion larga en el sentido de que bloquea filas:
	 * <ol>
	 * <li>transaccion corta de solo lectura: permisos y estado (404/403/409 antes de gastar nada); al terminar devuelve
	 * la conexion al pool;</li>
	 * <li>decodificar y recodificar la imagen SIN transaccion ni conexion (acotado por {@link DecodificadorImagenes});</li>
	 * <li>transaccion corta de escritura: bloqueo del usuario (cuota diaria) y de la incidencia (tope de 4 fotos),
	 * insercion de la fila, escritura del fichero y callback que lo borra si no se confirma. Orden de bloqueos: usuario
	 * -> incidencia (asignar bloquea usuario y despues escribe la incidencia; nadie pide un usuario con la incidencia
	 * ya bloqueada).</li>
	 * </ol>
	 */
	public FotoResponse subir(Long incidenciaId, String nombreOriginal, byte[] contenido) {
		TransactionTemplate lectura = new TransactionTemplate(transacciones);
		lectura.setReadOnly(true);
		lectura.executeWithoutResult(estado -> {
			Incidencia incidencia = cargar(incidenciaId);
			Usuario actor = autorizacion.usuarioActual();
			IncidenciaService.exigirVisible(actor, incidencia);
			exigirNoTerminal(incidencia);
			exigirCuota(actor.getId()); // barata: quien ya esta pasado de cuota no gasta permisos de decodificacion
		});
		Imagen imagen = decodificador.procesar(contenido); // 400 / 413 / 503, sin transaccion ni conexion
		return new TransactionTemplate(transacciones).execute(estado -> guardar(incidenciaId, nombreOriginal, imagen));
	}

	private FotoResponse guardar(Long incidenciaId, String nombreOriginal, Imagen imagen) {
		Usuario actor = bloqueoUsuario.bloquear(autorizacion.usuarioActual()); // serializa la cuota de esta persona
		Incidencia incidencia = cargar(incidenciaId);
		bloquear(incidencia);
		IncidenciaService.exigirVisible(actor, incidencia); // se vuelve a mirar con la fila ya fresca
		exigirNoTerminal(incidencia);
		exigirCuota(actor.getId()); // la comprobacion que manda: con el usuario bloqueado, sin carreras
		if (fotos.countByIncidenciaId(incidenciaId) >= MAXIMO_FOTOS) {
			throw new ConflictoException("Una incidencia admite como máximo %d fotos".formatted(MAXIMO_FOTOS));
		}

		String clave = UUID.randomUUID().toString();
		IncidenciaFoto foto = new IncidenciaFoto();
		foto.setIncidencia(incidencia);
		foto.setClaveAlmacen(clave);
		foto.setNombreOriginal(sanear(nombreOriginal));
		foto.setTipoContenido(imagen.tipoContenido());
		foto.setTamano(imagen.bytes().length);
		foto.setSubidaPor(actor);
		foto.setCreadaEn(reloj.instant().truncatedTo(ChronoUnit.MICROS));
		fotos.saveAndFlush(foto);
		borrarFicheroSiNoSeConfirma(clave); // antes de escribir: si algo falla desde aqui, no queda el fichero
		almacen.guardar(clave, imagen.bytes());
		historial.registrar(incidencia, actor, TipoEventoIncidencia.FOTO_ANADIDA, null, null, foto.getNombreOriginal());
		return FotoResponse.de(foto);
	}

	@Transactional(readOnly = true)
	public List<FotoResponse> listar(Long incidenciaId) {
		Incidencia incidencia = cargar(incidenciaId);
		IncidenciaService.exigirVisible(autorizacion.usuarioActual(), incidencia);
		return fotos.findByIncidenciaIdOrderByIdAsc(incidenciaId).stream().map(FotoResponse::de).toList();
	}

	@Transactional(readOnly = true)
	public FotoContenido descargar(Long incidenciaId, Long fotoId) {
		Incidencia incidencia = cargar(incidenciaId);
		IncidenciaService.exigirVisible(autorizacion.usuarioActual(), incidencia);
		IncidenciaFoto foto = fotos.findByIdAndIncidenciaId(fotoId, incidenciaId).orElseThrow(this::fotoNoEncontrada);
		try (InputStream flujo = almacen.abrir(foto.getClaveAlmacen())) {
			return new FotoContenido(foto.getTipoContenido(), flujo.readAllBytes());
		} catch (FicheroNoEncontradoException ex) {
			log.error("La foto {} existe en la BD pero su fichero no está en el almacén", fotoId);
			throw fotoNoEncontrada();
		} catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	@Transactional
	public void eliminar(Long incidenciaId, Long fotoId) {
		Incidencia incidencia = cargar(incidenciaId);
		Usuario actor = autorizacion.usuarioActual();
		IncidenciaService.exigirVisible(actor, incidencia);
		bloquear(incidencia); // dos borrados (o un borrado y una subida) de la misma incidencia no se cruzan
		IncidenciaFoto foto = fotos.findByIdAndIncidenciaId(fotoId, incidenciaId).orElseThrow(this::fotoNoEncontrada);
		boolean administrador = AutorizacionClub.esAdminDe(actor, incidencia.getClub().getId());
		if (!administrador && !foto.getSubidaPor().getId().equals(actor.getId())) {
			throw new AccessDeniedException("Acceso denegado");
		}
		if (!administrador) { // en CERRADA/RECHAZADA solo la administracion del club puede quitar fotos
			exigirNoTerminal(incidencia);
		}

		String clave = foto.getClaveAlmacen();
		fotos.delete(foto);
		fotos.flush();
		historial.registrar(incidencia, actor, TipoEventoIncidencia.FOTO_ELIMINADA, null, null, foto.getNombreOriginal());
		borrarFicheroTrasConfirmar(clave);
	}

	// ---- ayudas ----

	private Incidencia cargar(Long id) {
		return incidencias.buscarCompleta(id).orElseThrow(() -> new RecursoNoEncontradoException("Incidencia no encontrada"));
	}

	/** SELECT ... FOR UPDATE de la fila y relectura (una entidad ya cargada no se actualiza con una consulta). */
	private void bloquear(Incidencia incidencia) {
		em.refresh(incidencia, LockModeType.PESSIMISTIC_WRITE);
	}

	private RecursoNoEncontradoException fotoNoEncontrada() {
		return new RecursoNoEncontradoException("Foto no encontrada");
	}

	/**
	 * Cuota sobre las fotos EXISTENTES subidas en las ultimas 24 h (recuento movil de filas: subir, borrar y volver a
	 * subir libera cupo, es a proposito). 429 con Retry-After = segundos hasta que la mas antigua salga de la ventana.
	 */
	private void exigirCuota(Long usuarioId) {
		Instant ahora = reloj.instant();
		Instant desde = ahora.minus(VENTANA_CUOTA);
		if (fotos.countBySubidaPorIdAndCreadaEnAfter(usuarioId, desde) < propiedades.cuotaDiariaPorUsuario()) {
			return;
		}
		long segundos = fotos.primeraSubidaDesde(usuarioId, desde)
				.map(primera -> (Duration.between(ahora, primera.plus(VENTANA_CUOTA)).toMillis() + 999) / 1000)
				.orElse(VENTANA_CUOTA.toSeconds());
		throw new LimiteExcedidoException("Has alcanzado el límite diario de fotos",
				Math.max(1, Math.min(VENTANA_CUOTA.toSeconds(), segundos)));
	}

	private static void exigirNoTerminal(Incidencia incidencia) {
		if (incidencia.getEstado().esTerminal()) {
			throw new ConflictoException("No se pueden añadir ni quitar fotos de una incidencia %s"
					.formatted(incidencia.getEstado().etiqueta().toLowerCase()));
		}
	}

	/**
	 * Solo para mostrar: se queda con el ultimo tramo de la ruta, cambia por "_" todo lo que no sea letra, cifra,
	 * espacio, punto, guion, guion bajo o parentesis, quita los puntos iniciales y recorta a 100 caracteres.
	 */
	static String sanear(String nombre) {
		if (nombre == null) {
			return "foto";
		}
		String ultimoTramo = nombre.substring(Math.max(nombre.lastIndexOf('/'), nombre.lastIndexOf('\\')) + 1);
		String limpio = ultimoTramo.replaceAll("[^\\p{L}\\p{N} ._()\\-]", "_").strip().replaceFirst("^\\.+", "");
		if (limpio.codePointCount(0, limpio.length()) > LONGITUD_NOMBRE) {
			limpio = limpio.substring(0, limpio.offsetByCodePoints(0, LONGITUD_NOMBRE));
		}
		return limpio.isBlank() ? "foto" : limpio;
	}

	private void borrarFicheroSiNoSeConfirma(String clave) {
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCompletion(int estado) {
				if (estado != STATUS_COMMITTED) {
					borrarSinFallar(clave);
				}
			}
		});
	}

	private void borrarFicheroTrasConfirmar(String clave) {
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCommit() {
				borrarSinFallar(clave);
			}
		});
	}

	private void borrarSinFallar(String clave) {
		try {
			almacen.borrar(clave);
		} catch (RuntimeException ex) {
			log.warn("No se pudo borrar el fichero huérfano {} del almacén", clave, ex);
		}
	}
}
