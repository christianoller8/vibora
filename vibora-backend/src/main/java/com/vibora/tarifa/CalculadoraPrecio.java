package com.vibora.tarifa;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Precio de un tramo [inicio, fin) a partir de las franjas tarifarias del club. Clase pura (sin BD):
 * el precio es la suma, por cada franja del dia local que toca el tramo, de precioHora * minutosSolapados / 60,
 * redondeada una sola vez a 2 decimales (HALF_UP). Todo el tramo debe quedar cubierto por franjas.
 */
@Component
public class CalculadoraPrecio {

	static final String SIN_TARIFA = "No hay tarifa definida para esa franja horaria";
	static final String PRECIO_EXCESIVO = "El precio calculado supera el máximo admitido";
	/** Lo que cabe en reserva.precio_total numeric(8,2). */
	static final BigDecimal MAXIMO = new BigDecimal("999999.99");

	public BigDecimal calcular(List<TarifaFranja> tarifas, Instant inicio, Instant fin, ZoneId zona) {
		LocalDateTime desde = inicio.atZone(zona).toLocalDateTime();
		LocalDateTime hasta = fin.atZone(zona).toLocalDateTime();
		if (!hasta.isAfter(desde)) {
			throw new IllegalArgumentException("El fin debe ser posterior al inicio");
		}
		if (!desde.toLocalDate().equals(hasta.toLocalDate())) {
			throw new IllegalArgumentException("La reserva no puede cruzar la medianoche");
		}
		LocalTime horaDesde = desde.toLocalTime();
		LocalTime horaHasta = hasta.toLocalTime();
		long minutosTramo = ChronoUnit.MINUTES.between(horaDesde, horaHasta);

		long minutosCubiertos = 0;
		BigDecimal acumulado = BigDecimal.ZERO; // precio * minutos (aun sin dividir entre 60)
		for (TarifaFranja franja : tarifas) {
			if (franja.getDiaSemana() != desde.getDayOfWeek()) {
				continue;
			}
			LocalTime solapeInicio = max(horaDesde, franja.getHoraInicio());
			LocalTime solapeFin = min(horaHasta, franja.getHoraFin());
			long minutos = solapeFin.isAfter(solapeInicio) ? ChronoUnit.MINUTES.between(solapeInicio, solapeFin) : 0;
			if (minutos > 0) {
				minutosCubiertos += minutos;
				acumulado = acumulado.add(franja.getPrecioHora().multiply(BigDecimal.valueOf(minutos)));
			}
		}
		if (minutosCubiertos != minutosTramo) {
			throw new IllegalArgumentException(SIN_TARIFA);
		}
		BigDecimal total = acumulado.divide(BigDecimal.valueOf(60), 2, RoundingMode.HALF_UP);
		if (total.compareTo(MAXIMO) > 0) { // tarifas heredadas fuera del tope de la API: 400 en vez de desbordar la columna
			throw new IllegalArgumentException(PRECIO_EXCESIVO);
		}
		return total;
	}

	private static LocalTime max(LocalTime a, LocalTime b) {
		return a.isAfter(b) ? a : b;
	}

	private static LocalTime min(LocalTime a, LocalTime b) {
		return a.isBefore(b) ? a : b;
	}
}
