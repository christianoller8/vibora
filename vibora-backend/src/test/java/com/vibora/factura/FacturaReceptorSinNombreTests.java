package com.vibora.factura;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Nombre del receptor que, una vez limpio de caracteres de control, queda vacio. Decision: si ni el cuerpo ni el
 * nombre del organizador dejan un nombre usable, 400 "El nombre del receptor no es válido" (el cliente puede mandar un
 * {@code nombre} en el cuerpo); nunca un NPE/500, y sin gastar numero de factura.
 */
class FacturaReceptorSinNombreTests extends FacturaApiTestBase {

	private static final String CONTROL = "\u0001\u0002\u0003";

	@Test
	void organizadorConApellidosSoloDeCaracteresDeControl_sinNombreEnElCuerpo_400() throws Exception {
		configurarDatosFiscales(admin, club);
		Jug raro = jugador("raro@vibora.com", null, CONTROL);
		long reserva = reservaEnElLunes(raro, 11, 0);

		facturar(raro, reserva).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("El nombre del receptor no es válido"));

		assertThat(contarFacturas()).isZero();
		assertThat(contador(club, 2030)).isZero();
	}

	@Test
	void mismoOrganizador_conNombreEnElCuerpo_201() throws Exception {
		configurarDatosFiscales(admin, club);
		Jug raro = jugador("raro@vibora.com", null, CONTROL);
		long reserva = reservaEnElLunes(raro, 11, 0);

		facturar(raro, reserva, """
				{"nombre":"Cliente Real S.L."}
				""").andExpect(status().isCreated()).andExpect(jsonPath("$.receptor.nombre").value("Cliente Real S.L."));
	}

	@Test
	void nombreDelCuerpoSoloDeCaracteresDeControl_usaElDelOrganizador() throws Exception {
		configurarDatosFiscales(admin, club);
		Jug ana = ana("ana@vibora.com");
		long reserva = reservaEnElLunes(ana, 11, 0);

		facturar(ana, reserva, "{\"nombre\":\"\\u0001\\u0002\"}").andExpect(status().isCreated())
				.andExpect(jsonPath("$.receptor.nombre").value("Ana García"));
	}

	@Test
	void nombreYDireccionDelCuerpoSoloDeCaracteresDeControl_y_organizadorSinNombre_400SinDireccion() throws Exception {
		configurarDatosFiscales(admin, club);
		Jug raro = jugador("raro@vibora.com", null, CONTROL);
		long reserva = reservaEnElLunes(raro, 11, 0);

		facturar(raro, reserva, "{\"nombre\":\"\\u0001\",\"direccion\":\"\\u0002\\u0003\"}")
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("El nombre del receptor no es válido"));
	}

	@Test
	void direccionDelCuerpoSoloDeCaracteresDeControl_seIgnora() throws Exception {
		configurarDatosFiscales(admin, club);
		Jug ana = ana("ana@vibora.com");
		long reserva = reservaEnElLunes(ana, 11, 0);

		facturar(ana, reserva, "{\"direccion\":\"\\u0002\\u0003\"}").andExpect(status().isCreated())
				.andExpect(jsonPath("$.receptor.direccion").doesNotExist());
	}
}
