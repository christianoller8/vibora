package com.vibora.reserva;

import com.vibora.cargo.CalculadoraCuotas;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;

/**
 * {@code cancelableHasta}: ultimo instante en que el PROPIETARIO puede cancelar (inicio menos
 * {@code vibora.reservas.cancelacion-minima-horas}); pasado ese instante su cancelacion es un 409. El administrador del
 * club NO esta sujeto a este plazo: puede cancelar en cualquier momento anterior al inicio.
 */
public record ReservaResponse(Long id, Long pistaId, String pistaNombre, Long clubId, String clubNombre,
		Instant inicio, Instant fin, EstadoReserva estado, BigDecimal precioTotal, boolean abierta, int jugadores,
		BigDecimal cuotaPorJugador, Instant cancelableHasta) {

	public static ReservaResponse de(Reserva r, long cancelacionMinimaHoras) {
		Instant cancelableHasta = r.getInicio() == null ? null : r.getInicio().minus(Duration.ofHours(cancelacionMinimaHoras));
		return new ReservaResponse(r.getId(), r.getPista().getId(), r.getPista().getNombre(),
				r.getPista().getClub().getId(), r.getPista().getClub().getNombre(), r.getInicio(), r.getFin(),
				r.getEstado(), r.getPrecioTotal(), r.isAbierta(), r.getParticipantes().size(),
				CalculadoraCuotas.cuotaPorJugador(r.getPrecioTotal()), cancelableHasta);
	}
}
