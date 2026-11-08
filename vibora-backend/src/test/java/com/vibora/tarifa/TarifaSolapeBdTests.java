package com.vibora.tarifa;

import com.vibora.PostgresTestBase;
import com.vibora.TestData;
import com.vibora.club.Club;
import com.vibora.club.ClubRepository;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.reset;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * La restriccion tarifa_sin_solape (V7) es la ultima defensa: con la comprobacion amable del servicio esquivada (o con
 * dos peticiones simultaneas) una de las franjas solapadas falla con el mismo 409 amable. No es @Transactional: commits
 * reales y limpieza en @AfterEach.
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
@AutoConfigureMockMvc
class TarifaSolapeBdTests extends PostgresTestBase {

	private static final String SOLAPE = "La franja se solapa con otra del mismo día";

	@Autowired MockMvc mvc;
	@Autowired ClubRepository clubs;
	@Autowired UsuarioRepository usuarios;
	@Autowired PasswordEncoder passwordEncoder;
	@MockitoSpyBean TarifaFranjaRepository tarifas;

	private Club club;
	private String token;

	@BeforeEach
	void crearDatos() throws Exception {
		club = clubs.saveAndFlush(TestData.club());
		Usuario admin = TestData.usuario("admin-tarifa-bd@vibora.com", Rol.ADMIN_CLUB, club);
		admin.setPasswordHash(passwordEncoder.encode("contraseña-segura"));
		usuarios.saveAndFlush(admin);
		String cuerpo = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"admin-tarifa-bd@vibora.com\",\"password\":\"contraseña-segura\"}"))
				.andReturn().getResponse().getContentAsString();
		Matcher m = Pattern.compile("\"token\":\"([^\"]+)\"").matcher(cuerpo);
		assertThat(m.find()).as("login: %s", cuerpo).isTrue();
		token = "Bearer " + m.group(1);
	}

	@AfterEach
	void limpiar() {
		reset(tarifas);
		tarifas.deleteAllInBatch();
		usuarios.deleteAllInBatch();
		clubs.deleteAllInBatch();
	}

	private static String lunes(String ini, String fin) {
		return "{\"diaSemana\":\"MONDAY\",\"horaInicio\":\"%s\",\"horaFin\":\"%s\",\"precioHora\":12.50,\"tipo\":\"NORMAL\"}"
				.formatted(ini, fin);
	}

	private int crear(String cuerpo) throws Exception {
		return mvc.perform(post("/api/clubes/" + club.getId() + "/tarifas").header("Authorization", token)
				.contentType(MediaType.APPLICATION_JSON).content(cuerpo)).andReturn().getResponse().getStatus();
	}

	@Test
	void laRestriccionDeLaBdSeTraduceAlMismoConflictoAmable_cuandoLaComprobacionPreviaNoVeNada() throws Exception {
		assertThat(crear(lunes("18:00", "20:00"))).isLessThan(300);
		// la comprobacion amable "no ve" la franja existente: solo queda la restriccion de la BD
		doReturn(List.of()).when(tarifas).findByClubIdAndDiaSemana(anyLong(), any());

		mvc.perform(post("/api/clubes/" + club.getId() + "/tarifas").header("Authorization", token)
						.contentType(MediaType.APPLICATION_JSON).content(lunes("19:00", "21:00")))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error").value(SOLAPE));

		assertThat(tarifas.count()).isEqualTo(1);
	}

	@Test
	void franjasAdyacentesSiSePermiten() throws Exception {
		assertThat(crear(lunes("18:00", "20:00"))).isLessThan(300);
		assertThat(crear(lunes("20:00", "22:00"))).isLessThan(300);
		assertThat(tarifas.count()).isEqualTo(2);
	}

	@RepeatedTest(3)
	void dosAltasSimultaneasSolapadas_terminanEnUnaFranjaYUnConflicto() throws Exception {
		CyclicBarrier salida = new CyclicBarrier(2);
		ExecutorService pool = Executors.newFixedThreadPool(2);
		try {
			List<Callable<Integer>> tareas = new ArrayList<>();
			for (String[] horas : new String[][] { { "18:00", "20:00" }, { "19:00", "21:00" } }) {
				tareas.add(() -> {
					salida.await();
					return crear(lunes(horas[0], horas[1]));
				});
			}
			List<Integer> estados = new ArrayList<>();
			for (Future<Integer> f : pool.invokeAll(tareas)) {
				estados.add(f.get());
			}
			assertThat(estados.stream().filter(s -> s < 300)).hasSize(1);
			assertThat(estados.stream().filter(s -> s == 409)).hasSize(1);
			assertThat(tarifas.count()).isEqualTo(1);
		} finally {
			pool.shutdownNow();
		}
	}
}
