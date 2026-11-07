package com.vibora.reserva;

import com.vibora.ApiTestBase;
import com.vibora.RelojMutable;
import com.vibora.RelojTestConfig;
import com.vibora.TestData;
import com.vibora.club.Club;
import com.vibora.common.LimitesFecha;
import com.vibora.pista.Pista;
import com.vibora.pista.PistaRepository;
import com.vibora.tarifa.TarifaFranja;
import com.vibora.tarifa.TarifaFranjaRepository;
import com.vibora.tarifa.TipoTarifa;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Limites de fecha en todas las fechas que envia el cliente (agenda, reservas del club, partidos, inicio de la
 * reserva) y tope de precio. Reloj fijado en 2030-01-01T00:00Z; club 08:00-23:00, casillas de 90 minutos.
 */
@Import(RelojTestConfig.class)
class ReservaLimitesYPrecioTests extends ApiTestBase {

	private static final ZoneId MADRID = ZoneId.of("Europe/Madrid");
	private static final LocalDate LUNES = LocalDate.of(2030, 1, 7);

	@Autowired RelojMutable reloj;
	@Autowired PistaRepository pistas;
	@Autowired TarifaFranjaRepository tarifas;

	Club club;
	Pista pista;

	@BeforeEach
	void preparar() {
		reloj.fijar(RelojTestConfig.AHORA_INICIAL);
		club = crearClub("Club A");
		pista = pistas.saveAndFlush(TestData.pista(club, "Pista 1"));
	}

	private TarifaFranja tarifa(DayOfWeek dia, String precio) {
		TarifaFranja t = TestData.tarifa(club, dia, TipoTarifa.NORMAL);
		t.setHoraInicio(LocalTime.of(8, 0));
		t.setHoraFin(LocalTime.of(23, 0));
		t.setPrecioHora(new BigDecimal(precio));
		return tarifas.saveAndFlush(t);
	}

	private ResultActions reservar(String token, String inicio) throws Exception {
		return mvc.perform(post("/api/clubes/" + club.getId() + "/pistas/" + pista.getId() + "/reservas")
				.header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
				.content("{\"inicio\":\"" + inicio + "\"}"));
	}

	private ResultActions agenda(String token, String fecha) throws Exception {
		return mvc.perform(get("/api/clubes/" + club.getId() + "/pistas/" + pista.getId() + "/agenda")
				.param("fecha", fecha).header("Authorization", token));
	}

	private ResultActions delClub(String token, String fecha) throws Exception {
		return mvc.perform(get("/api/clubes/" + club.getId() + "/reservas").param("fecha", fecha)
				.header("Authorization", token));
	}

	private ResultActions partidos(String token, String fecha) throws Exception {
		return mvc.perform(get("/api/partidos").param("fecha", fecha).header("Authorization", token));
	}

	// ---- fechas de los filtros ----

	@ParameterizedTest
	@ValueSource(strings = { "+999999999-12-31", "0001-01-01", "+500000-01-01", "1969-12-31", "2101-01-01" })
	void agenda_fechaFueraDeRango_400ConMensajeDeLimites(String fecha) throws Exception {
		agenda(bearerJugador("j@vibora.com"), fecha).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value(LimitesFecha.MENSAJE));
	}

	@ParameterizedTest
	@ValueSource(strings = { "1970-01-01", "2100-12-31" })
	void agenda_fechasLimiteValidas_200(String fecha) throws Exception {
		agenda(bearerJugador("j@vibora.com"), fecha).andExpect(status().isOk());
	}

	@ParameterizedTest
	@ValueSource(strings = { "+999999999-12-31", "0001-01-01", "+500000-01-01", "1969-12-31", "2101-01-01" })
	void reservasDelClub_fechaFueraDeRango_400ConMensajeDeLimites(String fecha) throws Exception {
		delClub(bearerAdminDe(club, "admin@vibora.com"), fecha).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value(LimitesFecha.MENSAJE));
	}

	@ParameterizedTest
	@ValueSource(strings = { "1970-01-01", "2100-12-31" })
	void reservasDelClub_fechasLimiteValidas_200(String fecha) throws Exception {
		delClub(bearerAdminDe(club, "admin@vibora.com"), fecha).andExpect(status().isOk());
	}

	@ParameterizedTest
	@ValueSource(strings = { "+999999999-12-31", "0001-01-01", "+500000-01-01", "1969-12-31", "2101-01-01" })
	void partidos_fechaFueraDeRango_400ConMensajeDeLimites(String fecha) throws Exception {
		partidos(bearerJugador("j@vibora.com"), fecha).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value(LimitesFecha.MENSAJE));
	}

	@ParameterizedTest
	@ValueSource(strings = { "1970-01-01", "2100-12-31" })
	void partidos_fechasLimiteValidas_200(String fecha) throws Exception {
		partidos(bearerJugador("j@vibora.com"), fecha).andExpect(status().isOk());
	}

	// ---- inicio de la reserva ----

	@ParameterizedTest
	@ValueSource(strings = { "+999999999-12-31T10:00:00Z", "0001-01-01T10:00:00Z", "+500000-01-01T10:00:00Z",
			"1969-12-31T23:59:59Z", "2101-01-01T00:00:00Z" })
	void reservar_inicioFueraDeRango_400ConMensajeDeLimites(String inicio) throws Exception {
		reservar(bearerJugador("j@vibora.com"), inicio).andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value(LimitesFecha.MENSAJE));
	}

	@Test
	void reservar_ultimoDiaPermitido_201() throws Exception {
		LocalDate ultimo = LimitesFecha.MAXIMA;
		tarifa(ultimo.getDayOfWeek(), "20.00");
		Instant inicio = ultimo.atTime(11, 0).atZone(MADRID).toInstant();

		reservar(bearerJugador("j@vibora.com"), inicio.toString()).andExpect(status().isCreated());
	}

	@Test
	void reservar_primerInstantePermitido_noSeRechazaPorLimites() throws Exception {
		// 1970-01-01T00:00Z esta dentro del rango: lo rechaza otra regla (horario/pasado), no la de los limites
		String cuerpo = reservar(bearerJugador("j@vibora.com"), "1970-01-01T00:00:00Z").andExpect(status().isBadRequest())
				.andReturn().getResponse().getContentAsString();

		assertThat(cuerpo).doesNotContain(LimitesFecha.MENSAJE);
	}

	// ---- precio ----

	@Test
	void reservar_tarifaMaxima_precioCorrecto() throws Exception {
		tarifa(DayOfWeek.MONDAY, "9999.99");

		reservar(bearerJugador("j@vibora.com"), LUNES.atTime(11, 0).atZone(MADRID).toInstant().toString())
				.andExpect(status().isCreated())
				.andExpect(jsonPath("$.precioTotal").value(14999.99)); // 1,5 h * 9999.99 = 14999.985 -> 14999.99
	}

	@Test
	void reservar_tarifaAntiguaQueDesbordaLaColumna_400NoSeaUn500() throws Exception {
		// Dato heredado (la API ya no lo permite): 999999.99 EUR/h * 1,5 h = 1.499.999,99 no cabe en numeric(8,2)
		tarifa(DayOfWeek.MONDAY, "999999.99");

		reservar(bearerJugador("j@vibora.com"), LUNES.atTime(11, 0).atZone(MADRID).toInstant().toString())
				.andExpect(status().isBadRequest())
				.andExpect(jsonPath("$.error").value("El precio calculado supera el máximo admitido"));
	}
}
