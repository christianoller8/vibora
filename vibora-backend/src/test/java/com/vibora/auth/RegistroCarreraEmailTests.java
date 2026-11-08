package com.vibora.auth;

import com.vibora.PostgresTestBase;
import com.vibora.usuario.UsuarioRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.reset;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Carrera en el registro: aunque la comprobacion previa (existsByEmail) no vea al otro registro, el unico de la BD
 * (usuario_email_uk / usuario_email_lower_uk) lo para y el cliente recibe el 409 amable, nunca un 500. Sin
 * transaccion de test: commits reales.
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
@AutoConfigureMockMvc
class RegistroCarreraEmailTests extends PostgresTestBase {

	private static final String YA_REGISTRADO = "El email ya está registrado";

	@Autowired MockMvc mvc;
	@MockitoSpyBean UsuarioRepository usuarios;

	@AfterEach
	void limpiar() {
		reset(usuarios);
		usuarios.deleteAllInBatch();
	}

	private static String cuerpo(String email) {
		return "{\"email\":\"%s\",\"password\":\"contraseña-segura\",\"nombre\":\"Ana\",\"apellidos\":\"García\"}"
				.formatted(email);
	}

	private int registrar(String email) throws Exception {
		return mvc.perform(post("/api/auth/registro").contentType(MediaType.APPLICATION_JSON).content(cuerpo(email)))
				.andReturn().getResponse().getStatus();
	}

	@Test
	void conLaComprobacionPreviaEsquivada_laVarianteConOtraCapitalizacionEsUn409Amable() throws Exception {
		assertThat(registrar("carrera@vibora.com")).isEqualTo(201);
		doReturn(false).when(usuarios).existsByEmail(anyString());

		mvc.perform(post("/api/auth/registro").contentType(MediaType.APPLICATION_JSON).content(cuerpo("CARRERA@Vibora.com")))
				.andExpect(status().isConflict())
				.andExpect(jsonPath("$.error").value(YA_REGISTRADO));
		assertThat(usuarios.count()).isEqualTo(1);
	}

	@RepeatedTest(3)
	void dosRegistrosSimultaneosDelMismoEmailConVariantes_unoCreadoYElOtroConflicto_sinErrores500() throws Exception {
		CyclicBarrier salida = new CyclicBarrier(2);
		ExecutorService pool = Executors.newFixedThreadPool(2);
		try {
			List<Callable<Integer>> tareas = new ArrayList<>();
			for (String email : new String[] { "Simultaneo@Vibora.com", "simultaneo@vibora.com" }) {
				tareas.add(() -> {
					salida.await();
					return registrar(email);
				});
			}
			List<Integer> estados = new ArrayList<>();
			for (Future<Integer> f : pool.invokeAll(tareas)) {
				estados.add(f.get());
			}
			assertThat(estados).containsExactlyInAnyOrder(201, 409);
			assertThat(usuarios.count()).isEqualTo(1);
		} finally {
			pool.shutdownNow();
		}
	}
}
