package com.vibora.auth;

/** Cotas compartidas por registro y login para que lo que se puede registrar siempre se pueda usar para entrar. */
final class AuthLimites {

	/** Longitud maxima del email: la misma que la columna {@code usuario.email} (varchar(255)). */
	static final int EMAIL_MAX = 255;

	private AuthLimites() {
	}
}
