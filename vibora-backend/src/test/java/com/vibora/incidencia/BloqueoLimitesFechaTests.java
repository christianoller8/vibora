package com.vibora.incidencia;

import com.vibora.common.LimitesFecha;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Las fechas {@code desde} y {@code hasta} de un bloqueo de pista tambien respetan los limites de fecha (400, nunca 500). */
class BloqueoLimitesFechaTests extends BloqueoApiTestBase {

	@ParameterizedTest
	@ValueSource(strings = { "+999999999-12-31T00:00:00Z", "0001-01-01T00:00:00Z", "+500000-01-01T00:00:00Z",
			"1969-12-31T23:59:59Z", "2101-01-01T00:00:00Z" })
	void desdeFueraDeRango_400ConMensajeDeLimites(String desde) throws Exception {
		bloquear(admin, pista, desde, null).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value(LimitesFecha.MENSAJE));
	}

	@ParameterizedTest
	@ValueSource(strings = { "+999999999-12-31T00:00:00Z", "0001-01-01T00:00:00Z", "+500000-01-01T00:00:00Z",
			"1969-12-31T23:59:59Z", "2101-01-01T00:00:00Z" })
	void hastaFueraDeRango_400ConMensajeDeLimites(String hasta) throws Exception {
		bloquear(admin, pista, null, hasta).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value(LimitesFecha.MENSAJE));
	}

	@Test
	void desdeEnElPrimerInstantePermitido_201() throws Exception {
		bloquear(admin, pista, "1970-01-01T00:00:00Z", null).andExpect(status().isCreated());
	}

	@Test
	void hastaEnElUltimoInstantePermitido_201() throws Exception {
		bloquear(admin, pista, null, "2100-12-31T23:59:59Z").andExpect(status().isCreated());
	}
}
