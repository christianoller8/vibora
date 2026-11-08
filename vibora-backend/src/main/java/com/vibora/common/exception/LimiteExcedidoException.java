package com.vibora.common.exception;

/**
 * 429: se superó un límite de uso. {@code retryAfterSegundos} > 0 se envía en la cabecera Retry-After; 0 = sin cabecera
 * (límites que no se liberan en un instante concreto, como la cuota diaria).
 */
public class LimiteExcedidoException extends RuntimeException {

	private final long retryAfterSegundos;

	public LimiteExcedidoException(String mensaje, long retryAfterSegundos) {
		super(mensaje);
		this.retryAfterSegundos = retryAfterSegundos;
	}

	public long getRetryAfterSegundos() {
		return retryAfterSegundos;
	}
}
