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
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Horizonte de reserva (60 dias, dia natural de Madrid) y tope de reservas ACTIVAS por jugador (10: confirmadas y que
 * aun no han empezado). Reloj fijo en 2030-01-01T00:00Z (01:00 en Madrid); club 08:00-23:00, casillas de 90 minutos.
 */
@Import(RelojTestConfig.class)
@TestPropertySource(properties = { "vibora.reservas.horizonte-dias=60", "vibora.reservas.max-activas-por-usuario=10" })
class ReservaCupoYHorizonteTests extends ApiTestBase {

	static final ZoneId MADRID = ZoneId.of("Europe/Madrid");
	static final LocalDate HOY = LocalDate.of(2030, 1, 1);
	static final String MSG_HORIZONTE = "Solo se puede reservar con hasta 60 días de antelación";
	static final String MSG_CUPO = "Has alcanzado el máximo de reservas activas";

	@Autowired RelojMutable reloj;
	@Autowired PistaRepository pistas;
	@Autowired TarifaFranjaRepository tarifas;

	Club club;
	Pista pista;

	@BeforeEach
	void preparar() {
		reloj.fijar(RelojTestConfig.AHORA_INICIAL);
		club = crearClub("Club cupo");
		pista = pistas.saveAndFlush(TestData.pista(club, "Pista 1"));
		for (DayOfWeek dia : DayOfWeek.values()) {
			TarifaFranja t = TestData.tarifa(club, dia, TipoTarifa.NORMAL);
			t.setHoraInicio(LocalTime.of(8, 0));
			t.setHoraFin(LocalTime.of(23, 0));
			t.setPrecioHora(new BigDecimal("20.00"));
			tarifas.saveAndFlush(t);
		}
	}

	/** Casillas validas del club: cada 90 min desde las 08:00 (11:00 es una; la ultima del dia es 21:30). */
	private static Instant casilla(LocalDate fecha, int hora) {
		return fecha.atTime(hora, hora == 21 ? 30 : 0).atZone(MADRID).toInstant();
	}

	private MvcResult reservar(String token, Instant inicio) throws Exception {
		return mvc.perform(post("/api/clubes/" + club.getId() + "/pistas/" + pista.getId() + "/reservas")
				.header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
				.content("{\"inicio\":\"" + inicio + "\"}")).andReturn();
	}

	private static String mensaje(MvcResult r) throws Exception {
		return r.getResponse().getContentAsString();
	}

	// ---- horizonte ----

	@Test
	void horizonte_laUltimaCasillaDelDia60EsValida_ylaPrimeraDelDia61Es400() throws Exception {
		String token = bearerJugador("hor1@vibora.com");

		MvcResult dentro = reservar(token, casilla(HOY.plusDays(60), 21)); // 21:00-22:30 del ultimo dia permitido
		assertThat(dentro.getResponse().getStatus()).as(mensaje(dentro)).isEqualTo(201);

		MvcResult fuera = reservar(token, casilla(HOY.plusDays(61), 8));
		assertThat(fuera.getResponse().getStatus()).isEqualTo(400);
		assertThat(mensaje(fuera)).contains(MSG_HORIZONTE);
	}

	@Test
	void horizonte_elLimiteEsElDiaNaturalDeMadrid_unSegundoDeMas() throws Exception {
		String token = bearerJugador("hor2@vibora.com");
		Instant ultimoSegundo = HOY.plusDays(60).plusDays(1).atStartOfDay(MADRID).toInstant().minusSeconds(1);
		Instant primerSegundoFuera = ultimoSegundo.plusSeconds(1);

		// 23:59:59 del dia 60 no es el horizonte (puede fallar por la rejilla, pero no por antelacion)
		assertThat(mensaje(reservar(token, ultimoSegundo))).doesNotContain(MSG_HORIZONTE);
		MvcResult fuera = reservar(token, primerSegundoFuera);
		assertThat(fuera.getResponse().getStatus()).isEqualTo(400);
		assertThat(mensaje(fuera)).contains(MSG_HORIZONTE);
	}

	@Test
	void horizonte_seMideDesdeElDiaDeMadridDelReloj_noDesdeElInstanteExacto() throws Exception {
		// 23:30Z del 31-dic-2029 ya es 1-ene-2030 en Madrid (00:30): el dia 60 es el 2-mar-2030, no el 1-mar
		reloj.fijar(Instant.parse("2029-12-31T23:30:00Z"));
		String token = bearerJugador("hor3@vibora.com");

		MvcResult r = reservar(token, casilla(LocalDate.of(2030, 3, 2), 21));
		assertThat(r.getResponse().getStatus()).as(mensaje(r)).isEqualTo(201);
	}

	// ---- tope de reservas activas ----

	@Test
	void cupo_diezReservasSiYLaOncenaEs409() throws Exception {
		String token = bearerJugador("cupo1@vibora.com");
		for (int i = 1; i <= 10; i++) {
			MvcResult r = reservar(token, casilla(HOY.plusDays(i), 11));
			assertThat(r.getResponse().getStatus()).as("reserva %d: %s", i, mensaje(r)).isEqualTo(201);
		}

		MvcResult once = reservar(token, casilla(HOY.plusDays(11), 11));

		assertThat(once.getResponse().getStatus()).isEqualTo(409);
		assertThat(mensaje(once)).contains(MSG_CUPO);
	}

	@Test
	void cupo_esPorJugador_otroJugadorSigueReservando() throws Exception {
		String uno = bearerJugador("cupo2a@vibora.com");
		String otro = bearerJugador("cupo2b@vibora.com");
		for (int i = 1; i <= 10; i++) {
			assertThat(reservar(uno, casilla(HOY.plusDays(i), 11)).getResponse().getStatus()).isEqualTo(201);
		}

		assertThat(reservar(otro, casilla(HOY.plusDays(11), 11)).getResponse().getStatus()).isEqualTo(201);
	}

	@Test
	void cupo_unaCancelacionLiberaUnHueco() throws Exception {
		String token = bearerJugador("cupo3@vibora.com");
		Long primera = null;
		for (int i = 1; i <= 10; i++) {
			MvcResult r = reservar(token, casilla(HOY.plusDays(i + 5), 11));
			if (i == 1) {
				primera = Long.parseLong(mensaje(r).replaceAll("(?s).*?\"id\":(\\d+).*", "$1"));
			}
		}
		assertThat(reservar(token, casilla(HOY.plusDays(20), 11)).getResponse().getStatus()).isEqualTo(409);

		int cancelar = mvc.perform(post("/api/reservas/" + primera + "/cancelar").header("Authorization", token))
				.andReturn().getResponse().getStatus();
		assertThat(cancelar).isEqualTo(200);
		assertThat(primera).isNotNull();

		assertThat(reservar(token, casilla(HOY.plusDays(20), 11)).getResponse().getStatus()).isEqualTo(201);
	}

	@Test
	void cupo_lasReservasQueYaHanEmpezadoNoCuentan() throws Exception {
		String token = bearerJugador("cupo4@vibora.com");
		for (int i = 1; i <= 10; i++) {
			assertThat(reservar(token, casilla(HOY.plusDays(i), 11)).getResponse().getStatus()).isEqualTo(201);
		}
		assertThat(reservar(token, casilla(HOY.plusDays(11), 11)).getResponse().getStatus()).isEqualTo(409);

		// el reloj pasa el inicio de la primera casilla (dia 1, 11:00): ya no es una reserva "por venir"
		reloj.fijar(casilla(HOY.plusDays(1), 11).plus(Duration.ofMinutes(1)));

		MvcResult r = reservar(token, casilla(HOY.plusDays(11), 11));
		assertThat(r.getResponse().getStatus()).as(mensaje(r)).isEqualTo(201);
	}
}
