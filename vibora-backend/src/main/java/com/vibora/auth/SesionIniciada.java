package com.vibora.auth;

import java.time.Duration;

/**
 * Resultado interno de abrir o rotar una sesion: el acceso (cuerpo de la respuesta) y el token de refresco en claro
 * (solo viaja en la cookie), con lo que le queda de vida.
 */
public record SesionIniciada(TokenResponse acceso, String refresco, Duration vidaRefresco) {

	/** El toString generado imprimiria los dos tokens en claro: un log o una excepcion que lo formatee los filtraria. */
	@Override
	public String toString() {
		return "SesionIniciada[acceso=[oculto], refresco=[oculto], vidaRefresco=" + vidaRefresco + "]";
	}
}
