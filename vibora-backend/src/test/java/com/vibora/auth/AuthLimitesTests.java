package com.vibora.auth;

import com.vibora.ApiTestBase;
import com.vibora.club.Club;
import com.vibora.usuario.Rol;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Limites de login/registro de extremo a extremo (MockMvc) con los valores de PRODUCCION (5 por par, 30 por IP, 10 registros). */
@TestPropertySource(properties = {
		"vibora.seguridad.login-max-por-email=5",
		"vibora.seguridad.login-max-por-ip=30",
		"vibora.seguridad.registro-max-por-ip=10" })
class AuthLimitesTests extends ApiTestBase {

	private static final AtomicInteger SIGUIENTE = new AtomicInteger(1);
	private static final String MENSAJE_15 = "Demasiados intentos. Inténtalo de nuevo en 15 minutos";

	@MockitoSpyBean PasswordEncoder codificador;

	/** Cada test usa su propia IP: el limitador es un bean compartido por todo el contexto. */
	private final String ip = "10.77." + (SIGUIENTE.getAndIncrement() / 250) + "." + (SIGUIENTE.get() % 250 + 1);

	private MockHttpServletRequestBuilder desde(MockHttpServletRequestBuilder b) {
		return b.with(r -> {
			r.setRemoteAddr(ip);
			return r;
		});
	}

	private MvcResult login(String email, String password, int estado) throws Exception {
		return mvc.perform(desde(post("/api/auth/login")).contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password)))
				.andExpect(status().is(estado)).andReturn();
	}

	private void registrar(String email, int estado) throws Exception {
		mvc.perform(desde(post("/api/auth/registro")).contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"%s\",\"password\":\"%s\",\"nombre\":\"N\",\"apellidos\":\"A\"}".formatted(email, PASSWORD)))
				.andExpect(status().is(estado));
	}

	@Test
	void elSextoFalloDelMismoParIpEmailEs429ConRetryAfterYElLoginCorrectoYaNoEntra() throws Exception {
		crearUsuario("lim1@vibora.com", Rol.JUGADOR, null);
		for (int i = 0; i < 5; i++) {
			login("lim1@vibora.com", "mala-" + i, 401);
		}

		mvc.perform(desde(post("/api/auth/login")).contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"lim1@vibora.com\",\"password\":\"%s\"}".formatted(PASSWORD)))
				.andExpect(status().isTooManyRequests())
				.andExpect(header().string("Retry-After", "900"))
				.andExpect(jsonPath("$.error").value(MENSAJE_15));
	}

	@Test
	void unEmailQueNoExisteSeBloqueaIgualQueUnoQueExiste() throws Exception {
		crearUsuario("existe2@vibora.com", Rol.JUGADOR, null);
		String conCuenta = null;
		String sinCuenta = null;
		for (String email : new String[] { "existe2@vibora.com", "fantasma2@vibora.com" }) {
			for (int i = 0; i < 5; i++) {
				login(email, "mala", 401);
			}
			MvcResult r = login(email, "mala", 429);
			assertThat(r.getResponse().getHeader("Retry-After")).isEqualTo("900");
			if (email.startsWith("existe")) {
				conCuenta = r.getResponse().getContentAsString();
			} else {
				sinCuenta = r.getResponse().getContentAsString();
			}
		}
		assertThat(conCuenta).isEqualTo(sinCuenta);
	}

	@Test
	void otroEmailDeLaMismaIpSigueRespondiendo401MientrasNoSeAlcanceElUmbralDeLaIp() throws Exception {
		for (int i = 0; i < 5; i++) {
			login("a3@vibora.com", "mala", 401);
		}
		login("a3@vibora.com", "mala", 429);

		login("b3@vibora.com", "mala", 401); // otro email: solo ha gastado su propio contador
		// la IP lleva 6 intentos admitidos (5 + 1); hasta 30 en total y el siguiente es 429
		for (int i = 0; i < 24; i++) {
			login("c3-" + i + "@vibora.com", "mala", 401);
		}
		login("d3@vibora.com", "mala", 429);
	}

	@Test
	void unLoginCorrectoReiniciaElContadorDelPar() throws Exception {
		crearUsuario("reset4@vibora.com", Rol.JUGADOR, null);
		for (int i = 0; i < 4; i++) {
			login("reset4@vibora.com", "mala", 401);
		}
		login("reset4@vibora.com", PASSWORD, 200);

		for (int i = 0; i < 5; i++) {
			login("reset4@vibora.com", "mala", 401);
		}
		login("reset4@vibora.com", "mala", 429);
	}

	@Test
	void elRechazoEs429SinHacerElHashDeLaContraseña() throws Exception {
		crearUsuario("hash5@vibora.com", Rol.JUGADOR, null);
		for (int i = 0; i < 5; i++) {
			login("hash5@vibora.com", "mala", 401);
		}
		clearInvocations(codificador);

		login("hash5@vibora.com", "mala", 429);

		verifyNoInteractions(codificador);
	}

	@Test
	void lasPeticionesInvalidasSon400YNoGastanIntentos() throws Exception {
		for (int i = 0; i < 12; i++) {
			mvc.perform(desde(post("/api/auth/login")).contentType(MediaType.APPLICATION_JSON)
					.content("{\"email\":\"\",\"password\":\"x\"}")).andExpect(status().isBadRequest());
			mvc.perform(desde(post("/api/auth/login")).contentType(MediaType.APPLICATION_JSON)
					.content("{no es json")).andExpect(status().isBadRequest());
		}
		for (int i = 0; i < 5; i++) {
			login("inv6@vibora.com", "mala", 401); // los cinco intentos siguen disponibles
		}
		login("inv6@vibora.com", "mala", 429);
	}

	@Test
	void elRegistroAdmiteDiezPorIpYElOnceavoEs429ConRetryAfterDeUnaHora() throws Exception {
		for (int i = 0; i < 10; i++) {
			registrar("reg7-" + i + "@vibora.com", 201);
		}
		mvc.perform(desde(post("/api/auth/registro")).contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"reg7-x@vibora.com\",\"password\":\"%s\",\"nombre\":\"N\",\"apellidos\":\"A\"}".formatted(PASSWORD)))
				.andExpect(status().isTooManyRequests())
				.andExpect(header().string("Retry-After", "3600"))
				.andExpect(jsonPath("$.error").value("Demasiados intentos. Inténtalo de nuevo en 60 minutos"));
	}

	@Test
	void elRegistroDeUnEmailYaRegistradoTambienCuenta_noSeEnumeraPorEsaVia() throws Exception {
		Club club = crearClub("Club limites");
		crearUsuario("dup8@vibora.com", Rol.ADMIN_CLUB, club);
		for (int i = 0; i < 10; i++) {
			registrar("dup8@vibora.com", 409);
		}
		registrar("dup8@vibora.com", 429);
	}
}
