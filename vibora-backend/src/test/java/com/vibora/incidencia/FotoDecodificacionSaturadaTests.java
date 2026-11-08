package com.vibora.incidencia;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;

/** Con UN solo permiso y 300 ms de espera: la segunda subida recibe 503 limpio; el permiso se libera siempre (tambien con OOM). */
@TestPropertySource(properties = { "vibora.almacen.decodificaciones-simultaneas=1", "vibora.almacen.espera-decodificacion=300ms" })
class FotoDecodificacionSaturadaTests extends IncidenciaSinTransaccionBase {

	static final Path CARPETA = AlmacenDeTest.carpeta("vibora-test-saturada-");
	static final String MENSAJE = "El servidor está procesando otras imágenes, inténtalo de nuevo en unos segundos";

	@DynamicPropertySource
	static void propiedades(DynamicPropertyRegistry registro) {
		registro.add("vibora.almacen.directorio", CARPETA::toString);
	}

	@MockitoSpyBean DecodificadorImagenes decodificador;

	@AfterEach
	void limpiarFicheros() {
		AlmacenDeTest.vaciar(CARPETA);
	}

	private org.springframework.mock.web.MockHttpServletResponse subir(long incidencia) throws Exception {
		return mvc.perform(multipart("/api/incidencias/" + incidencia + "/fotos")
						.file(new MockMultipartFile("file", "a.png", "image/png", Imagenes.png(16, 16, true)))
						.header("Authorization", jugador.token()))
				.andReturn().getResponse();
	}

	@Test
	void conElPermisoOcupado_503ConSuMensaje_yDespuesElPermisoSeLibera() throws Exception {
		long a = incidenciaDe(jugador, "Red A");
		long b = incidenciaDe(jugador, "Red B");
		CountDownLatch dentro = new CountDownLatch(1);
		AtomicBoolean lenta = new AtomicBoolean(true);
		doAnswer(inv -> {
			if (lenta.compareAndSet(true, false)) {
				dentro.countDown();
				Thread.sleep(1500);
			}
			return inv.callRealMethod();
		}).when(decodificador).decodificar(any());

		CompletableFuture<Integer> primera = CompletableFuture.supplyAsync(() -> {
			try {
				return subir(a).getStatus();
			} catch (Exception e) {
				throw new IllegalStateException(e);
			}
		});
		assertThat(dentro.await(10, TimeUnit.SECONDS)).isTrue();

		var rechazada = subir(b);
		assertThat(rechazada.getStatus()).isEqualTo(503);
		assertThat(rechazada.getContentAsString()).contains(MENSAJE);
		assertThat(fotos.countByIncidenciaId(b)).isZero();

		assertThat(primera.get(20, TimeUnit.SECONDS)).isEqualTo(201);
		assertThat(subir(b).getStatus()).as("el permiso se libero").isEqualTo(201);
	}

	@Test
	void unOutOfMemoryDuranteLaDecodificacion_503_sinTumbarNada_yElPermisoSeLibera() throws Exception {
		long a = incidenciaDe(jugador, "Red OOM");
		AtomicBoolean primera = new AtomicBoolean(true);
		doAnswer(inv -> {
			if (primera.compareAndSet(true, false)) {
				throw new OutOfMemoryError("simulado");
			}
			return inv.callRealMethod();
		}).when(decodificador).decodificar(any());

		var fallida = subir(a);
		assertThat(fallida.getStatus()).isEqualTo(503);
		assertThat(fallida.getContentAsString()).contains(MENSAJE);

		assertThat(subir(a).getStatus()).as("sigue funcionando y el permiso esta libre").isEqualTo(201);
	}

	@Test
	void unaImagenInvalidaTambienLiberaElPermiso() throws Exception {
		long a = incidenciaDe(jugador, "Red invalida");
		var mala = mvc.perform(multipart("/api/incidencias/" + a + "/fotos")
						.file(new MockMultipartFile("file", "a.png", "image/png", new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }))
						.header("Authorization", jugador.token()))
				.andReturn().getResponse();
		assertThat(mala.getStatus()).isEqualTo(400);

		assertThat(subir(a).getStatus()).isEqualTo(201);
	}
}
