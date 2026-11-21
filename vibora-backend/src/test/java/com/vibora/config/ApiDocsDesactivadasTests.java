package com.vibora.config;

import com.vibora.ApiTestBase;
import org.junit.jupiter.api.Test;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Sin ninguna propiedad (el valor por defecto: lo que corre con `java -jar` o `spring-boot:build-image`) no se sirve
 * ni la especificacion ni Swagger UI: 404, y no 401, porque las rutas siguen siendo publicas en SecurityConfig.
 * Comparte el contexto normal de ApiTestBase, sin @TestPropertySource.
 */
class ApiDocsDesactivadasTests extends ApiTestBase {

	@Test
	void laEspecificacionNoSeSirve() throws Exception {
		mvc.perform(get("/v3/api-docs")).andExpect(status().isNotFound());
	}

	@Test
	void swaggerUiNoSeSirve() throws Exception {
		mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isNotFound());
		mvc.perform(get("/swagger-ui.html")).andExpect(status().isNotFound());
	}

	@Test
	void laApiRealSigueExigiendoToken() throws Exception {
		mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
	}

	@Test
	void elControladorSondaDeApiDocsTestsNoSeFiltraAEsteContexto() throws Exception {
		// con un token valido, si la sonda estuviera registrada respondería 200; debe ser 404
		mvc.perform(get("/fuera-de-api/sonda").header("Authorization", bearerJugador("sonda404@vibora.test")))
				.andExpect(status().isNotFound());
	}
}
