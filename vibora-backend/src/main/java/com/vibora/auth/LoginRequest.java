package com.vibora.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Peticion sin autenticar: las cotas evitan que alguien obligue al servidor a normalizar textos enormes. Entre 73 bytes
 * y 1000 caracteres la contrasena sigue siendo un 401 (ver AuthService.login), no un 400.
 * <p>
 * El email admite lo mismo que el registro ({@link AuthLimites#EMAIL_MAX}, la columna de la BD): una cota menor dejaria
 * a quien se registra con un email de longitud maxima sin poder entrar nunca. Las cotas son 400, nunca una pista sobre
 * si la cuenta existe.
 */
public record LoginRequest(
		@NotBlank @Size(max = AuthLimites.EMAIL_MAX) String email,
		@NotBlank @Size(max = 1000) String password) {
}
