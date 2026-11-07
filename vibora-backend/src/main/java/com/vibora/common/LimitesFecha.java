package com.vibora.common;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;

/**
 * Fechas aceptadas en las peticiones (filtros por fecha e instantes de reservas y bloqueos). Sin un tope absoluto, un
 * anio gigantesco desborda al sumar un dia ({@code +999999999-12-31}) o lo rechaza la base de datos como instante, y el
 * cliente recibiria un 500 en vez de un 400.
 */
public final class LimitesFecha {

	public static final LocalDate MINIMA = LocalDate.of(1970, 1, 1);
	public static final LocalDate MAXIMA = LocalDate.of(2100, 12, 31);
	public static final String MENSAJE = "Las fechas deben estar entre 1970 y 2100";

	/** Primer instante permitido (UTC) y primero que YA no lo es: todo el 2100-12-31 UTC es valido. */
	private static final Instant INSTANTE_MINIMO = MINIMA.atStartOfDay(ZoneOffset.UTC).toInstant();
	private static final Instant INSTANTE_MAXIMO_EXCLUSIVO = MAXIMA.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();

	private LimitesFecha() {
	}

	/** Lanza {@link IllegalArgumentException} (400) si la fecha no es nula y cae fuera de [1970-01-01, 2100-12-31]. */
	public static void validar(LocalDate fecha) {
		if (fecha != null && (fecha.isBefore(MINIMA) || fecha.isAfter(MAXIMA))) {
			throw new IllegalArgumentException(MENSAJE);
		}
	}

	/**
	 * Lo mismo para un instante (se interpreta en UTC): valido desde 1970-01-01T00:00Z hasta el final de 2100-12-31.
	 * Debe llamarse ANTES de usar el instante en cualquier calculo o consulta.
	 */
	public static void validarInstante(Instant instante) {
		if (instante != null && (instante.isBefore(INSTANTE_MINIMO) || !instante.isBefore(INSTANTE_MAXIMO_EXCLUSIVO))) {
			throw new IllegalArgumentException(MENSAJE);
		}
	}
}
