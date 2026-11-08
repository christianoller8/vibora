package com.vibora.websocket;

import com.vibora.RelojMutable;
import com.vibora.RelojTestConfig;
import com.vibora.auth.JwtService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.time.Duration;
import java.util.UUID;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;

/** Tope de sesiones STOMP simultaneas por persona (aqui 3; por defecto 10): la que lo supera recibe ERROR y se cierra. */
@Import(RelojTestConfig.class)
@TestPropertySource(properties = { "vibora.websocket.max-sesiones-por-usuario=3", "vibora.websocket.intervalo-barrido=PT1H" })
class WebSocketLimiteSesionesTests extends WebSocketTestBase {

	static final String DEMASIADAS = "Demasiadas conexiones";

	@Autowired SesionesWs sesiones;
	@Autowired RelojMutable reloj;
	@Autowired JwtService jwtService;

	@AfterEach
	void restaurarReloj() {
		reloj.fijar(RelojTestConfig.AHORA_INICIAL);
	}

	private static String unico(String nombre) {
		return nombre + "-" + UUID.randomUUID() + "@vibora.test";
	}

	private static void esperar(String que, BooleanSupplier condicion) throws InterruptedException {
		long limite = System.nanoTime() + Duration.ofSeconds(10).toNanos();
		while (!condicion.getAsBoolean()) {
			assertThat(System.nanoTime()).as("no ocurrio a tiempo: %s", que).isLessThan(limite);
			Thread.sleep(25);
		}
	}

	@Test
	void laCuartaSesionDelMismoUsuarioRecibeErrorYSeCierra_lasTresPrimerasSiguenVivas() throws Exception {
		Jug ana = jugador(unico("ana"));
		var uno = conectarYSuscribir(ana);
		var dos = conectarYSuscribir(ana);
		var tres = conectarYSuscribir(ana);
		assertThat(sesiones.cantidadDe(ana.email())).isEqualTo(3);

		String error = errorDeConexionRechazada(ORIGEN_PERMITIDO, "Bearer " + ana.token());

		assertThat(error).isEqualTo(DEMASIADAS);
		esperar("la rechazada sale del registro", () -> sesiones.cantidadDe(ana.email()) == 3);
		assertThat(uno.sesion().isConnected() && dos.sesion().isConnected() && tres.sesion().isConnected()).isTrue();
	}

	@Test
	void alDesconectarse_liberaElHueco() throws Exception {
		Jug ana = jugador(unico("ana"));
		var uno = conectarYSuscribir(ana);
		conectarYSuscribir(ana);
		conectarYSuscribir(ana);
		assertThat(errorDeConexionRechazada(ORIGEN_PERMITIDO, "Bearer " + ana.token())).isEqualTo(DEMASIADAS);

		uno.sesion().disconnect();
		esperar("baja en el registro", () -> sesiones.cantidadDe(ana.email()) == 2);

		conectarYSuscribir(ana); // ahora si cabe
		assertThat(sesiones.cantidadDe(ana.email())).isEqualTo(3);
	}

	@Test
	void lasSesionesDeOtrasPersonasNoSeVenAfectadas() throws Exception {
		Jug ana = jugador(unico("ana"));
		Jug beto = jugador(unico("beto"));
		for (int i = 0; i < 3; i++) {
			conectarYSuscribir(ana);
		}
		assertThat(errorDeConexionRechazada(ORIGEN_PERMITIDO, "Bearer " + ana.token())).isEqualTo(DEMASIADAS);

		conectarYSuscribir(beto);
		conectarYSuscribir(beto);
		assertThat(sesiones.cantidadDe(beto.email())).isEqualTo(2);
	}

	@Test
	void unaSesionCaducada_nuncaCuentaParaElTope_yElBarridoLaQuitaDelRegistro() throws Exception {
		Jug ana = jugador(unico("ana"));
		for (int i = 0; i < 3; i++) {
			conectarYSuscribir(ana);
		}
		reloj.fijar(jwtService.decodificar(ana.token()).getExpiresAt().plusSeconds(1)); // las tres caducan
		Jug anaDeNuevo = new Jug(ana.id(), ana.email(), login(ana.email())); // token nuevo, vigente con el reloj actual

		conectarYSuscribir(anaDeNuevo); // aun sin barrido: las caducadas no ocupan hueco

		sesiones.barrer();
		esperar("las tres caducadas se van", () -> sesiones.cantidadDe(ana.email()) == 1);
		conectarYSuscribir(anaDeNuevo);
		conectarYSuscribir(anaDeNuevo);
		assertThat(errorDeConexionRechazada(ORIGEN_PERMITIDO, "Bearer " + anaDeNuevo.token())).isEqualTo(DEMASIADAS);
	}
}
