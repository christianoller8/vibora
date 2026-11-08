package com.vibora.almacen;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Almacen en el sistema de ficheros, bajo vibora.almacen.directorio (se crea al guardar el primer fichero).
 * <p>
 * Seguridad de rutas, en dos capas: (1) la clave tiene que ser un nombre simple (letras, cifras, punto, guion y guion
 * bajo, empezando por letra o cifra: sin separadores, sin ":" ni "..") y (2) la ruta resuelta y normalizada tiene que
 * quedar DIRECTAMENTE dentro de la carpeta base. Las claves reales son UUID generados por el servidor; esto es defensa
 * en profundidad. No se siguen ni se comprueban enlaces simbolicos dentro de la carpeta base: es del propio servidor.
 * <p>
 * La escritura es atomica: se escribe un temporal en la misma carpeta y se renombra, asi nunca queda un fichero a medias.
 */
@Component
public class AlmacenFicherosLocal implements AlmacenFicheros {

	private static final Pattern CLAVE_VALIDA = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,79}");
	private static final String PREFIJO_TEMPORAL = "tmp-";

	private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AlmacenFicherosLocal.class);

	private final Path base;
	private final int edadTmpHoras;

	@Autowired
	public AlmacenFicherosLocal(AlmacenProperties propiedades) {
		this(Path.of(propiedades.directorio()), propiedades.limpiezaTmpHoras());
	}

	public AlmacenFicherosLocal(Path base) {
		this(base, 1);
	}

	private AlmacenFicherosLocal(Path base, int edadTmpHoras) {
		this.base = base.toAbsolutePath().normalize();
		this.edadTmpHoras = edadTmpHoras;
	}

	@Override
	public void guardar(String clave, byte[] contenido) {
		Path destino = resolver(clave);
		Path temporal = base.resolve(PREFIJO_TEMPORAL + UUID.randomUUID());
		try {
			Files.createDirectories(base);
			Files.write(temporal, contenido);
			try {
				Files.move(temporal, destino, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
			} catch (AtomicMoveNotSupportedException ex) {
				Files.move(temporal, destino, StandardCopyOption.REPLACE_EXISTING);
			}
		} catch (IOException ex) {
			try {
				Files.deleteIfExists(temporal);
			} catch (IOException ignorada) {
				// el fallo que importa es el original
			}
			throw new UncheckedIOException("No se pudo guardar el fichero " + clave, ex);
		}
	}

	@Override
	public InputStream abrir(String clave) {
		try {
			return Files.newInputStream(resolver(clave));
		} catch (NoSuchFileException ex) {
			throw new FicheroNoEncontradoException(clave);
		} catch (IOException ex) {
			throw new UncheckedIOException("No se pudo abrir el fichero " + clave, ex);
		}
	}

	@Override
	public void borrar(String clave) {
		try {
			Files.deleteIfExists(resolver(clave));
		} catch (IOException ex) {
			throw new UncheckedIOException("No se pudo borrar el fichero " + clave, ex);
		}
	}

	@Override
	public boolean existe(String clave) {
		return Files.isRegularFile(resolver(clave));
	}

	/**
	 * Borra los temporales {@code tmp-*} (ficheros normales directamente en la carpeta base) cuya ultima modificacion es
	 * anterior a {@code edadMinima}: los deja huerfanos una caida entre escribir y renombrar. Nunca toca una foto real:
	 * las claves reales son UUID generados por el servidor (nunca empiezan por "tmp-") y aqui solo se miran ficheros
	 * normales con ese prefijo. Devuelve cuantos borro. Publico para probarlo directamente.
	 */
	public int limpiarTemporales(Duration edadMinima) {
		if (!Files.isDirectory(base)) {
			return 0;
		}
		java.time.Instant limite = java.time.Instant.now().minus(edadMinima);
		int borrados = 0;
		try (java.util.stream.Stream<Path> ficheros = Files.list(base)) {
			for (Path p : (Iterable<Path>) ficheros::iterator) {
				String nombre = p.getFileName().toString();
				try {
					if (nombre.startsWith(PREFIJO_TEMPORAL) && Files.isRegularFile(p, java.nio.file.LinkOption.NOFOLLOW_LINKS)
							&& Files.getLastModifiedTime(p).toInstant().isBefore(limite) && Files.deleteIfExists(p)) {
						borrados++;
					}
				} catch (IOException ex) {
					log.warn("No se pudo borrar el temporal huérfano {}", nombre, ex);
				}
			}
		} catch (IOException ex) {
			log.warn("No se pudo recorrer el almacén para limpiar temporales", ex);
		}
		return borrados;
	}

	/** Barrido periodico (vibora.almacen.limpieza-tmp-cron, cada hora por defecto) con la edad de limpieza-tmp-horas. */
	@Scheduled(cron = "${vibora.almacen.limpieza-tmp-cron:0 15 * * * *}")
	void limpiezaProgramada() {
		int n = limpiarTemporales(Duration.ofHours(edadTmpHoras));
		if (n > 0) {
			log.info("Borrados {} temporales huérfanos del almacén", n);
		}
	}

	private Path resolver(String clave) {
		if (clave == null || !CLAVE_VALIDA.matcher(clave).matches()) {
			throw new IllegalArgumentException("Clave de almacén no válida");
		}
		Path ruta = base.resolve(clave).normalize();
		if (!base.equals(ruta.getParent())) {
			throw new IllegalArgumentException("Clave de almacén no válida");
		}
		return ruta;
	}
}
