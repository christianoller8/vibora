package com.vibora.auth;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;

/** Cookie del token de refresco: HttpOnly, SameSite=Strict, limitada a /api/auth y Secure (salvo desarrollo sin HTTPS). */
@Component
@RequiredArgsConstructor
public class CookieRefresco {

	public static final String NOMBRE = "vibora_refresco";
	private static final String RUTA = "/api/auth";

	private final SesionProperties propiedades;

	public ResponseCookie crear(SesionIniciada sesion) {
		return construir(sesion.refresco(), sesion.vidaRefresco());
	}

	/** Mismos atributos con Max-Age=0: el navegador solo la borra si coinciden nombre, ruta y dominio. */
	public ResponseCookie borrar() {
		return construir("", Duration.ZERO);
	}

	private ResponseCookie construir(String valor, Duration vida) {
		return ResponseCookie.from(NOMBRE, valor)
				.httpOnly(true)
				.secure(propiedades.cookieSegura())
				.sameSite("Strict")

				.path(RUTA)
				.maxAge(vida)
				.build();
	}
}
