package com.vibora.websocket;

import com.vibora.auth.JwtService;
import com.vibora.auth.VersionSesionValidador;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.stereotype.Component;
import org.springframework.transaction.TransactionException;

import java.util.Locale;

/**
 * Seguridad del canal de entrada STOMP. El navegador no puede poner cabeceras en el handshake del WebSocket, asi que
 * la autenticacion se hace en el frame CONNECT (cabecera {@code Authorization: Bearer <jwt>}) con las MISMAS reglas
 * que la API REST (firma, caducidad, emisor, y usuario existente y activo en la BD, como /me). Politica por frame:
 * <ul>
 * <li>CONNECT: exige JWT valido; el Principal pasa a ser el usuario (nombre = email = subject del JWT).</li>
 * <li>SUBSCRIBE: solo {@code /user/queue/notificaciones}, y solo con sesion autenticada.</li>
 * <li>UNSUBSCRIBE / DISCONNECT: permitidos.</li>
 * <li>Todo lo demas (SEND, ACK, BEGIN...): denegado. El cliente nunca envia nada a la aplicacion ni a otros usuarios.</li>
 * </ul>
 * La identidad se valida al conectar; el instante en que caduca el token se apunta en {@link SesionesWs}, que cierra
 * el socket cuando llega (un token caducado no mantiene viva una conexion abierta).
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class StompAutenticacionInterceptor implements ChannelInterceptor {

	static final String DESTINO_PERMITIDO = "/user/queue/notificaciones";
	private static final String PREFIJO_BEARER = "bearer ";

	private final JwtService jwtService;
	private final JwtAuthenticationConverter convertidor;
	private final UsuarioRepository usuarios;
	private final SesionesWs sesiones;
	private final VersionSesionValidador versionSesion;

	@Override
	public Message<?> preSend(Message<?> mensaje, MessageChannel canal) {
		StompHeaderAccessor accesor = MessageHeaderAccessor.getAccessor(mensaje, StompHeaderAccessor.class);
		StompCommand comando = accesor == null ? null : accesor.getCommand();
		if (comando == null) {
			return mensaje; // latidos y mensajes internos que no son frames STOMP
		}
		switch (comando) {
			case CONNECT, STOMP -> accesor.setUser(
						autenticar(accesor.getFirstNativeHeader("Authorization"), accesor.getSessionId()));
			case SUBSCRIBE -> {
				if (accesor.getUser() == null) {
					throw new AccesoStompDenegadoException(AccesoStompDenegadoException.NO_AUTENTICADO);
				}
				if (!DESTINO_PERMITIDO.equals(accesor.getDestination())) {
					throw new AccesoStompDenegadoException(AccesoStompDenegadoException.ACCESO_DENEGADO);
				}
			}
			case UNSUBSCRIBE, DISCONNECT -> {
			}
			default -> throw new AccesoStompDenegadoException(
					accesor.getUser() == null ? AccesoStompDenegadoException.NO_AUTENTICADO
							: AccesoStompDenegadoException.ACCESO_DENEGADO);
		}
		return mensaje;
	}

	private Authentication autenticar(String cabecera, String idSesion) {
		if (cabecera == null || !cabecera.toLowerCase(Locale.ROOT).startsWith(PREFIJO_BEARER)) {
			throw new AccesoStompDenegadoException(AccesoStompDenegadoException.NO_AUTENTICADO);
		}
		String token = cabecera.substring(PREFIJO_BEARER.length()).trim();
		Jwt jwt;
		try {
			jwt = jwtService.decodificar(token);
		} catch (JwtException | IllegalArgumentException ex) {
			throw new AccesoStompDenegadoException(AccesoStompDenegadoException.NO_AUTENTICADO);
		} catch (DataAccessException | TransactionException ex) {
			// la BD fallo al comprobar la version de sesion: ERROR limpio y cierre, no una excepcion cruda
			// (una caida real sale de la transaccion como TransactionException, que no es DataAccessException)
			log.warn("CONNECT STOMP rechazado: la BD no responde", ex);
			throw new AccesoStompDenegadoException(AccesoStompDenegadoException.SERVICIO_NO_DISPONIBLE);
		}
		boolean registrada = false;
		try {
			// igual que /me: el usuario debe seguir existiendo y estar activo
			usuarios.findByEmail(jwt.getSubject()).filter(Usuario::isActivo)
					.orElseThrow(() -> new AccesoStompDenegadoException(AccesoStompDenegadoException.NO_AUTENTICADO));
			Authentication autenticacion = convertidor.convert(jwt);
			// El socket sobrevive al token: se apunta cuando caduca para cerrarlo entonces (ver SesionesWs)
			sesiones.autenticada(idSesion, autenticacion.getName(), jwt.getExpiresAt());
			registrada = true;
			// Carrera con "cerrar todas": si subio la version entre la decodificacion y el registro, su expulsarDe pudo no ver
			// este socket. Se vuelve a comprobar YA registrado: o lo expulsa ella, o lo ve este contraste.
			if (versionSesion.validate(jwt).hasErrors()) {
				// Sin expulsar: la excepcion ya manda el unico ERROR; solo se da de baja la entrada, en silencio
				sesiones.olvidar(idSesion);
				throw new AccesoStompDenegadoException(AccesoStompDenegadoException.NO_AUTENTICADO);
			}
			return autenticacion;
		} catch (DataAccessException | TransactionException ex) {
			if (registrada) {
				sesiones.olvidar(idSesion); // no deja la entrada contando para el tope por usuario
			}
			log.warn("CONNECT STOMP rechazado: la BD no responde", ex);
			throw new AccesoStompDenegadoException(AccesoStompDenegadoException.SERVICIO_NO_DISPONIBLE);
		}
	}
}
