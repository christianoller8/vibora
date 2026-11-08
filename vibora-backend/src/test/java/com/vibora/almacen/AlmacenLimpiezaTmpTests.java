package com.vibora.almacen;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Barrido de los temporales tmp-* que un fallo entre escribir y renombrar deja huerfanos: nunca toca claves reales. */
class AlmacenLimpiezaTmpTests {

	@TempDir Path base;

	private Path fichero(String nombre, Duration antiguedad) throws Exception {
		Path p = Files.write(base.resolve(nombre), new byte[] { 1, 2, 3 });
		Files.setLastModifiedTime(p, FileTime.from(Instant.now().minus(antiguedad)));
		return p;
	}

	@Test
	void borraSoloLosTemporalesMasViejosQueElLimite() throws Exception {
		Path viejo = fichero("tmp-" + UUID.randomUUID(), Duration.ofMinutes(61));
		Path reciente = fichero("tmp-" + UUID.randomUUID(), Duration.ofMinutes(10));
		Path clave = fichero(UUID.randomUUID().toString(), Duration.ofDays(30)); // foto real, muy vieja
		Path casi = fichero("temporal-" + UUID.randomUUID(), Duration.ofDays(30)); // no empieza por tmp-
		Path directorio = Files.createDirectory(base.resolve("tmp-directorio"));
		Files.setLastModifiedTime(directorio, FileTime.from(Instant.now().minus(Duration.ofDays(2))));
		AlmacenFicherosLocal almacen = new AlmacenFicherosLocal(base);

		int borrados = almacen.limpiarTemporales(Duration.ofHours(1));

		assertThat(borrados).isEqualTo(1);
		assertThat(viejo).doesNotExist();
		assertThat(reciente).exists();
		assertThat(clave).exists();
		assertThat(casi).exists();
		assertThat(directorio).exists();
	}

	@Test
	void sinCarpetaTodavia_noHaceNadaNiFalla() {
		AlmacenFicherosLocal almacen = new AlmacenFicherosLocal(base.resolve("no-existe"));

		assertThat(almacen.limpiarTemporales(Duration.ofHours(1))).isZero();
	}

	@Test
	void unaClaveRealConPrefijoTmpNoPuedeExistir_laClaveValidaDelAlmacenSiempreEmpiezaPorUuid() throws Exception {
		AlmacenFicherosLocal almacen = new AlmacenFicherosLocal(base);
		String clave = UUID.randomUUID().toString();
		almacen.guardar(clave, new byte[] { 9 });
		Files.setLastModifiedTime(base.resolve(clave), FileTime.from(Instant.now().minus(Duration.ofDays(3))));

		assertThat(almacen.limpiarTemporales(Duration.ZERO)).isZero();
		assertThat(almacen.existe(clave)).isTrue();
	}
}
