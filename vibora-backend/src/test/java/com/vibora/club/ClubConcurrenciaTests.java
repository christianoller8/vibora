package com.vibora.club;

import com.vibora.PostgresTestBase;
import com.vibora.TestData;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Alta de club con commits REALES (no @Transactional): varias peticiones simultaneas del MISMO jugador sin club deben
 * crear exactamente un club. Los datos se confirman al crearlos y se borran en @AfterEach.
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
@AutoConfigureMockMvc
class ClubConcurrenciaTests extends PostgresTestBase {

	private static final String PASSWORD = "contraseña-segura";
	private static final String CUERPO = """
			{"nombre":"Club Carrera","direccion":"Calle 1","ciudad":"Madrid","horaApertura":"08:00","horaCierre":"22:00"}
			""";

	@Autowired MockMvc mvc;
	@Autowired ClubRepository clubs;
	@Autowired UsuarioRepository usuarios;
	@Autowired PasswordEncoder passwordEncoder;

	@AfterEach
	void limpiar() {
		usuarios.deleteAllInBatch();
		clubs.deleteAllInBatch();
	}

	private String jugadorSinClub(String email) throws Exception {
		Usuario u = TestData.usuario(email, Rol.JUGADOR, null);
		u.setPasswordHash(passwordEncoder.encode(PASSWORD));
		usuarios.saveAndFlush(u);
		String cuerpo = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
						.content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, PASSWORD)))
				.andReturn().getResponse().getContentAsString();
		Matcher m = Pattern.compile("\"token\":\"([^\"]+)\"").matcher(cuerpo);
		assertThat(m.find()).as("login: %s", cuerpo).isTrue();
		return "Bearer " + m.group(1);
	}

	private int crear(String token) throws Exception {
		return mvc.perform(post("/api/clubes").header("Authorization", token)
						.contentType(MediaType.APPLICATION_JSON).content(CUERPO))
				.andReturn().getResponse().getStatus();
	}

	@RepeatedTest(3)
	void ochoAltasSimultaneasDelMismoJugador_creanUnSoloClub() throws Exception {
		String token = jugadorSinClub("carrera@vibora.com");
		long clubesAntes = clubs.count();

		List<Callable<Integer>> tareas = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			tareas.add(() -> crear(token));
		}
		List<Integer> estados = lanzarALaVez(tareas);

		assertThat(estados.stream().filter(s -> s == 201).count()).as("estados: %s", estados).isEqualTo(1);
		assertThat(estados.stream().filter(s -> s == 409).count()).as("estados: %s", estados).isEqualTo(7);
		assertThat(clubs.count() - clubesAntes).isEqualTo(1);
		Usuario u = usuarios.findByEmail("carrera@vibora.com").orElseThrow();
		assertThat(u.getRol()).isEqualTo(Rol.ADMIN_CLUB);
		assertThat(u.getClub()).isNotNull();
	}

	@Test
	void dosAltasSecuenciales_laSegundaEs409() throws Exception {
		String token = jugadorSinClub("secuencial@vibora.com");

		assertThat(crear(token)).isEqualTo(201);
		assertThat(crear(token)).isEqualTo(409);
		assertThat(clubs.count()).isEqualTo(1);
	}

	private static <T> List<T> lanzarALaVez(List<Callable<T>> tareas) throws Exception {
		CyclicBarrier salida = new CyclicBarrier(tareas.size());
		ExecutorService pool = Executors.newFixedThreadPool(tareas.size());
		try {
			List<Future<T>> futuros = new ArrayList<>();
			for (Callable<T> tarea : tareas) {
				futuros.add(pool.submit(() -> {
					salida.await(30, TimeUnit.SECONDS);
					return tarea.call();
				}));
			}
			List<T> resultados = new ArrayList<>();
			for (Future<T> f : futuros) {
				resultados.add(f.get(60, TimeUnit.SECONDS));
			}
			return resultados;
		} finally {
			pool.shutdownNow();
		}
	}
}
