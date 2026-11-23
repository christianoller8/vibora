package com.vibora.websocket;

import com.vibora.auth.VersionSesionValidador;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.transaction.CannotCreateTransactionException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Dos fallos del CONNECT que dependen de la BD.
 * <ul>
 * <li>Carrera con "cerrar sesion en todas partes": el decodificador acepta el token y, ANTES de que el socket quede
 * registrado, otra peticion sube la version (y su {@code expulsarDe} no ve todavia este socket). Se fuerza el orden con
 * un espia sobre {@link SesionesWs#autenticada} que sube la version justo antes de registrar; la produccion no cambia.</li>
 * <li>Fallo de la BD al comprobar la version: el cliente recibe un ERROR limpio, no una excepcion cruda.</li>
 * </ul>
 */
class WebSocketCarreraVersionTests extends WebSocketTestBase {

	@MockitoSpyBean SesionesWs sesiones;
	@MockitoSpyBean VersionSesionValidador validador;
	@Autowired JdbcTemplate jdbc;

	private static String unico(String nombre) {
		return nombre + "-" + UUID.randomUUID() + "@vibora.test";
	}

	@Test
	void siLaVersionSubeEntreLaDecodificacionYElRegistro_elConnectSeRechazaYElSocketNoQuedaRegistrado() throws Exception {
		Jug ana = jugador(unico("ana"));
		AtomicBoolean subida = new AtomicBoolean();
		doAnswer(invocacion -> {
			if (subida.compareAndSet(false, true)) {
				jdbc.update("update usuario set version_sesion = version_sesion + 1 where email = ?", ana.email());
			}
			return invocacion.callRealMethod();
		}).when(sesiones).autenticada(any(), any(), any());

		assertThat(errorDeConexionRechazada(ORIGEN_PERMITIDO, "Bearer " + ana.token())).isEqualTo("No autenticado");

		assertThat(subida).as("el espia subio la version entre decodificar y registrar").isTrue();
		long limite = System.nanoTime() + Duration.ofSeconds(10).toNanos();
		while (sesiones.cantidadDe(ana.email()) != 0) {
			assertThat(System.nanoTime()).as("el socket rechazado sigue registrado").isLessThan(limite);
			Thread.sleep(25);
		}
	}

	@Test
	void siLaBdFallaAlComprobarLaVersion_elClienteRecibeUnErrorLimpio() throws Exception {
		Jug ana = jugador(unico("ana"));
		doThrow(new DataAccessResourceFailureException("BD caida")).when(validador).validate(any());

		assertThat(errorDeConexionRechazada(ORIGEN_PERMITIDO, "Bearer " + ana.token())).isEqualTo("Servicio no disponible");
	}

	@Test
	void siLaVersionSubeEntreLaDecodificacionYElRegistro_elClienteRecibeUnSoloError() throws Exception {
		Jug ana = jugador(unico("ana"));
		AtomicBoolean subida = new AtomicBoolean();
		doAnswer(invocacion -> {
			if (subida.compareAndSet(false, true)) {
				jdbc.update("update usuario set version_sesion = version_sesion + 1 where email = ?", ana.email());
			}
			return invocacion.callRealMethod();
		}).when(sesiones).autenticada(any(), any(), any());

		assertThat(erroresDeConexionRechazada("Bearer " + ana.token())).containsExactly("No autenticado");
		assertThat(subida).as("el espia subio la version entre decodificar y registrar").isTrue();
		// el rechazo lo comunica la excepcion (un ERROR); expulsar mandaria otro ERROR y un segundo cierre
		verify(sesiones, never()).expulsar(any());
		verify(sesiones).olvidar(any()); // baja en silencio, sin esperar al cierre del transporte
		esperarRegistroVacio(ana.email());
	}

	@Test
	void siLaBdSeCaeEnLaSegundaComprobacion_unSoloErrorLimpioYElSocketNoQuedaRegistrado() throws Exception {
		Jug ana = jugador(unico("ana"));
		AtomicInteger llamadas = new AtomicInteger();
		doAnswer(invocacion -> {
			if (llamadas.incrementAndGet() == 2) {
				// una caida real de la BD sale de la transaccion del repositorio: TransactionException, no DataAccessException
				throw new CannotCreateTransactionException("BD caida");
			}
			return invocacion.callRealMethod();
		}).when(validador).validate(any());

		assertThat(erroresDeConexionRechazada("Bearer " + ana.token())).containsExactly("Servicio no disponible");
		assertThat(llamadas.get()).as("la segunda llamada es la recomprobacion tras registrar").isGreaterThanOrEqualTo(2);
		verify(sesiones).olvidar(any()); // baja en silencio, sin esperar al cierre del transporte
		esperarRegistroVacio(ana.email());
	}

	/** Conecta esperando rechazo y devuelve TODOS los ERROR recibidos (se deja un margen para detectar un segundo). */
	private List<String> erroresDeConexionRechazada(String autorizacion) throws Exception {
		Escucha escucha = new Escucha();
		CompletableFuture<StompSession> intento = cliente.connectAsync(url(), cabecerasHandshake(ORIGEN_PERMITIDO),
				cabecerasConnect(autorizacion), escucha);
		assertThatThrownBy(() -> intento.get(ESPERA_SEGUNDOS, TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class);
		String primero = escucha.errores.poll(2, TimeUnit.SECONDS);
		Thread.sleep(1500);
		List<String> todos = new ArrayList<>();
		if (primero != null) {
			todos.add(primero);
		}
		escucha.errores.drainTo(todos);
		return todos;
	}

	private void esperarRegistroVacio(String email) throws InterruptedException {
		long limite = System.nanoTime() + Duration.ofSeconds(10).toNanos();
		while (sesiones.cantidadDe(email) != 0) {
			assertThat(System.nanoTime()).as("el socket rechazado sigue registrado").isLessThan(limite);
			Thread.sleep(25);
		}
	}
}
