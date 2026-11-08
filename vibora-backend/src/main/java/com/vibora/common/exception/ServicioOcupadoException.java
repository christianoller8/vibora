package com.vibora.common.exception;

/** 503: el servidor no puede atender ahora esta peticion (p. ej. demasiadas imagenes decodificandose); se puede reintentar. */
public class ServicioOcupadoException extends RuntimeException {

	public ServicioOcupadoException(String mensaje) {
		super(mensaje);
	}
}
