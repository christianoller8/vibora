package com.vibora.auth;

import com.vibora.websocket.SesionesWs;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

	private final AuthService authService;
	private final LimitadorAuth limitador;
	private final SesionService sesiones;
	private final CookieRefresco cookies;
	private final SesionesWs sockets;

	/**
	 * La IP es la del socket ({@code getRemoteAddr}): detras de nginx, Tomcat (server.forward-headers-strategy=native) la
	 * sustituye por la del cliente real SOLO si el par directo es un proxy de confianza; un X-Forwarded-For puesto por
	 * el cliente no cuenta. El limite se comprueba tras validar el cuerpo (los 400 no cuentan) y antes del hash.
	 */
	@PostMapping("/registro")
	@SecurityRequirements // publico: anula el requisito bearerAuth global de OpenAPI
	@ResponseStatus(HttpStatus.CREATED)
	public UsuarioResumen registro(@Valid @RequestBody RegistroRequest peticion, HttpServletRequest http) {
		limitador.admitirRegistro(http.getRemoteAddr());
		return authService.registrar(peticion);
	}

	@PostMapping("/login")
	@SecurityRequirements // publico: anula el requisito bearerAuth global de OpenAPI
	public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest peticion, HttpServletRequest http) {
		String ip = http.getRemoteAddr();
		LimitadorAuth.Admision admision = limitador.admitirLogin(ip, peticion.email());
		SesionIniciada sesion = authService.login(peticion); // 401 uniforme si falla: el intento ya esta contado
		limitador.loginCorrecto(ip, peticion.email(), admision); // solo toca la ventana en la que se admitio
		return conCookie(sesion);
	}

	/**
	 * Renueva el acceso con la cookie de refresco (rotandola). No necesita token de acceso: es justo lo que se pide cuando
	 * ya caduco. Cualquier fallo es un 401 que ademas borra la cookie.
	 * <p>
	 * CSRF: sin cabecera extra. SameSite=Strict mantiene la cookie fuera de las peticiones entre sitios, y el token de
	 * acceso nuevo solo viaja en el cuerpo de la respuesta, que una pagina de otro origen no puede leer.
	 */
	@PostMapping("/refrescar")
	@SecurityRequirements
	public ResponseEntity<?> refrescar(@CookieValue(name = CookieRefresco.NOMBRE, required = false) String token,
			HttpServletRequest http) {
		String ip = http.getRemoteAddr();
		limitador.comprobarRefresco(ip); // 429 si la IP ya lleno su cuota de refrescos fallidos
		boolean traeCookie = token != null && !token.isBlank();
		return sesiones.refrescar(token).<ResponseEntity<?>>map(this::conCookie)
				.orElseGet(() -> {
					// solo cuentan los fallidos que traian cookie: una rotacion correcta o una visita anonima no gastan cuota
					if (traeCookie) {
						limitador.refrescoFallido(ip);
					}					return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
							.header(HttpHeaders.SET_COOKIE, cookies.borrar().toString())
							.body(Map.of("error", "No autenticado"));
				});
	}

	/** Cierra la sesion de esta cookie (su familia). Funciona solo con la cookie: el acceso puede haber caducado. Idempotente. */
	@PostMapping("/cerrar-sesion")
	@SecurityRequirements
	public ResponseEntity<Void> cerrarSesion(@CookieValue(name = CookieRefresco.NOMBRE, required = false) String token) {
		sesiones.cerrar(token);
		return sinCookie();
	}

	/** Cierra las sesiones de la persona en todas partes: accesos vigentes, refrescos y WebSockets abiertos. */
	@PostMapping("/cerrar-sesion-todas")
	public ResponseEntity<Void> cerrarSesionTodas(Authentication autenticacion) {
		sesiones.cerrarTodas(autenticacion.getName());
		sockets.expulsarDe(autenticacion.getName()); // ya confirmado: un CONNECT nuevo con el token viejo ya no pasa
		return sinCookie();
	}

	private ResponseEntity<TokenResponse> conCookie(SesionIniciada sesion) {
		return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, cookies.crear(sesion).toString()).body(sesion.acceso());
	}

	private ResponseEntity<Void> sinCookie() {
		return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookies.borrar().toString()).build();
	}

	/** El nombre de la autenticacion es el subject del JWT (el email). */
	@GetMapping("/me")
	public UsuarioResumen me(Authentication autenticacion) {
		return authService.perfil(autenticacion.getName());
	}
}
