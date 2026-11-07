package com.vibora.tarifa;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalTime;

/**
 * Body de alta/modificacion de franja tarifaria. diaSemana es el nombre del enum java.time.DayOfWeek
 * (MONDAY ... SUNDAY). La regla horaFin > horaInicio y el no solape se validan en el servicio.
 */
public record TarifaRequest(
		@NotNull DayOfWeek diaSemana,
		@NotNull LocalTime horaInicio,
		@NotNull LocalTime horaFin,
		// Tope 9999.99 EUR/h: cualquier casilla de un dia (maximo 24 h = 239.999,76) cabe en reserva.precio_total numeric(8,2)
		@NotNull @DecimalMin("0.00") @DecimalMax("9999.99") @Digits(integer = 4, fraction = 2) BigDecimal precioHora,
		@NotNull TipoTarifa tipo) {
}
