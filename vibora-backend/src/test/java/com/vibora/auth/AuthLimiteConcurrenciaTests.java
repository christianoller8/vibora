package com.vibora.auth;

import com.vibora.PostgresTestBase;
import com.vibora.TestData;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 20 logins fallidos SIMULTANEOS del mismo (IP, email), sin transaccion de test. Garantia del limitador: los intentos se
 * cuentan al admitirlos (bajo un monitor), asi que se procesan EXACTAMENTE 5 (los 5 son 401) y los otros 15 son 429.
 */
@SpringBootTest(properties = { "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!",
		"vibora.seguridad.login-max-por-email=5", "vibora.seguridad.login-max-por-ip=30" })
@AutoConfigureMockMvc
class AuthLimiteConcurrenciaTests extends PostgresTestBase {

	private static final AtomicInteger REPETICION = new AtomicInteger();

	@Autowired MockMvc mvc;
	@Autowired UsuarioRepository usuarios;
	@Autowired PasswordEncoder passwordEncoder;

	@RepeatedTest(3)
	void veinteFallosSimultaneosDelMismoParAdmitenExactamenteCinco() throws Exception {
		int n = REPETICION.incrementAndGet();
		String email = "conc" + n + "@vibora.com";
		String ip = "10.88.0." + n;
		Usuario u = TestData.usuario(email, Rol.JUGADOR, null);
		u.setPasswordHash(passwordEncoder.encode("la-buena-123"));
		usuarios.saveAndFlush(u);
		try {
			int hilos = 20;
			ExecutorService pool = Executors.newFixedThreadPool(hilos);
			CountDownLatch salida = new CountDownLatch(1);
			AtomicInteger noAutorizados = new AtomicInteger();
			AtomicInteger limitados = new AtomicInteger();
			List<Future<?>> futuros = new ArrayList<>();
			for (int i = 0; i < hilos; i++) {
				futuros.add(pool.submit(() -> {
					salida.await();
					int estado = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
							.content("{\"email\":\"%s\",\"password\":\"mala\"}".formatted(email))
							.with(r -> {
								r.setRemoteAddr(ip);
								return r;
							})).andReturn().getResponse().getStatus();
					if (estado == 401) {
						noAutorizados.incrementAndGet();
					} else if (estado == 429) {
						limitados.incrementAndGet();
					}
					return null;
				}));
			}
			salida.countDown();
			for (Future<?> f : futuros) {
				f.get();
			}
			pool.shutdown();

			assertThat(noAutorizados.get()).as("procesados como 401").isEqualTo(5);
			assertThat(limitados.get()).as("rechazados con 429").isEqualTo(15);
		} finally {
			usuarios.delete(usuarios.findByEmail(email).orElseThrow());
		}
	}
}
