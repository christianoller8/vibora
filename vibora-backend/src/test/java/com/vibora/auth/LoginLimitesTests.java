package com.vibora.auth;

import com.vibora.ApiTestBase;
import com.vibora.usuario.Rol;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Cotas del cuerpo del login (peticion sin autenticar: no puede obligar al servidor a normalizar textos enormes):
 * email hasta 255 caracteres (la misma cota que el registro y la columna) y contrasena hasta 1000. Entre 73 bytes y 1000 caracteres la contrasena sigue siendo un
 * simple 401 (nunca 500 ni una pista sobre la politica).
 */
class LoginLimitesTests extends ApiTestBase {

	private ResultActions login(String email, String password) throws Exception {
		return mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password)));
	}

	/** Email sintacticamente valido de exactamente {@code longitud} caracteres (parte local de 64, etiquetas de 63). */
	private static String emailDeLongitud(int longitud) {
		String local = "a".repeat(64);
		int dominio = longitud - local.length() - 1;
		StringBuilder sb = new StringBuilder();
		while (dominio - sb.length() > 63 + 1 + 4) {
			sb.append("b".repeat(63)).append('.');
		}
		int resto = dominio - sb.length() - ".com".length();
		sb.append("c".repeat(resto)).append(".com");
		String email = local + "@" + sb;
		assertThat(email).hasSize(longitud);
		return email;
	}

	private ResultActions registro(String email) throws Exception {
		return mvc.perform(post("/api/auth/registro").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"%s\",\"password\":\"%s\",\"apellidos\":\"X\"}".formatted(email, PASSWORD)));
	}

	@Test
	void emailDe255Caracteres_puedeRegistrarseYLuegoHacerLogin() throws Exception {
		String email = emailDeLongitud(255);

		registro(email).andExpect(status().isCreated());
		login(email, PASSWORD).andExpect(status().isOk());
	}

	@Test
	void emailDe256Caracteres_400EnRegistroYEnLogin() throws Exception {
		String email = emailDeLongitud(256);

		registro(email).andExpect(status().isBadRequest());
		login(email, PASSWORD).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Datos no válidos"));
	}

	@Test
	void emailDe254Caracteres_noEsUn400() throws Exception {
		login("a".repeat(243) + "@vibora.com", PASSWORD).andExpect(status().isUnauthorized()); // 243 + 11 = 254
	}

	@Test
	void emailMuyLargo_400() throws Exception {
		login("a".repeat(100_000) + "@vibora.com", PASSWORD).andExpect(status().isBadRequest());
	}

	@Test
	void passwordDe1001Caracteres_400() throws Exception {
		login("ana@vibora.com", "a".repeat(1001)).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("Datos no válidos"));
	}

	@Test
	void passwordDe1000Caracteres_401() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		login("ana@vibora.com", "a".repeat(1000)).andExpect(status().isUnauthorized())
				.andExpect(jsonPath("$.error").value("Credenciales inválidas"));
	}

	@Test
	void passwordDe73Bytes_401() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		login("ana@vibora.com", "a".repeat(73)).andExpect(status().isUnauthorized());
	}

	@Test
	void passwordMultibyteDe1000CaracteresYMasDe72Bytes_401() throws Exception {
		login("noexiste@vibora.com", "ñ".repeat(1000)).andExpect(status().isUnauthorized());
	}
}
