package com.vibora.auth;

import com.vibora.ApiTestBase;
import com.vibora.usuario.Rol;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Limite de /api/auth/refrescar por IP: solo cuentan los fallidos (aqui 3 por ventana; en produccion 60 cada 15 minutos). */
@TestPropertySource(properties = "vibora.seguridad.refresco-max-por-ip=3")
class RefrescoLimiteTests extends ApiTestBase {

	private MockHttpServletRequestBuilder desde(MockHttpServletRequestBuilder b, String ip) {
		return b.with(r -> {
			r.setRemoteAddr(ip);
			return r;
		});
	}

	@Test
	void elCuartoRefrescoDeLaMismaIpEs429ConRetryAfter_yOtraIpNoSeVeAfectada() throws Exception {
		for (int i = 0; i < 3; i++) {
			mvc.perform(desde(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", "invalida")), "10.99.0.1"))
					.andExpect(status().isUnauthorized());
		}

		mvc.perform(desde(post("/api/auth/refrescar"), "10.99.0.1"))
				.andExpect(status().isTooManyRequests())
				.andExpect(header().string("Retry-After", "900"))
				.andExpect(jsonPath("$.error").value("Demasiados intentos. Inténtalo de nuevo en 15 minutos"));

		mvc.perform(desde(post("/api/auth/refrescar"), "10.99.0.2")).andExpect(status().isUnauthorized());
	}

	@Test
	void losRefrescosCorrectosNoCuentanParaElLimite_yLosFallidosSiDespuesDeVariosCorrectos() throws Exception {
		crearUsuario("bea@vibora.com", Rol.JUGADOR, null);
		MvcResult login = mvc.perform(desde(post("/api/auth/login"), "10.99.0.5").contentType("application/json")
				.content("{\"email\":\"bea@vibora.com\",\"password\":\"%s\"}".formatted(PASSWORD)))
				.andExpect(status().isOk()).andReturn();
		String cookie = valorDeCookie(login);

		for (int i = 0; i < 10; i++) { // con un tope de 3 por ventana: si los correctos contaran, el cuarto ya seria 429
			MvcResult r = mvc.perform(desde(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", cookie)), "10.99.0.5"))
					.andExpect(status().isOk()).andReturn();
			cookie = valorDeCookie(r);
		}

		for (int i = 0; i < 3; i++) { // los fallidos si cuentan
			mvc.perform(desde(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", "invalida")), "10.99.0.5"))
					.andExpect(status().isUnauthorized());
		}
		mvc.perform(desde(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", cookie)), "10.99.0.5"))
				.andExpect(status().isTooManyRequests())
				.andExpect(header().string("Retry-After", "900"));
	}

	@Test
	void lasPeticionesSinCookieNoGastanLaCuota_yUnaValidaDeLaMismaIpPasa() throws Exception {
		crearUsuario("cris@vibora.com", Rol.JUGADOR, null);
		MvcResult login = mvc.perform(desde(post("/api/auth/login"), "10.99.0.6").contentType("application/json")
				.content("{\"email\":\"cris@vibora.com\",\"password\":\"%s\"}".formatted(PASSWORD)))
				.andExpect(status().isOk()).andReturn();
		String cookie = valorDeCookie(login);

		for (int i = 0; i < 10; i++) { // con un tope de 3: si las vacias contaran, la cuarta ya seria 429
			mvc.perform(desde(post("/api/auth/refrescar"), "10.99.0.6")).andExpect(status().isUnauthorized());
		}
		mvc.perform(desde(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", " ")), "10.99.0.6"))
				.andExpect(status().isUnauthorized());

		mvc.perform(desde(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", cookie)), "10.99.0.6"))
				.andExpect(status().isOk());
	}

	private static String valorDeCookie(MvcResult r) {
		Matcher m = Pattern.compile("vibora_refresco=([^;]*)").matcher(r.getResponse().getHeader("Set-Cookie"));
		assertThat(m.find()).isTrue();
		return m.group(1);
	}

	@Test
	void elLimiteDeRefrescoNoGastaLaCuotaDelLogin() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		for (int i = 0; i < 3; i++) {
			mvc.perform(desde(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", "invalida")), "10.99.0.3"))
					.andExpect(status().isUnauthorized());
		}
		mvc.perform(desde(post("/api/auth/refrescar"), "10.99.0.3")).andExpect(status().isTooManyRequests());

		MvcResult login = mvc.perform(desde(post("/api/auth/login"), "10.99.0.3").contentType("application/json")
				.content("{\"email\":\"ana@vibora.com\",\"password\":\"%s\"}".formatted(PASSWORD)))
				.andExpect(status().isOk()).andReturn();

		Matcher m = Pattern.compile("vibora_refresco=([^;]*)").matcher(login.getResponse().getHeader("Set-Cookie"));
		assertThat(m.find()).isTrue();
		mvc.perform(desde(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", m.group(1))), "10.99.0.4"))
				.andExpect(status().isOk());
	}
}
