package com.vibora.incidencia;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Path;
import java.util.regex.Matcher;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/** En una incidencia CERRADA/RECHAZADA solo la administracion del club puede borrar fotos (antes, nadie); el resto sigue con 409. */
class FotoEliminarTerminalTests extends IncidenciaSinTransaccionBase {

	static final Path CARPETA = AlmacenDeTest.carpeta("vibora-test-terminal-");

	@DynamicPropertySource
	static void propiedades(DynamicPropertyRegistry registro) {
		registro.add("vibora.almacen.directorio", CARPETA::toString);
	}

	@AfterEach
	void limpiarFicheros() {
		AlmacenDeTest.vaciar(CARPETA);
	}

	private long subir(Persona p, long incidencia) throws Exception {
		String cuerpo = mvc.perform(multipart("/api/incidencias/" + incidencia + "/fotos")
						.file(new MockMultipartFile("file", "a.png", "image/png", Imagenes.png(16, 16, true)))
						.header("Authorization", p.token()))
				.andReturn().getResponse().getContentAsString();
		Matcher m = ID.matcher(cuerpo);
		assertThat(m.find()).as(cuerpo).isTrue();
		return Long.parseLong(m.group(1));
	}

	private int borrar(Persona p, long incidencia, long foto) throws Exception {
		return mvc.perform(delete("/api/incidencias/" + incidencia + "/fotos/" + foto).header("Authorization", p.token()))
				.andReturn().getResponse().getStatus();
	}

	private long terminal(String estadoFinal) throws Exception {
		long incidencia = incidenciaDe(jugador, "Red " + estadoFinal);
		return incidencia;
	}

	@Test
	void rechazada_elAdminBorra204ConEvento_laPersonaQueLaSubioSigueConElConflicto() throws Exception {
		long incidencia = terminal("RECHAZADA");
		long foto = subir(jugador, incidencia);
		assertThat(rechazar(admin, incidencia)).isEqualTo(200);

		assertThat(borrar(jugador, incidencia, foto)).as("quien la subio").isEqualTo(409);
		assertThat(borrar(mant1, incidencia, foto)).as("personal sin relacion").isIn(403, 404);
		assertThat(fotos.countByIncidenciaId(incidencia)).isEqualTo(1);

		assertThat(borrar(admin, incidencia, foto)).as("administracion del club").isEqualTo(204);
		assertThat(fotos.countByIncidenciaId(incidencia)).isZero();
		assertThat(AlmacenDeTest.ficheros(CARPETA)).isEmpty();
		assertThat(eventos.findByIncidenciaIdOrderByCreadoEnAscIdAsc(incidencia).stream()
				.filter(e -> e.getTipo() == TipoEventoIncidencia.FOTO_ELIMINADA)).hasSize(1);
	}

	@Test
	void cerrada_elAdminTambienBorra() throws Exception {
		long incidencia = incidenciaDe(jugador, "Red cerrada");
		long foto = subir(jugador, incidencia);
		assertThat(asignar(admin, incidencia, mant1.id())).isEqualTo(200);
		assertThat(estado(mant1, incidencia, "EN_CURSO")).isEqualTo(200);
		assertThat(estado(mant1, incidencia, "RESUELTA")).isEqualTo(200);
		assertThat(estado(admin, incidencia, "CERRADA")).isEqualTo(200);

		assertThat(borrar(jugador, incidencia, foto)).isEqualTo(409);
		assertThat(borrar(admin, incidencia, foto)).isEqualTo(204);
	}

	@Test
	void abierta_losPermisosDeSiempreNoCambian() throws Exception {
		long incidencia = incidenciaDe(jugador, "Red abierta");
		long foto = subir(jugador, incidencia);

		assertThat(borrar(mant1, incidencia, foto)).isIn(403, 404);
		assertThat(borrar(jugador, incidencia, foto)).isEqualTo(204);
	}
}
