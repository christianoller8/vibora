package com.vibora.incidencia;

import com.vibora.almacen.AlmacenProperties;
import com.vibora.common.exception.ServicioOcupadoException;
import com.vibora.incidencia.ValidadorImagen.Imagen;
import org.springframework.stereotype.Component;

import java.util.concurrent.Semaphore;

/**
 * Valida y recodifica imagenes con un tope de decodificaciones SIMULTANEAS (vibora.almacen.decodificaciones-simultaneas,
 * 2 por defecto). Decodificar una imagen de 16 megapixeles ocupa ~64 MB (mas la copia girada por EXIF): sin tope, unas
 * cuantas subidas a la vez agotarian el heap. El semaforo es justo (FIFO) y quien no consigue permiso en
 * {@code espera-decodificacion} (10 s) recibe un 503 que se puede reintentar. El permiso se libera SIEMPRE (finally).
 * <p>
 * Un {@link OutOfMemoryError} durante la decodificacion se traduce tambien en 503 (no en 413: la imagen puede ser
 * valida y el fallo es de carga del servidor, no del cliente); los {@code byte[]} y el lienzo quedan sin referencias
 * al salir y el hilo de la peticion sigue vivo.
 * <p>
 * Debe llamarse SIN transaccion ni conexion de BD retenidas (ver FotoService).
 */
@Component
public class DecodificadorImagenes {

	static final String OCUPADO = "El servidor está procesando otras imágenes, inténtalo de nuevo en unos segundos";

	private final Semaphore permisos;
	private final long esperaMs;
	private final long maximoPixeles;

	public DecodificadorImagenes(AlmacenProperties propiedades) {
		this.permisos = new Semaphore(Math.max(1, propiedades.decodificacionesSimultaneas()), true);
		this.esperaMs = propiedades.esperaDecodificacion().toMillis();
		this.maximoPixeles = propiedades.maxMegapixeles() * 1_000_000L;
	}

	public Imagen procesar(byte[] contenido) {
		boolean adquirido;
		try {
			adquirido = permisos.tryAcquire(esperaMs, java.util.concurrent.TimeUnit.MILLISECONDS);
		} catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			throw new ServicioOcupadoException(OCUPADO);
		}
		if (!adquirido) {
			throw new ServicioOcupadoException(OCUPADO);
		}
		try {
			return decodificar(contenido);
		} catch (OutOfMemoryError ex) {
			throw new ServicioOcupadoException(OCUPADO);
		} finally {
			permisos.release();
		}
	}

	/** Punto de enganche de los tests (espia): la decodificacion real, ya dentro del permiso. */
	protected Imagen decodificar(byte[] contenido) {
		return ValidadorImagen.procesar(contenido, maximoPixeles);
	}
}
