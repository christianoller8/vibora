package com.vibora.auth;

import com.vibora.PostgresTestBase;
import com.vibora.TestData;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 12 refrescos SIMULTANEOS con el MISMO token, sin transaccion de test (commits reales): como mucho uno puede ganar la
 * rotacion. Los demas perdieron la carrera, lo que cuenta como reutilizacion: se revoca la familia entera (tambien el token
 * nuevo que entrego el ganador, que no deberia seguir sirviendo).
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
@AutoConfigureMockMvc
class SesionRefrescoConcurrenciaTests extends PostgresTestBase {

	private static final AtomicInteger REPETICION = new AtomicInteger();

	@Autowired MockMvc mvc;
	@Autowired UsuarioRepository usuarios;
	@Autowired PasswordEncoder passwordEncoder;
	@Autowired JdbcTemplate jdbc;

	@RepeatedTest(5)
	void dosOMasRefrescosConElMismoTokenSoloDejanPasarUno_yLaFamiliaQuedaRevocada() throws Exception {
		int n = REPETICION.incrementAndGet();
		String email = "refresco-conc" + n + "@vibora.com";
		Usuario u = TestData.usuario(email, Rol.JUGADOR, null);
		u.setPasswordHash(passwordEncoder.encode("la-buena-123"));
		usuarios.saveAndFlush(u);
		try {
			String set = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
					.content("{\"email\":\"%s\",\"password\":\"la-buena-123\"}".formatted(email)))
					.andReturn().getResponse().getHeader("Set-Cookie");
			Matcher m = Pattern.compile("vibora_refresco=([^;]*)").matcher(set);
			assertThat(m.find()).isTrue();
			String token = m.group(1);

			int hilos = 12;
			ExecutorService pool = Executors.newFixedThreadPool(hilos);
			CountDownLatch salida = new CountDownLatch(1);
			AtomicInteger correctos = new AtomicInteger();
			AtomicInteger rechazados = new AtomicInteger();
			List<Future<?>> futuros = new ArrayList<>();
			for (int i = 0; i < hilos; i++) {
				futuros.add(pool.submit(() -> {
					salida.await();
					int estado = mvc.perform(post("/api/auth/refrescar").cookie(new Cookie("vibora_refresco", token)))
							.andReturn().getResponse().getStatus();
					if (estado == 200) {
						correctos.incrementAndGet();
					} else if (estado == 401) {
						rechazados.incrementAndGet();
					}
					return null;
				}));
			}
			salida.countDown();
			for (Future<?> f : futuros) {
				f.get();
			}
			pool.shutdown();

			assertThat(correctos.get()).as("refrescos con exito").isEqualTo(1);
			assertThat(rechazados.get()).as("rechazados con 401").isEqualTo(hilos - 1);
			Long usuarioId = u.getId();
			assertThat(jdbc.queryForObject("select count(*) from sesion_refresco where usuario_id = ? and revocado_en is null",
					Long.class, usuarioId)).as("la familia entera queda revocada tras perder la carrera").isZero();
			assertThat(jdbc.queryForObject("select count(*) from sesion_refresco where usuario_id = ?", Long.class, usuarioId))
					.isEqualTo(2);
		} finally {
			usuarios.delete(usuarios.findByEmail(email).orElseThrow()); // las filas de sesion_refresco caen en cascada
		}
	}
}
