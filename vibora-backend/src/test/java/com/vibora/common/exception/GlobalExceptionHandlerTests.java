package com.vibora.common.exception;

import com.vibora.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Cobertura del GlobalExceptionHandler: toda excepcion acaba en un JSON {"error": ...} con un mensaje generico en
 * castellano, sin SQL, nombres de restricciones ni trazas. Las excepciones se provocan con
 * {@link ExcepcionesProbeController} (solo de test).
 */
@ExtendWith(OutputCaptureExtension.class)
class GlobalExceptionHandlerTests extends ApiTestBase {

	static final String CONFLICTO = "Conflicto con los datos existentes";
	static final String CONCURRENCIA = "La operación no se pudo completar por concurrencia, inténtalo de nuevo";
	static final String NO_DISPONIBLE = "Servicio no disponible temporalmente";
	static final String INTERNO = "Error interno";

	static Stream<Arguments> casos() {
		return Stream.of(
				Arguments.of("integridad", 409, CONFLICTO),
				Arguments.of("restriccion-hibernate", 409, CONFLICTO),
				Arguments.of("interbloqueo", 409, CONCURRENCIA),
				Arguments.of("no-adquiere-bloqueo", 409, CONCURRENCIA),
				Arguments.of("bloqueo-pesimista", 409, CONCURRENCIA),
				Arguments.of("serializacion", 409, CONCURRENCIA),
				Arguments.of("bloqueo-jpa", 409, CONCURRENCIA),
				Arguments.of("tiempo-de-bloqueo-jpa", 409, CONCURRENCIA),
				Arguments.of("bloqueo-hibernate", 409, CONCURRENCIA),
				Arguments.of("sin-transaccion", 503, NO_DISPONIBLE),
				Arguments.of("sin-recurso", 503, NO_DISPONIBLE),
				Arguments.of("sin-conexion-jdbc", 503, NO_DISPONIBLE),
				Arguments.of("conexion-hibernate", 503, NO_DISPONIBLE),
				Arguments.of("pool-agotado", 503, NO_DISPONIBLE),
				Arguments.of("inesperada", 500, INTERNO),
				Arguments.of("nula", 500, INTERNO),
				Arguments.of("comprobada", 500, INTERNO),
				Arguments.of("denegada", 403, "Acceso denegado"));
	}

	@ParameterizedTest(name = "{0} -> {1}")
	@MethodSource("casos")
	void excepcion_seTraduceAJsonGenericoSinFiltrarNada(String caso, int estado, String mensaje) throws Exception {
		MvcResult r = mvc.perform(get("/api/test/excepciones/" + caso).header("Authorization", bearerJugador("j@vibora.com")))
				.andExpect(status().is(estado))
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(jsonPath("$.error").value(mensaje))
				.andReturn();

		String cuerpo = r.getResponse().getContentAsString();
		assertThat(cuerpo).isEqualTo("{\"error\":\"" + mensaje + "\"}")
				.doesNotContain("SELECT").doesNotContain("usuario_email_uk").doesNotContain("secreto")
				.doesNotContain("Exception").doesNotContain("HikariPool").doesNotContain("at com.");
	}

	@Test
	void errorInesperado_seRegistraEnElServidorConSuCausa(CapturedOutput salida) throws Exception {
		mvc.perform(get("/api/test/excepciones/inesperada").header("Authorization", bearerJugador("j@vibora.com")))
				.andExpect(status().isInternalServerError());

		assertThat(salida.getAll()).contains(ExcepcionesProbeController.SECRETO).contains("IllegalStateException");
	}

	@Test
	void conflictoDeIntegridad_seRegistraEnElServidor(CapturedOutput salida) throws Exception {
		mvc.perform(get("/api/test/excepciones/integridad").header("Authorization", bearerJugador("j@vibora.com")))
				.andExpect(status().isConflict());

		assertThat(salida.getAll()).contains("usuario_email_uk");
	}

	// ---- los mapeos que ya existian no cambian ----

	@Test
	void losMapeosEspecificosSiguenIgual() throws Exception {
		String token = bearerJugador("j@vibora.com");
		mvc.perform(get("/api/clubes/999999").header("Authorization", token)).andExpect(status().isNotFound())
				.andExpect(jsonPath("$.error").value("Club no encontrado"));
		mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"x\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Datos no válidos"));
		mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{no es json"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Datos no válidos"));
	}

	// ---- errores de Spring MVC ----

	@ParameterizedTest
	@ValueSource(strings = { "/api/no-existe", "/api/clubes/1/no-existe", "/otra-cosa", "/api/test/excepciones" })
	void rutaDesconocida_404ConJson(String ruta) throws Exception {
		mvc.perform(get(ruta).header("Authorization", bearerJugador("j@vibora.com")))
				.andExpect(status().isNotFound())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(jsonPath("$.error").value("Recurso no encontrado"));
	}

	@Test
	void metodoNoPermitido_405ConJsonYCabeceraAllow() throws Exception {
		String token = bearerJugador("j@vibora.com");

		mvc.perform(delete("/api/reservas/mias").header("Authorization", token))
				.andExpect(status().isMethodNotAllowed())
				.andExpect(header().string("Allow", org.hamcrest.Matchers.containsString("GET")))
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(jsonPath("$.error").value("Método no permitido"));
		mvc.perform(put("/api/auth/login").header("Authorization", token)).andExpect(status().isMethodNotAllowed())
				.andExpect(jsonPath("$.error").value("Método no permitido"));
	}

	@Test
	void tipoDeContenidoNoSoportado_415ConJson() throws Exception {
		mvc.perform(post("/api/auth/login").contentType(MediaType.TEXT_PLAIN).content("email=a&password=b"))
				.andExpect(status().isUnsupportedMediaType())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(jsonPath("$.error").value("Tipo de contenido no soportado"));
	}

	@Test
	void faltaUnParametroObligatorio_400ConJson() throws Exception {
		String token = bearerJugador("j@vibora.com");

		mvc.perform(get("/api/clubes/1/reservas").header("Authorization", token)) // falta "fecha"
				.andExpect(status().isBadRequest())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
				.andExpect(jsonPath("$.error").value("Datos no válidos"));
	}

	@Test
	void sinToken_siguenSiendo401Y403ConSuJson() throws Exception {
		mvc.perform(get("/api/no-existe")).andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error").value("No autenticado"));
		mvc.perform(get("/api/test/admin").header("Authorization", bearerJugador("j@vibora.com")))
				.andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("Acceso denegado"));
	}

	@Test
	void actuatorYError_noCambian() throws Exception {
		mvc.perform(get("/actuator/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
		mvc.perform(get("/actuator/health/db")).andExpect(status().isNotFound());
		mvc.perform(get("/actuator/env").header("Authorization", bearerJugador("j@vibora.com")))
				.andExpect(status().isNotFound());
	}
}
