package com.vibora.auth;

import com.vibora.ApiTestBase;
import com.vibora.usuario.Rol;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** vibora.sesion.cookie-segura=false (desarrollo sin HTTPS): la cookie pierde SOLO el atributo Secure. */
@TestPropertySource(properties = "vibora.sesion.cookie-segura=false")
class CookieRefrescoInseguraTests extends ApiTestBase {

	@Test
	void sinCookieSegura_laCookieNoLlevaSecure_peroConservaElResto() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		MvcResult r = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"ana@vibora.com\",\"password\":\"%s\"}".formatted(PASSWORD)))
				.andExpect(status().isOk()).andReturn();

		assertThat(r.getResponse().getHeader("Set-Cookie")).startsWith("vibora_refresco=").doesNotContain("Secure")
				.contains("HttpOnly").contains("SameSite=Strict").contains("Path=/api/auth");
	}
}
