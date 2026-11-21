package com.vibora.config;

import com.vibora.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Con VIBORA_API_DOCS=true (lo que fija `./mvnw spring-boot:run`) OpenAPI y Swagger UI se sirven y son publicos; el
 * contrato lleva el esquema bearerAuth global y solo login/registro lo anulan. La API real sigue exigiendo token.
 */
@TestPropertySource(properties = "VIBORA_API_DOCS=true")
@Import(ApiDocsTests.FueraDeApiProbeController.class)
class ApiDocsTests extends ApiTestBase {

	/**
	 * Controlador SOLO de este test, fuera de /api/**: comprueba que springdoc.paths-to-match=/api/** deja fuera de
	 * la especificacion todo lo que no es la API de negocio. Anidado y registrado con @Import: no entra en el resto
	 * de contextos de test (lo prueba ApiDocsDesactivadasTests).
	 */
	@RestController
	static class FueraDeApiProbeController {

		@GetMapping("/fuera-de-api/sonda")
		Map<String, String> sonda() {
			return Map.of("ok", "sonda");
		}
	}

	@Test
	void laEspecificacionEsPublicaYTieneLaInformacionDeLaApi() throws Exception {
		mvc.perform(get("/v3/api-docs"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.info.title").value("Víbora API"))
				.andExpect(jsonPath("$.info.version").value("v1"))
				.andExpect(jsonPath("$.info.description").isNotEmpty());
	}

	@Test
	void declaraElEsquemaBearerJwtYLoAplicaDeFormaGlobal() throws Exception {
		mvc.perform(get("/v3/api-docs"))
				.andExpect(jsonPath("$.components.securitySchemes.bearerAuth.type").value("http"))
				.andExpect(jsonPath("$.components.securitySchemes.bearerAuth.scheme").value("bearer"))
				.andExpect(jsonPath("$.components.securitySchemes.bearerAuth.bearerFormat").value("JWT"))
				.andExpect(jsonPath("$.security[0].bearerAuth").isArray());
	}

	@Test
	void documentaSoloLaApiDeNegocioSinActuatorNiError() throws Exception {
		mvc.perform(get("/v3/api-docs"))
				.andExpect(jsonPath("$.paths['/api/auth/login']").exists())
				.andExpect(jsonPath("$.paths['/api/partidos']").exists())
				.andExpect(jsonPath("$.paths['/actuator/health']").doesNotExist())
				.andExpect(jsonPath("$.paths['/error']").doesNotExist());
	}

	@Test
	void unControladorFueraDeApiNoSeDocumenta() throws Exception {
		// FueraDeApiProbeController (solo test) existe en /fuera-de-api/sonda: paths-to-match=/api/** lo excluye
		mvc.perform(get("/v3/api-docs"))
				.andExpect(jsonPath("$.paths['/fuera-de-api/sonda']").doesNotExist());
	}

	@Test
	void loginYRegistroSonPublicosYNoPidenToken() throws Exception {
		mvc.perform(get("/v3/api-docs"))
				.andExpect(jsonPath("$.paths['/api/auth/login'].post.security").isArray())
				.andExpect(jsonPath("$.paths['/api/auth/login'].post.security").isEmpty())
				.andExpect(jsonPath("$.paths['/api/auth/registro'].post.security").isArray())
				.andExpect(jsonPath("$.paths['/api/auth/registro'].post.security").isEmpty());
	}

	@Test
	void unEndpointProtegidoHeredaElRequisitoGlobal() throws Exception {
		// sin "security" propio: aplica el global (bearerAuth)
		mvc.perform(get("/v3/api-docs"))
				.andExpect(jsonPath("$.paths['/api/auth/me'].get").exists())
				.andExpect(jsonPath("$.paths['/api/auth/me'].get.security").doesNotExist());
	}

	@Test
	void swaggerUiEsPublicaSinToken() throws Exception {
		mvc.perform(get("/swagger-ui/index.html"))
				.andExpect(status().isOk())
				.andExpect(content().contentTypeCompatibleWith("text/html"));
	}

	@Test
	void laApiRealSigueExigiendoToken() throws Exception {
		// (ActuatorHealthTests.elRestoDeLaApiSigueExigiendoAutenticacion lo prueba tambien para /api/auth/me y /api/partidos)
		mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
		mvc.perform(get("/api/partidos")).andExpect(status().isUnauthorized());
	}
}
