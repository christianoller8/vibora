package com.vibora.reserva;

import com.vibora.PostgresTestBase;
import com.vibora.TestData;
import com.vibora.club.Club;
import com.vibora.club.ClubRepository;
import com.vibora.partido.ParticipanteRepository;
import com.vibora.pista.Pista;
import com.vibora.pista.PistaRepository;
import com.vibora.tarifa.TarifaFranja;
import com.vibora.tarifa.TarifaFranjaRepository;
import com.vibora.tarifa.TipoTarifa;
import com.vibora.usuario.Rol;
import com.vibora.usuario.UsuarioRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Concurrencia REAL (sin @Transactional): 15 reservas SIMULTANEAS de casillas DISTINTAS del mismo jugador con tope 10.
 * Solo el bloqueo de la fila del usuario antes de contar garantiza exactamente 10 altas y 5 conflictos.
 */
@SpringBootTest(properties = { "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!",
		"vibora.reservas.max-activas-por-usuario=10",
		// el pool de test es de 10: con 15 hilos, 5 esperarian conexion y la carrera quedaria enmascarada por el pool
		"spring.datasource.hikari.maximum-pool-size=25" })
@AutoConfigureMockMvc
class ReservaCupoConcurrenciaTests extends PostgresTestBase {

	private static final ZoneId MADRID = ZoneId.of("Europe/Madrid");
	private static final int INTENTOS = 15;

	@Autowired MockMvc mvc;
	@Autowired ClubRepository clubs;
	@Autowired UsuarioRepository usuarios;
	@Autowired PistaRepository pistas;
	@Autowired TarifaFranjaRepository tarifas;
	@Autowired ReservaRepository reservas;
	/** Espia: el calculo del precio (entre contar e insertar) espera 150 ms para ensanchar la ventana de la carrera. */
	@org.springframework.test.context.bean.override.mockito.MockitoSpyBean com.vibora.tarifa.CalculadoraPrecio calculadora;
	@Autowired ParticipanteRepository participantes;
	@Autowired PasswordEncoder passwordEncoder;

	private Club club;
	private Pista pista;
	private String token;

	@BeforeEach
	void crearDatos() throws Exception {
		club = clubs.saveAndFlush(TestData.club());
		pista = pistas.saveAndFlush(TestData.pista(club, "Pista 1"));
		for (DayOfWeek dia : DayOfWeek.values()) {
			TarifaFranja t = TestData.tarifa(club, dia, TipoTarifa.NORMAL);
			t.setHoraInicio(LocalTime.of(8, 0));
			t.setHoraFin(LocalTime.of(23, 0));
			t.setPrecioHora(new BigDecimal("20.00"));
			tarifas.saveAndFlush(t);
		}
		var u = TestData.usuario("cupo-conc@vibora.com", Rol.JUGADOR, null);
		u.setPasswordHash(passwordEncoder.encode("contraseña-segura"));
		usuarios.saveAndFlush(u);
		String cuerpo = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"cupo-conc@vibora.com\",\"password\":\"contraseña-segura\"}"))
				.andReturn().getResponse().getContentAsString();
		Matcher m = Pattern.compile("\"token\":\"([^\"]+)\"").matcher(cuerpo);
		assertThat(m.find()).as(cuerpo).isTrue();
		token = "Bearer " + m.group(1);
	}

	@AfterEach
	void limpiar() {
		participantes.deleteAllInBatch();
		reservas.deleteAllInBatch();
		tarifas.deleteAllInBatch();
		pistas.deleteAllInBatch();
		usuarios.deleteAllInBatch();
		clubs.deleteAllInBatch();
	}

	@RepeatedTest(3)
	void quinceReservasSimultaneasDeCasillasDistintasConTopeDiezDan10CreadasY5Conflictos() throws Exception {
		org.mockito.Mockito.doAnswer(inv -> {
			Object precio = inv.callRealMethod();
			Thread.sleep(150);
			return precio;
		}).when(calculadora).calcular(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
				org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
		LocalDate base = LocalDate.now(MADRID).plusDays(5);
		ExecutorService pool = Executors.newFixedThreadPool(INTENTOS);
		CyclicBarrier salida = new CyclicBarrier(INTENTOS);
		List<Future<int[]>> futuros = new ArrayList<>();
		for (int i = 0; i < INTENTOS; i++) {
			String inicio = base.plusDays(i).atTime(11, 0).atZone(MADRID).toInstant().toString(); // casillas distintas
			futuros.add(pool.submit(() -> {
				salida.await(30, TimeUnit.SECONDS);
				var r = mvc.perform(post("/api/clubes/" + club.getId() + "/pistas/" + pista.getId() + "/reservas")
						.header("Authorization", token).contentType(MediaType.APPLICATION_JSON)
						.content("{\"inicio\":\"" + inicio + "\"}")).andReturn().getResponse();
				return new int[] { r.getStatus(), r.getContentAsString().contains("máximo de reservas activas") ? 1 : 0 };
			}));
		}
		int creadas = 0;
		int conflictosPorCupo = 0;
		for (Future<int[]> f : futuros) {
			int[] r = f.get(60, TimeUnit.SECONDS);
			if (r[0] == 201) {
				creadas++;
			} else if (r[0] == 409 && r[1] == 1) {
				conflictosPorCupo++;
			}
		}
		pool.shutdown();

		assertThat(creadas).as("201").isEqualTo(10);
		assertThat(conflictosPorCupo).as("409 por cupo").isEqualTo(5);
		assertThat(reservas.count()).isEqualTo(10);
	}
}
