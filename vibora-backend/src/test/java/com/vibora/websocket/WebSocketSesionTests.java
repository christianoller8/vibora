package com.vibora.websocket;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import java.time.Duration;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * "Cerrar sesion en todos los dispositivos" tambien alcanza al WebSocket: un token anterior a la revocacion no conecta (el
 * CONNECT usa el mismo decodificador que la API REST, que compara el claim ver) y los sockets ya abiertos de la persona se
 * cierran enseguida (ERROR "No autenticado" + cierre), sin esperar a que caduque su token. Los de otras personas no se tocan.
 */
class WebSocketSesionTests extends WebSocketTestBase {

	@Autowired SesionesWs sesiones;

	private static String unico(String nombre) {
		return nombre + "-" + java.util.UUID.randomUUID() + "@vibora.test";
	}

	private int cerrarSesionTodas(Jug j) throws Exception {
		return mvc.perform(post("/api/auth/cerrar-sesion-todas").header("Authorization", "Bearer " + j.token())
				.contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse().getStatus();
	}

	private static void esperar(String que, BooleanSupplier condicion) throws InterruptedException {
		long limite = System.nanoTime() + Duration.ofSeconds(10).toNanos();
		while (!condicion.getAsBoolean()) {
			assertThat(System.nanoTime()).as("no ocurrio a tiempo: %s", que).isLessThan(limite);
			Thread.sleep(25);
		}
	}

	@Test
	void unTokenAnteriorALaRevocacion_noPuedeConectar_peroUnoNuevoSi() throws Exception {
		Jug ana = jugador(unico("ana"));
		assertThat(cerrarSesionTodas(ana)).isEqualTo(204);

		assertThat(errorDeConexionRechazada(ORIGEN_PERMITIDO, "Bearer " + ana.token())).isEqualTo("No autenticado");

		Jug nueva = new Jug(ana.id(), ana.email(), login(ana.email()));
		assertThat(conectarYSuscribir(nueva).sesion().isConnected()).isTrue();
	}

	@Test
	void alCerrarSesionTodas_losSocketsAbiertosDeEsaPersonaSeCierranEnseguida_yLosDeOtrosNo() throws Exception {
		Jug ana = jugador(unico("ana"));
		Jug beto = jugador(unico("beto"));
		Conexion deAna1 = conectarYSuscribir(ana);
		Conexion deAna2 = conectarYSuscribir(ana);
		Conexion deBeto = conectarYSuscribir(beto);
		assertThat(sesiones.cantidadDe(ana.email())).isEqualTo(2);

		assertThat(cerrarSesionTodas(ana)).isEqualTo(204);

		assertThat(deAna1.escucha().errores.poll(ESPERA_SEGUNDOS, java.util.concurrent.TimeUnit.SECONDS))
				.as("el cliente es avisado antes del cierre").isEqualTo("No autenticado");
		esperar("cierre de la primera sesion de ana", () -> !deAna1.sesion().isConnected());
		esperar("cierre de la segunda sesion de ana", () -> !deAna2.sesion().isConnected());
		esperar("limpieza del registro", () -> sesiones.cantidadDe(ana.email()) == 0);
		assertThat(deBeto.sesion().isConnected()).as("el socket de otra persona sigue abierto").isTrue();
		assertThat(sesiones.cantidadDe(beto.email())).isEqualTo(1);
	}
}
