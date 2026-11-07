package com.vibora.reserva;

import org.springframework.test.context.TestPropertySource;

/** Mismas comprobaciones con un plazo configurado distinto del valor por defecto (48 h en vez de 24 h). */
@TestPropertySource(properties = "vibora.reservas.cancelacion-minima-horas=48")
class ReservaCancelableHastaConfigurableTests extends ReservaCancelableHastaTests {

	@Override
	long horas() {
		return 48;
	}
}
