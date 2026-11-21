package com.vibora.auth;

import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

	private final AuthService authService;
	private final LimitadorAuth limitador;

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
	public TokenResponse login(@Valid @RequestBody LoginRequest peticion, HttpServletRequest http) {
		String ip = http.getRemoteAddr();
		LimitadorAuth.Admision admision = limitador.admitirLogin(ip, peticion.email());
		TokenResponse token = authService.login(peticion); // 401 uniforme si falla: el intento ya esta contado
		limitador.loginCorrecto(ip, peticion.email(), admision); // solo toca la ventana en la que se admitio
		return token;
	}

	/** El nombre de la autenticacion es el subject del JWT (el email). */
	@GetMapping("/me")
	public UsuarioResumen me(Authentication autenticacion) {
		return authService.perfil(autenticacion.getName());
	}
}
