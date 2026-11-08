package com.vibora.incidencia;

import com.vibora.usuario.Rol;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/** Cuota de fotos por persona en una ventana movil de 24 h (aqui 3 para no subir 40), con la carrera cerrada por el bloqueo del usuario. */
@TestPropertySource(properties = { "vibora.almacen.cuota-diaria-por-usuario=3" })
class FotoCuotaTests extends IncidenciaSinTransaccionBase {

	static final Path CARPETA = AlmacenDeTest.carpeta("vibora-test-cuota-");
	static final String MENSAJE = "Has alcanzado el límite diario de fotos";

	@DynamicPropertySource
	static void propiedades(DynamicPropertyRegistry registro) {
		registro.add("vibora.almacen.directorio", CARPETA::toString);
	}

	@Autowired JdbcTemplate jdbc;
	@MockitoSpyBean DecodificadorImagenes decodificador;

	@AfterEach
	void limpiarFicheros() {
		AlmacenDeTest.vaciar(CARPETA);
	}

	private org.springframework.mock.web.MockHttpServletResponse subir(Persona p, long incidencia) throws Exception {
		return mvc.perform(multipart("/api/incidencias/" + incidencia + "/fotos")
						.file(new MockMultipartFile("file", "a.png", "image/png", Imagenes.png(16, 16, true)))
						.header("Authorization", p.token()))
				.andReturn().getResponse();
	}

	@Test
	void laCuartaFotoDelDia_429ConSuMensaje_sinFilaNiFichero_yOtraPersonaNoSeAfecta() throws Exception {
		long incidencia = incidenciaDe(jugador, "Red cuota");
		for (int i = 0; i < 3; i++) {
			assertThat(subir(jugador, incidencia).getStatus()).isEqualTo(201);
		}

		var cuarta = subir(jugador, incidencia); // la incidencia admite 4, pero la persona ya subio 3 hoy
		assertThat(cuarta.getStatus()).isEqualTo(429);
		assertThat(cuarta.getContentAsString()).contains(MENSAJE);
		assertThat(fotos.countByIncidenciaId(incidencia)).isEqualTo(3);
		assertThat(AlmacenDeTest.ficheros(CARPETA)).hasSize(3);

		assertThat(subir(admin, incidencia).getStatus()).as("otra persona").isEqualTo(201);
	}

	@Test
	void superadaLaCuota_noSeDecodificaNada_yRetryAfterEsLoQueFaltaParaQueSalgaLaMasVieja() throws Exception {
		long incidencia = incidenciaDe(jugador, "Red pre");
		for (int i = 0; i < 3; i++) {
			assertThat(subir(jugador, incidencia).getStatus()).isEqualTo(201);
		}
		verify(decodificador, times(3)).procesar(any());

		// la mas vieja fue subida hace 23 h: sale de la ventana en ~1 h
		jdbc.update("update incidencia_foto set creada_en = now() - interval '23 hours' where id = (select min(id) from incidencia_foto)");
		var rechazada = subir(jugador, incidencia);

		assertThat(rechazada.getStatus()).isEqualTo(429);
		assertThat(rechazada.getContentAsString()).contains(MENSAJE);
		verify(decodificador, times(3)).procesar(any()); // ni una decodificacion mas: se corta antes de leer la imagen
		long espera = Long.parseLong(rechazada.getHeader("Retry-After"));
		assertThat(espera).isBetween(3500L, 3600L);
	}

	@Test
	void retryAfterNuncaSuperaLasVeinticuatroHoras() throws Exception {
		long incidencia = incidenciaDe(jugador, "Red tope");
		for (int i = 0; i < 3; i++) {
			assertThat(subir(jugador, incidencia).getStatus()).isEqualTo(201);
		}
		var rechazada = subir(jugador, incidencia);
		assertThat(Long.parseLong(rechazada.getHeader("Retry-After"))).isBetween(86_000L, 86_400L);
	}

	@Test
	void lasFotosDeHaceMasDeVeinticuatroHorasNoCuentan_yLaCuotaEsExactaEnElLimite() throws Exception {
		long a = incidenciaDe(jugador, "Red A");
		long b = incidenciaDe(jugador, "Red B");
		for (int i = 0; i < 3; i++) {
			assertThat(subir(jugador, a).getStatus()).isEqualTo(201);
		}
		assertThat(subir(jugador, b).getStatus()).isEqualTo(429);

		// una foto "de hace 24 h exactas" ya no cuenta; "de hace 23 h 59 min" si
		jdbc.update("update incidencia_foto set creada_en = now() - interval '24 hours' where id = (select min(id) from incidencia_foto)");
		assertThat(subir(jugador, b).getStatus()).as("la mas vieja salio de la ventana").isEqualTo(201);
		assertThat(subir(jugador, b).getStatus()).isEqualTo(429);

		jdbc.update("update incidencia_foto set creada_en = now() - interval '23 hours 59 minutes' where id = (select min(id) from incidencia_foto where creada_en > now() - interval '1 hour')");
		assertThat(subir(jugador, b).getStatus()).as("23h59 sigue contando").isEqualTo(429);
	}

	@RepeatedTest(3)
	void seisSubidasALaVezDeLaMismaPersona_exactamenteTresEntran() throws Exception {
		List<Long> incidencias = new ArrayList<>();
		for (int i = 0; i < 6; i++) {
			incidencias.add(incidenciaDe(i < 3 ? jugador : admin, "Red " + i)); // maximo 5 abiertas por persona
		}
		List<Callable<Integer>> tareas = new ArrayList<>();
		for (long incidencia : incidencias) {
			tareas.add(() -> subir(admin, incidencia).getStatus()); // el admin ve todas
		}
		List<Integer> estados = lanzarALaVez(tareas);

		assertThat(estados.stream().filter(s -> s == 201).count()).as("201: %s", estados).isEqualTo(3);
		assertThat(estados.stream().filter(s -> s == 429).count()).as("429: %s", estados).isEqualTo(3);
		assertThat(fotos.count()).isEqualTo(3);
		assertThat(AlmacenDeTest.ficheros(CARPETA)).hasSize(3);
	}
}
