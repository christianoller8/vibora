package com.vibora.tarifa;

import com.vibora.ApiTestBase;
import com.vibora.club.Club;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Tope del precio por hora de una franja: 9999.99 EUR (cualquier casilla del dia cabe en reserva.precio_total). */
class TarifaPrecioMaximoTests extends ApiTestBase {

	private static String cuerpo(String precio) {
		return """
				{"diaSemana":"MONDAY","horaInicio":"08:00","horaFin":"12:00","precioHora":%s,"tipo":"NORMAL"}
				""".formatted(precio);
	}

	private ResultActions crear(Club club, String token, String precio) throws Exception {
		return mvc.perform(post("/api/clubes/" + club.getId() + "/tarifas").header("Authorization", token)
				.contentType(MediaType.APPLICATION_JSON).content(cuerpo(precio)));
	}

	@ParameterizedTest
	@ValueSource(strings = { "10000.00", "10000", "999999.99", "10000.01" })
	void crear_precioPorEncimaDelMaximo_400(String precio) throws Exception {
		Club club = crearClub("Club A");

		crear(club, bearerAdminDe(club, "admin@vibora.com"), precio).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("Datos no válidos"));
	}

	@ParameterizedTest
	@ValueSource(strings = { "9999.99", "0.00", "9999" })
	void crear_precioHastaElMaximo_201(String precio) throws Exception {
		Club club = crearClub("Club A");

		crear(club, bearerAdminDe(club, "admin@vibora.com"), precio).andExpect(status().isCreated());
	}

	@Test
	void modificar_precioPorEncimaDelMaximo_400() throws Exception {
		Club club = crearClub("Club A");
		String token = bearerAdminDe(club, "admin@vibora.com");
		String cuerpoCreada = crear(club, token, "20.00").andExpect(status().isCreated()).andReturn().getResponse()
				.getContentAsString();
		long id = Long.parseLong(cuerpoCreada.replaceAll(".*\"id\":(\\d+).*", "$1"));

		mvc.perform(put("/api/clubes/" + club.getId() + "/tarifas/" + id).header("Authorization", token)
						.contentType(MediaType.APPLICATION_JSON).content(cuerpo("10000.00")))
				.andExpect(status().isBadRequest());
	}
}
