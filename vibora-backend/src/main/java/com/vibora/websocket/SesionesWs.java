package com.vibora.websocket;

import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.handler.WebSocketHandlerDecoratorFactory;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * Registro de los WebSockets abiertos y de cuando caduca el JWT con el que se autentico cada uno. El JWT solo se
 * valida en el frame CONNECT; sin esto, un socket abierto seguiria recibiendo avisos para siempre aunque su token
 * hubiera caducado (y aunque el usuario hubiera cerrado sesion en otro sitio). Una sesion cuyo token caducó:
 * <ul>
 * <li>no recibe ningun mensaje mas (lo descarta {@link SalidaStompInterceptor} en el canal de salida);</li>
 * <li>recibe un ERROR "No autenticado" (el frontend lo trata como sesion caducada) y se cierra con
 * {@link CloseStatus#POLICY_VIOLATION};</li>
 * <li>se barre periodicamente ({@link #barrer()}), aunque no haya llegado ningun aviso.</li>
 * </ul>
 * Las entradas se crean al abrirse el WebSocket y se borran al cerrarse (limpio o no), asi que no hay fugas.
 */
@Slf4j
@Component
public class SesionesWs {

	private final Clock reloj;
	private final MessageChannel salida;
	private final ConcurrentMap<String, Entrada> sesiones = new ConcurrentHashMap<>();

	/** {@code caduca} y {@code usuario} son nulos hasta que el CONNECT autentica la sesion. */
	private record Entrada(WebSocketSession sesion, String usuario, Instant caduca, boolean expulsada) {
	}

	private final int maxPorUsuario;

	public SesionesWs(Clock reloj, @Lazy @Qualifier("clientOutboundChannel") MessageChannel salida,
			@org.springframework.beans.factory.annotation.Value("${vibora.websocket.max-sesiones-por-usuario:10}") int maxPorUsuario) {
		this.reloj = reloj;
		this.salida = salida;
		this.maxPorUsuario = Math.max(1, maxPorUsuario);
	}

	// ---- ciclo de vida (lo alimentan el decorador del handler y el interceptor de entrada) ----

	/** Decorador que apunta cada WebSocket al abrirse y lo borra al cerrarse, sea cual sea el motivo. */
	public WebSocketHandlerDecoratorFactory decoradorDeHandler() {
		return (WebSocketHandler handler) -> new WebSocketHandlerDecorator(handler) {
			@Override
			public void afterConnectionEstablished(WebSocketSession sesion) throws Exception {
				sesiones.put(sesion.getId(), new Entrada(sesion, null, null, false));
				super.afterConnectionEstablished(sesion);
			}

			@Override
			public void afterConnectionClosed(WebSocketSession sesion, CloseStatus estado) throws Exception {
				try {
					super.afterConnectionClosed(sesion, estado);
				} finally {
					sesiones.remove(sesion.getId());
				}
			}
		};
	}

	/**
	 * El CONNECT valido el token: se apunta de quien es la sesion y cuando caduca. Antes se comprueba el tope de
	 * sesiones simultaneas de esa persona (vibora.websocket.max-sesiones-por-usuario, 10 por defecto): las demas sesiones
	 * suyas VIGENTES (ni caducadas ni ya expulsadas) cuentan; si ya estan todas ocupadas, el CONNECT se rechaza con un ERROR
	 * "Demasiadas conexiones" y se cierra. Comprobar y apuntar es atomico (synchronized): dos CONNECT a la vez no se cuelan.
	 */
	synchronized void autenticada(String idSesion, String usuario, Instant caduca) {
		if (idSesion == null) {
			return;
		}
		long vigentes = sesiones.entrySet().stream().filter(e -> !e.getKey().equals(idSesion)).map(java.util.Map.Entry::getValue)
				.filter(e -> usuario.equals(e.usuario()) && !e.expulsada() && !caducada(e)).count();
		if (vigentes >= maxPorUsuario) {
			throw new AccesoStompDenegadoException(AccesoStompDenegadoException.DEMASIADAS_CONEXIONES);
		}
		sesiones.compute(idSesion, (id, actual) -> new Entrada(actual == null ? null : actual.sesion(), usuario, caduca,
				actual != null && actual.expulsada()));
	}

	// ---- consulta ----

	public int cantidad() {
		return sesiones.size();
	}

	public int cantidadDe(String usuario) {
		return (int) sesiones.values().stream().filter(e -> usuario.equals(e.usuario())).count();
	}

	/** Cierto si el token de la sesion ya caduco (en el instante exacto de {@code exp} ya cuenta) o ya se la expulso. */
	boolean estaCaducada(String idSesion) {
		Entrada e = sesiones.get(idSesion);
		return e != null &&(e.expulsada() || caducada(e));
	}

	private boolean caducada(Entrada e) {
		return e.caduca() != null && !Instant.now(reloj).isBefore(e.caduca());
	}

	// ---- expulsion ----

	/** Barrido periodico: expulsa todas las sesiones con el token caducado. Publico para llamarlo directamente en tests. */
	@Scheduled(scheduler = "viboraWsScheduler", fixedDelayString = "${vibora.websocket.intervalo-barrido:PT30S}",
			initialDelayString = "${vibora.websocket.intervalo-barrido:PT30S}")
	public void barrer() {
		sesiones.forEach((id, entrada) -> {
			if (caducada(entrada)) {
				expulsar(id);
			}
		});
	}

	/**
	 * Cerrar sesion en todas partes: expulsa YA todas las sesiones abiertas de la persona (ERROR "No autenticado" + cierre),
	 * sin esperar a que caduque su token. Los CONNECT posteriores con un token anterior los rechaza el decodificador (ver).
	 */
	public void expulsarDe(String usuario) {
		sesiones.forEach((id, entrada) -> {
			if (usuario.equals(entrada.usuario())) {
				expulsar(id);
			}
		});
	}

	/** Antes de empujarle algo a un usuario: expulsa sus sesiones caducadas (las vigentes no se tocan). */
	void expulsarCaducadasDe(String usuario) {
		sesiones.forEach((id, entrada) -> {
			if (usuario.equals(entrada.usuario()) && caducada(entrada)) {
				expulsar(id);
			}
		});
	}

	/**
	 * Avisa a la sesion con un ERROR "No autenticado" por el canal de salida (asi respeta el orden y la
	 * sincronizacion del envio) y la cierra cuando el ERROR ya se entrego ({@link #cerrarSiExpulsada}). Idempotente.
	 */
	void expulsar(String idSesion) {
		boolean[] primera = { false };
		sesiones.computeIfPresent(idSesion, (id, e) -> {
			if (e.expulsada()) {
				return e;
			}
			primera[0] = true;
			return new Entrada(e.sesion(), e.usuario(), e.caduca(), true);
		});
		if (!primera[0]) {
			return;
		}
		boolean enviado = false;
		try {
			StompHeaderAccessor cabeceras = StompHeaderAccessor.create(StompCommand.ERROR);
			cabeceras.setSessionId(idSesion);
			cabeceras.setMessage(AccesoStompDenegadoException.NO_AUTENTICADO);
			cabeceras.setLeaveMutable(true);
			enviado = salida.send(MessageBuilder.createMessage(new byte[0], cabeceras.getMessageHeaders()));
		} catch (RuntimeException ex) {
			log.debug("No se pudo avisar a la sesion {} de su caducidad: {}", idSesion, ex.toString());
		}
		if (!enviado) {
			cerrar(idSesion);
		}
	}

	/** Lo llama el canal de salida cuando acaba de entregarse un ERROR: si era el de una expulsion, se cierra. */
	void cerrarSiExpulsada(String idSesion) {
		Entrada e = sesiones.get(idSesion);
		if (e != null && e.expulsada()) {
			cerrar(idSesion);
		}
	}

	/**
	 * Quita la sesion del registro SIN mandar ningun frame ni cerrarla: la usa el interceptor cuando el CONNECT falla
	 * despues de registrarla y el rechazo ya lo comunica la excepcion (un unico ERROR, y el cierre lo hace el transporte).
	 */
	void olvidar(String idSesion) {
		if (idSesion != null) {
			sesiones.remove(idSesion);
		}
	}

	private void cerrar(String idSesion) {
		Entrada e = sesiones.remove(idSesion);
		if (e == null || e.sesion() == null) {
			return;
		}
		try {
			e.sesion().close(CloseStatus.POLICY_VIOLATION);
		} catch (IOException | RuntimeException ex) {
			log.debug("No se pudo cerrar la sesion {}: {}", idSesion, ex.toString());
		}
	}
}
