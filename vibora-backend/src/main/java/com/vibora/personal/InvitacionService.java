package com.vibora.personal;

import com.vibora.auth.AutorizacionClub;
import com.vibora.club.Club;
import com.vibora.club.ClubRepository;
import com.vibora.common.exception.ConflictoException;
import com.vibora.common.exception.LimiteExcedidoException;
import com.vibora.common.exception.RecursoNoEncontradoException;
import com.vibora.notificacion.NotificacionService;
import com.vibora.notificacion.TextosAviso;
import com.vibora.notificacion.TipoNotificacion;
import com.vibora.personal.InvitacionDtos.InvitacionAceptadaResponse;
import com.vibora.personal.InvitacionDtos.InvitacionMiaResponse;
import com.vibora.personal.InvitacionDtos.InvitacionRequest;
import com.vibora.personal.InvitacionDtos.InvitacionResponse;
import com.vibora.personal.InvitacionDtos.MensajeResponse;
import com.vibora.usuario.BloqueoUsuario;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Invitaciones del personal: el administrador del club invita a un CORREO y la persona acepta o rechaza.
 * <p>
 * <b>Sin enumeracion de cuentas.</b> Invitar responde SIEMPRE igual (202 y el mismo cuerpo) tanto si el correo esta
 * registrado y libre, como si ya esta en otro club, ya es personal de ESTE club o no esta registrado: lo unico que
 * cambia es si se crea fila y aviso, y eso no se ve desde fuera. Los unicos errores visibles son 400 (datos), 403/404
 * (club y permisos) y 429 (topes).
 * <p>
 * <b>Orden de bloqueos</b> (ver tambien README): invitar toma el bloqueo consultivo del CLUB y despues, si el correo es de
 * un usuario, su fila (FOR UPDATE) y despues las filas de invitacion; aceptar toma usuario -> invitacion; rechazar y cancelar solo la invitacion. Ninguna toma un usuario DESPUES de una invitacion, y
 * ninguna espera por pista, reserva o incidencia con una fila de usuario/invitacion ya tomada que otro flujo necesite al
 * reves: no hay ciclos. El bloqueo del club es consultivo (no una fila): una fila de club con FOR UPDATE chocaria con
 * el FOR KEY SHARE que toma quien cambia usuario.club_id al aceptar y formaria un ciclo con la fila del usuario.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class InvitacionService {

	/** Espacio de nombres del bloqueo consultivo por club ("INVI"). */
	private static final int ESPACIO_BLOQUEO = 0x494E5649;
	private static final int LIMITE_LISTADO = 100;
	private static final int NOMBRE_CLUB_MAX = 60;
	private static final Duration AVISO_SIN_REPETIR = Duration.ofHours(24);
	private static final Set<Rol> ROLES_INVITABLES = Set.of(Rol.MONITOR, Rol.MANTENIMIENTO);
	static final String MENSAJE_UNIFORME = "Si el correo es válido, la persona recibirá la invitación.";

	private final InvitacionPersonalRepository invitaciones;
	private final UsuarioRepository usuarios;
	private final ClubRepository clubs;
	private final AutorizacionClub autorizacion;
	private final NotificacionService notificaciones;
	private final BloqueoUsuario bloqueo;
	private final InvitacionProperties propiedades;
	private final EntityManager em;
	private final Clock reloj;

	// ------------------------------------------------------------------------------------------------------------
	// Administrador del club
	// ------------------------------------------------------------------------------------------------------------

	@Transactional
	public MensajeResponse invitar(Long clubId, InvitacionRequest peticion) {
		Club club = buscarClub(clubId);
		Usuario admin = autorizacion.exigirAdminDe(clubId);
		if (!ROLES_INVITABLES.contains(peticion.rol())) {
			throw new IllegalArgumentException("El rol debe ser MONITOR o MANTENIMIENTO");
		}
		String email = normalizar(peticion.email()); // igual que el registro
		Instant ahora = ahora();
		bloquearClub(clubId);
		// Si el correo es de un usuario se bloquea su fila ANTES que las invitaciones (mismo orden que aceptar).
		Usuario invitado = usuarios.findByEmail(email).filter(Usuario::isActivo).orElse(null);
		if (invitado != null) {
			bloqueo.bloquear(invitado);
			if (AutorizacionClub.esPersonalDe(invitado, clubId)) {
				return uniforme(); // ya es del personal (o administrador) de ESTE club: no hay nada que crear
			}
		}
		InvitacionPersonal viva = invitaciones.pendienteBloqueada(clubId, email).orElse(null);
		if (viva != null) {
			if (viva.vigente(ahora)) {
				return uniforme(); // idempotente
			}
			caducar(viva); // vencida: se cierra aqui para poder crear la nueva (el indice unico solo admite una PENDIENTE)
			invitaciones.flush();
		}
		if (invitaciones.contarVigentes(clubId, ahora) >= propiedades.maxPendientesPorClub()) {
			throw new LimiteExcedidoException("Has alcanzado el máximo de invitaciones pendientes del club", 0);
		}
		if (invitaciones.contarCreadasDesde(clubId, ahora.minus(Duration.ofHours(24))) >= propiedades.maxInvitacionesPorClub24h()) {
			throw new LimiteExcedidoException("Has alcanzado el máximo de invitaciones por día del club", 0);
		}
		InvitacionPersonal nueva = new InvitacionPersonal();
		nueva.setClub(club);
		nueva.setEmail(email);
		nueva.setRol(peticion.rol());
		nueva.setInvitadoPor(admin);
		nueva.setCreadaEn(ahora);
		nueva.setCaducaEn(ahora.plus(Duration.ofDays(propiedades.invitacionDias())));
		invitaciones.saveAndFlush(nueva);
		if (invitado != null) {
			// sin repetir: invitar-cancelar-invitar en bucle no llena la bandeja de quien aun no ha leido el primero
			notificaciones.notificarSinRepetir(invitado, TipoNotificacion.INVITACION_RECIBIDA,
					"%s te invita a formar parte de su personal como %s. Puedes aceptar o rechazar la invitación."
							.formatted(nombreClub(club), TextosAviso.describir(peticion.rol())), AVISO_SIN_REPETIR);
		}
		return uniforme();
	}

	@Transactional(readOnly = true)
	public List<InvitacionResponse> listar(Long clubId, String estado) {
		buscarClub(clubId);
		autorizacion.exigirAdminDe(clubId);
		Instant ahora = ahora();
		PageRequest pagina = PageRequest.of(0, LIMITE_LISTADO);
		List<InvitacionPersonal> filas;
		if (estado == null || estado.isBlank()) {
			filas = invitaciones.listarDelClub(clubId, pagina);
		} else {
			EstadoInvitacion filtro = EstadoInvitacion.valueOf(estado.trim().toUpperCase(Locale.ROOT));
			filas = switch (filtro) {
				case PENDIENTE -> invitaciones.listarVigentesDelClub(clubId, ahora, pagina);
				case CADUCADA -> invitaciones.listarCaducadasDelClub(clubId, ahora, pagina);
				default -> invitaciones.listarDelClubPorEstado(clubId, filtro, pagina);
			};
		}
		return filas.stream().map(i -> InvitacionResponse.de(i, ahora)).toList();
	}

	/** 404 si no es de ESTE club; 204 si queda cancelada (o ya lo estaba); 409 si ya no esta pendiente. */
	@Transactional
	public void cancelar(Long clubId, Long invitacionId) {
		buscarClub(clubId);
		autorizacion.exigirAdminDe(clubId);
		InvitacionPersonal i = invitaciones.bloquearPorId(invitacionId)
				.filter(x -> x.getClub().getId().equals(clubId))
				.orElseThrow(() -> new RecursoNoEncontradoException("Invitación no encontrada"));
		if (i.getEstado() == EstadoInvitacion.CANCELADA) {
			return;
		}
		Instant ahora = ahora();
		if (!i.vigente(ahora)) {
			throw new ConflictoException(i.getEstado() == EstadoInvitacion.PENDIENTE || i.getEstado() == EstadoInvitacion.CADUCADA
					? "La invitación ha caducado" : "La invitación ya no está pendiente");
		}
		i.setEstado(EstadoInvitacion.CANCELADA);
		i.setResueltaEn(ahora);
	}

	// ------------------------------------------------------------------------------------------------------------
	// La persona invitada (su identidad es el correo de su fila en la BD, nunca algo que venga en el token)
	// ------------------------------------------------------------------------------------------------------------

	@Transactional(readOnly = true)
	public List<InvitacionMiaResponse> mias() {
		Usuario yo = autorizacion.usuarioActual();
		if (yo.getRol() != Rol.JUGADOR || yo.getClub() != null) {
			return List.of(); // ya pertenece a un club: no puede aceptar nada, asi que no se le muestra nada
		}
		return invitaciones.listarVigentesDe(yo.getEmail(), ahora()).stream().map(InvitacionMiaResponse::de).toList();
	}

	@Transactional
	public InvitacionAceptadaResponse aceptar(Long invitacionId) {
		Usuario yo = autorizacion.usuarioActual();
		// IMPRESCINDIBLE: Usuario no tiene @Version e Hibernate escribe la fila entera. Sin este bloqueo (y la relectura que
		// hace) se decidiria sobre un usuario viejo y se pisaria el rol/club que acaba de dejar ClubService.crear (queda
		// un club sin administrador) o salir/quitar.
		bloqueo.bloquear(yo); // 1) usuario...
		InvitacionPersonal i = propia(invitacionId, yo); // 2) ...despues la invitacion
		Instant ahora = ahora();
		exigirVigente(i, ahora);
		// todo se decide DESPUES de los bloqueos: otra aceptacion simultanea (de esta u otra invitacion) ya termino
		if (yo.getRol() != Rol.JUGADOR || yo.getClub() != null) {
			throw new ConflictoException("Ya perteneces a un club");
		}
		Club club = i.getClub();
		yo.setRol(i.getRol());
		yo.setClub(club);
		usuarios.saveAndFlush(yo);
		i.setEstado(EstadoInvitacion.ACEPTADA);
		i.setResueltaEn(ahora);
		i.setUsuario(yo);
		// Las invitaciones PENDIENTES de otros clubes NO se tocan: cancelarlas haria ver al otro administrador una
		// cancelacion que no hizo y le revelaria que el correo esta registrado y acaba de unirse a otro club. Siguen
		// pendientes hasta caducar; aceptarlas despues da 409 "Ya perteneces a un club".
		avisarAdministradores(club, TipoNotificacion.INVITACION_ACEPTADA, "%s ha aceptado la invitación y ahora es %s de %s"
				.formatted(yo.nombreCompleto(), TextosAviso.describir(i.getRol()), nombreClub(club)));
		// OJO con el token: el rol viaja en el JWT y el que ya tiene sigue diciendo JUGADOR hasta que expire o vuelva a
		// iniciar sesion (igual que al crear un club). Los permisos de club se leen SIEMPRE de la BD, asi que no hay
		// agujero; el cliente debe pedir un login nuevo para que su sesion lo refleje.
		return new InvitacionAceptadaResponse(true, club.getNombre(), i.getRol());
	}

	@Transactional
	public void rechazar(Long invitacionId) {
		Usuario yo = autorizacion.usuarioActual();
		InvitacionPersonal i = propia(invitacionId, yo);
		Instant ahora = ahora();
		exigirVigente(i, ahora);
		i.setEstado(EstadoInvitacion.RECHAZADA);
		i.setResueltaEn(ahora);
		i.setUsuario(yo);
		avisarAdministradores(i.getClub(), TipoNotificacion.INVITACION_RECHAZADA,
				"%s ha rechazado la invitación para ser %s de %s".formatted(yo.nombreCompleto(),
						TextosAviso.describir(i.getRol()), nombreClub(i.getClub())));
	}

	// ------------------------------------------------------------------------------------------------------------
	// Registro y caducidad
	// ------------------------------------------------------------------------------------------------------------

	/**
	 * Aviso unico al registrarse una persona con invitaciones vigentes ya dirigidas a su correo (no cambia el registro).
	 * REQUIRES_NEW y tras el commit del registro: es un extra, asi que su fallo no puede deshacer ni marcar como
	 * solo-rollback la transaccion del registro (JPA no admite puntos de guardado aqui y un REQUIRED la envenenaria aunque
	 * quien llama capture la excepcion).
	 */
	@Transactional(propagation = Propagation.REQUIRES_NEW)
	public void avisarInvitacionesPrevias(Usuario nuevo) {
		long n = invitaciones.contarVigentesDe(nuevo.getEmail(), ahora());
		if (n > 0) {
			notificaciones.notificar(nuevo, TipoNotificacion.INVITACION_RECIBIDA, n == 1
					? "Tienes 1 invitación pendiente para formar parte del personal de un club"
					: "Tienes %d invitaciones pendientes para formar parte del personal de un club".formatted(n), null);
		}
	}

	/** Cada dia a las 03:45 (zona del club); el cron se cambia con vibora.personal.caducidad-cron. */
	@Scheduled(cron = "${vibora.personal.caducidad-cron:0 45 3 * * *}", zone = "${vibora.zona-horaria}")
	public void barridoProgramado() {
		caducarVencidas();
	}

	/** Marca CADUCADA las pendientes vencidas, por lotes (cada uno su transaccion). Devuelve cuantas marco. */
	public int caducarVencidas() {
		Instant ahora = ahora();
		int lote = Math.max(1, propiedades.lote());
		int total = 0;
		int marcadas;
		do {
			marcadas = invitaciones.caducarLote(ahora, lote);
			total += marcadas;
		} while (marcadas == lote);
		log.info("Barrido de invitaciones: {} caducadas", total);
		return total;
	}

	// ------------------------------------------------------------------------------------------------------------

	/** Invitacion dirigida a MI correo; cualquier otra (o inexistente) es 404 para no revelar que existe. */
	private InvitacionPersonal propia(Long id, Usuario yo) {
		return invitaciones.bloquearPorId(id).filter(x -> x.getEmail().equals(yo.getEmail()))
				.orElseThrow(() -> new RecursoNoEncontradoException("Invitación no encontrada"));
	}

	private static void exigirVigente(InvitacionPersonal i, Instant ahora) {
		if (i.getEstado() == EstadoInvitacion.CADUCADA || (i.getEstado() == EstadoInvitacion.PENDIENTE && !i.vigente(ahora))) {
			throw new ConflictoException("La invitación ha caducado");
		}
		if (i.getEstado() != EstadoInvitacion.PENDIENTE) {
			throw new ConflictoException("La invitación ya no está disponible");
		}
	}

	private void caducar(InvitacionPersonal i) {
		i.setEstado(EstadoInvitacion.CADUCADA);
		i.setResueltaEn(i.getCaducaEn());
	}

	private void avisarAdministradores(Club club, TipoNotificacion tipo, String mensaje) {
		for (Usuario admin : usuarios.findByClubIdAndRol(club.getId(), Rol.ADMIN_CLUB)) {
			notificaciones.notificar(admin, tipo, mensaje, null);
		}
	}

	/** Serializa las invitaciones de UN club hasta el final de la transaccion (cuentas y topes exactos). */
	private void bloquearClub(Long clubId) {
		em.createNativeQuery("select 1 from (select pg_advisory_xact_lock(:espacio, :club)) t")
				.setParameter("espacio", ESPACIO_BLOQUEO).setParameter("club", clubId.intValue()).getSingleResult();
	}

	private static String nombreClub(Club club) {
		String nombre = club.getNombre();
		return TextosAviso.abreviar(nombre, NOMBRE_CLUB_MAX);
	}

	private static String normalizar(String email) {
		return email.trim().toLowerCase(Locale.ROOT);
	}

	private static MensajeResponse uniforme() {
		return new MensajeResponse(MENSAJE_UNIFORME);
	}

	private Club buscarClub(Long clubId) {
		return clubs.findById(clubId).orElseThrow(() -> new RecursoNoEncontradoException("Club no encontrado"));
	}

	private Instant ahora() {
		return reloj.instant().truncatedTo(ChronoUnit.MICROS);
	}
}
