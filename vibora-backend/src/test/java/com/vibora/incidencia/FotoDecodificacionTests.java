package com.vibora.incidencia;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import javax.sql.DataSource;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/**
 * Decodificacion de imagenes acotada y fuera de la transaccion: como mucho 2 a la vez, ninguna con una transaccion ni una
 * conexion de BD retenida, y nada se decodifica antes de comprobar que la persona puede ver la incidencia.
 */
@TestPropertySource(properties = { "vibora.almacen.decodificaciones-simultaneas=2" })
class FotoDecodificacionTests extends IncidenciaSinTransaccionBase {

	static final Path CARPETA = AlmacenDeTest.carpeta("vibora-test-decodificacion-");

	@DynamicPropertySource
	static void propiedades(DynamicPropertyRegistry registro) {
		registro.add("vibora.almacen.directorio", CARPETA::toString);
	}

	@MockitoSpyBean DecodificadorImagenes decodificador;
	@Autowired DataSource dataSource;

	@AfterEach
	void limpiarFicheros() {
		AlmacenDeTest.vaciar(CARPETA);
	}

	private int subir(Persona p, long incidencia) throws Exception {
		return mvc.perform(multipart("/api/incidencias/" + incidencia + "/fotos")
						.file(new MockMultipartFile("file", "a.png", "image/png", Imagenes.png(16, 16, true)))
						.header("Authorization", p.token()))
				.andReturn().getResponse().getStatus();
	}

	@RepeatedTest(3)
	void seisSubidasALaVez_nuncaMasDeDosDecodificacionesSimultaneas_yTodasTerminan() throws Exception {
		List<Long> incidencias = new ArrayList<>();
		for (int i = 0; i < 6; i++) {
			incidencias.add(incidenciaDe(i < 3 ? jugador : admin, "Red " + i)); // maximo 5 abiertas por persona
		}
		AtomicInteger enCurso = new AtomicInteger();
		AtomicInteger maximo = new AtomicInteger();
		doAnswer(inv -> {
			maximo.accumulateAndGet(enCurso.incrementAndGet(), Math::max);
			try {
				Thread.sleep(200);
				return inv.callRealMethod();
			} finally {
				enCurso.decrementAndGet();
			}
		}).when(decodificador).decodificar(any());

		List<Callable<Integer>> tareas = new ArrayList<>();
		for (long incidencia : incidencias) {
			tareas.add(() -> subir(admin, incidencia)); // el admin ve todas
		}
		List<Integer> estados = lanzarALaVez(tareas);

		assertThat(estados).as("estados").containsOnly(201);
		assertThat(maximo.get()).as("decodificaciones simultaneas").isEqualTo(2);
	}

	@Test
	void ladecodificacionNoRetieneNiTransaccionNiConexion() throws Exception {
		long incidencia = incidenciaDe(jugador, "Red sin conexion");
		AtomicReference<String> observado = new AtomicReference<>("no se llamo");
		HikariDataSource hikari = dataSource.unwrap(HikariDataSource.class);
		doAnswer(inv -> {
			observado.set("transaccion=" + TransactionSynchronizationManager.isActualTransactionActive()
					+ " conexionesActivas=" + hikari.getHikariPoolMXBean().getActiveConnections());
			return inv.callRealMethod();
		}).when(decodificador).decodificar(any());

		assertThat(subir(jugador, incidencia)).isEqualTo(201);

		assertThat(observado.get()).isEqualTo("transaccion=false conexionesActivas=0");
	}

	@Test
	void sinPermisoNoSeDecodificaNada_404ySiEstaCerradaTampoco_409() throws Exception {
		long incidencia = incidenciaDe(jugador, "Red ajena");
		Persona otro = persona("otro-jugador@vibora.com", com.vibora.usuario.Rol.JUGADOR, null);
		AtomicInteger decodificaciones = new AtomicInteger();
		doAnswer(inv -> {
			decodificaciones.incrementAndGet();
			return inv.callRealMethod();
		}).when(decodificador).decodificar(any());

		assertThat(subir(otro, incidencia)).as("sin permiso").isEqualTo(404);
		assertThat(decodificaciones.get()).isZero();

		assertThat(rechazar(admin, incidencia)).isEqualTo(200);
		assertThat(subir(jugador, incidencia)).as("incidencia terminal").isEqualTo(409);
		assertThat(decodificaciones.get()).isZero();

		long abierta = incidenciaDe(jugador, "Red abierta");
		assertThat(subir(jugador, abierta)).isEqualTo(201);
		assertThat(decodificaciones.get()).isEqualTo(1);
	}
}
