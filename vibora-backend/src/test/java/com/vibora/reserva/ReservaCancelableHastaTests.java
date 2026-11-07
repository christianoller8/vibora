package com.vibora.reserva;

import com.vibora.ApiTestBase;
import com.vibora.RelojMutable;
import com.vibora.RelojTestConfig;
import com.vibora.TestData;
import com.vibora.club.Club;
import com.vibora.pista.Pista;
import com.vibora.pista.PistaRepository;
import com.vibora.tarifa.TarifaFranja;
import com.vibora.tarifa.TarifaFranjaRepository;
import com.vibora.tarifa.TipoTarifa;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code cancelableHasta} = inicio menos las horas de {@code vibora.reservas.cancelacion-minima-horas} (24 por
 * defecto). Es el limite para el PROPIETARIO; el administrador del club no esta sujeto a el: puede cancelar en
 * cualquier momento anterior al inicio.
 */
@Import(RelojTestConfig.class)
class ReservaCancelableHastaTests extends ApiTestBase {

	/** Lunes 2030-01-07 a las 10:00Z (11:00 en Madrid). */
	static final Instant INICIO = Instant.parse("2030-01-07T10:00:00Z");

	@Autowired RelojMutable reloj;
	@Autowired PistaRepository pistas;
	@Autowired TarifaFranjaRepository tarifas;

	Club club;
	Pista pista;

	/** Horas de antelacion configuradas (la subclase usa otro valor). */
	long horas() {
		return 24;
	}

	@BeforeEach
	void preparar() {
		reloj.fijar(RelojTestConfig.AHORA_INICIAL);
		club = crearClub("Club A");
		pista = pistas.saveAndFlush(TestData.pista(club, "Pista 1"));
		TarifaFranja t = TestData.tarifa(club, DayOfWeek.MONDAY, TipoTarifa.NORMAL);
		t.setHoraInicio(LocalTime.of(8, 0));
		t.setHoraFin(LocalTime.of(23, 0));
		t.setPrecioHora(new BigDecimal("20.00"));
		tarifas.saveAndFlush(t);
	}

	private String esperado() {
		return INICIO.minus(Duration.ofHours(horas())).toString();
	}

	private ResultActions reservar(String token) throws Exception {
		return mvc.perform(post("/api/clubes/" + club.getId() + "/pistas/" + pista.getId() + "/reservas")
				.header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
				.content("{\"inicio\":\"" + INICIO + "\"}"));
	}

	private long idDe(ResultActions r) throws Exception {
		Matcher m = Pattern.compile("\"id\":(\\d+)").matcher(r.andReturn().getResponse().getContentAsString());
		assertThat(m.find()).isTrue();
		return Long.parseLong(m.group(1));
	}

	@Test
	void crear_incluyeCancelableHasta() throws Exception {
		reservar(bearerJugador("j@vibora.com")).andExpect(status().isCreated())
				.andExpect(jsonPath("$.cancelableHasta").value(esperado()))
				.andExpect(jsonPath("$.inicio").value("2030-01-07T10:00:00Z"));
	}

	@Test
	void mias_incluyeCancelableHastaEnCadaReserva() throws Exception {
		String token = bearerJugador("j@vibora.com");
		reservar(token).andExpect(status().isCreated());

		mvc.perform(get("/api/reservas/mias").header("Authorization", token)).andExpect(status().isOk())
				.andExpect(jsonPath("$[0].cancelableHasta").value(esperado()));
	}

	@Test
	void cancelar_incluyeCancelableHasta_propietarioYAdmin() throws Exception {
		String token = bearerJugador("j@vibora.com");
		String admin = bearerAdminDe(club, "admin@vibora.com");
		long propia = idDe(reservar(token).andExpect(status().isCreated()));

		mvc.perform(post("/api/reservas/" + propia + "/cancelar").header("Authorization", token))
				.andExpect(status().isOk()).andExpect(jsonPath("$.estado").value("CANCELADA"))
				.andExpect(jsonPath("$.cancelableHasta").value(esperado()));

		// el administrador cancela una reserva ajena aunque ya no queden "horas" de antelacion: el plazo no le aplica
		long ajena = idDe(reservar(bearerJugador("k@vibora.com")).andExpect(status().isCreated()));
		reloj.fijar(INICIO.minus(Duration.ofMinutes(10)));
		mvc.perform(post("/api/reservas/" + ajena + "/cancelar").header("Authorization", admin))
				.andExpect(status().isOk()).andExpect(jsonPath("$.estado").value("CANCELADA"))
				.andExpect(jsonPath("$.cancelableHasta").value(esperado()));
	}

	@Test
	void cancelarYaCancelada_idempotente_incluyeCancelableHasta() throws Exception {
		String token = bearerJugador("j@vibora.com");
		long id = idDe(reservar(token).andExpect(status().isCreated()));
		mvc.perform(post("/api/reservas/" + id + "/cancelar").header("Authorization", token)).andExpect(status().isOk());

		mvc.perform(post("/api/reservas/" + id + "/cancelar").header("Authorization", token))
				.andExpect(status().isOk()).andExpect(jsonPath("$.cancelableHasta").value(esperado()));
	}

	@Test
	void abrirPartido_incluyeCancelableHasta() throws Exception {
		String token = bearerJugador("j@vibora.com");
		long id = idDe(reservar(token).andExpect(status().isCreated()));

		mvc.perform(put("/api/reservas/" + id + "/abierta").header("Authorization", token)
						.contentType(MediaType.APPLICATION_JSON).content("{\"abierta\":true}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.cancelableHasta").value(esperado()));
	}

	@Test
	void elLimiteCoincideConLoQueHaceLaCancelacionDelPropietario() throws Exception {
		String token = bearerJugador("j@vibora.com");
		long id = idDe(reservar(token).andExpect(status().isCreated()));

		reloj.fijar(INICIO.minus(Duration.ofHours(horas())).plusSeconds(1)); // pasado el limite: 409
		mvc.perform(post("/api/reservas/" + id + "/cancelar").header("Authorization", token))
				.andExpect(status().isConflict());
		reloj.fijar(INICIO.minus(Duration.ofHours(horas()))); // justo en el limite: aun puede
		mvc.perform(post("/api/reservas/" + id + "/cancelar").header("Authorization", token))
				.andExpect(status().isOk());
	}
}
