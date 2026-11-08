package com.vibora.reserva;

import com.vibora.PostgresTestBase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Las consultas de solape/agenda de reserva usan tstzrange(inicio, fin) && tstzrange(?, ?) sobre CONFIRMADA para poder
 * usar el indice gist de reserva_sin_solape. Aqui: (1) semantica exacta (semiabierto, adyacentes no solapan, canceladas
 * ignoradas), contrastada con el predicado clasico "inicio < fin AND fin > inicio" sobre datos aleatorios; (2) el plan
 * con 60.000 reservas usa el indice. Commits reales (sin transaccion de test) y limpieza en @AfterEach.
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
class ReservaSolapeConsultasTests extends PostgresTestBase {

	private static final Instant BASE = Instant.parse("2029-03-01T08:00:00Z");

	@Autowired ReservaRepository reservas;
	@Autowired JdbcTemplate jdbc;

	private long pistaId;
	private long otraPistaId;
	private long usuarioId;

	@BeforeEach
	void datosBase() {
		jdbc.update("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '08:00', '23:00')");
		long clubId = jdbc.queryForObject("select max(id) from club", Long.class);
		jdbc.update("insert into pista (club_id, nombre, tipo) values (?, 'P1', 'INTERIOR'), (?, 'P2', 'INTERIOR')", clubId,
				clubId);
		pistaId = jdbc.queryForObject("select id from pista where club_id = ? and nombre = 'P1'", Long.class, clubId);
		otraPistaId = jdbc.queryForObject("select id from pista where club_id = ? and nombre = 'P2'", Long.class, clubId);
		jdbc.update("insert into usuario (email, password_hash, apellidos, rol) values ('solape@x.com', 'h', 'S', 'JUGADOR')");
		usuarioId = jdbc.queryForObject("select max(id) from usuario", Long.class);
	}

	@AfterEach
	void limpiar() {
		jdbc.update("delete from reserva");
		jdbc.update("delete from pista");
		jdbc.update("delete from usuario");
		jdbc.update("delete from club");
	}

	private void insertar(long pista, Instant inicio, Instant fin, String estado) {
		jdbc.update("insert into reserva (pista_id, usuario_id, inicio, fin, estado, precio_total) values (?, ?, ?::timestamptz, "
				+ "?::timestamptz, ?, 10)", pista, usuarioId, inicio.toString(), fin.toString(), estado);
	}

	private static Instant t(int minutos) {
		return BASE.plus(Duration.ofMinutes(minutos));
	}

	// ---- semantica ----

	@Test
	void haySolape_intervalosSemiabiertos_adyacentesNoSolapan_canceladasIgnoradas_yOtraPistaNoCuenta() {
		insertar(pistaId, t(0), t(90), "CONFIRMADA");      // 08:00-09:30
		insertar(pistaId, t(120), t(210), "CANCELADA");    // 10:00-11:30, cancelada
		insertar(pistaId, t(210), t(300), "CONFIRMADA");   // 11:30-13:00, adyacente a la cancelada
		insertar(otraPistaId, t(300), t(390), "CONFIRMADA");

		assertThat(reservas.haySolape(pistaId, t(90), t(180))).as("empieza donde acaba la primera").isFalse();
		assertThat(reservas.haySolape(pistaId, t(-90), t(0))).as("acaba donde empieza la primera").isFalse();
		assertThat(reservas.haySolape(pistaId, t(89), t(180))).as("pisa el ultimo minuto").isTrue();
		assertThat(reservas.haySolape(pistaId, t(-1), t(1))).as("pisa el primer minuto").isTrue();
		assertThat(reservas.haySolape(pistaId, t(30), t(60))).as("contenida").isTrue();
		assertThat(reservas.haySolape(pistaId, t(-30), t(120))).as("envolvente").isTrue();
		assertThat(reservas.haySolape(pistaId, t(120), t(210))).as("solo choca con una cancelada").isFalse();
		assertThat(reservas.haySolape(pistaId, t(209), t(211))).as("toca la confirmada adyacente").isTrue();
		assertThat(reservas.haySolape(pistaId, t(300), t(360))).as("la reserva es de otra pista").isFalse();
	}

	@Test
	void solapadasConfirmadas_devuelveSoloLasConfirmadasQueSolapan_ordenadasPorInicio() {
		insertar(pistaId, t(210), t(300), "CONFIRMADA");
		insertar(pistaId, t(0), t(90), "CONFIRMADA");
		insertar(pistaId, t(120), t(210), "CANCELADA");
		insertar(pistaId, t(1000), t(1090), "CONFIRMADA");
		insertar(otraPistaId, t(0), t(90), "CONFIRMADA");

		List<Reserva> agenda = reservas.solapadasConfirmadas(pistaId, t(0), t(500));

		assertThat(agenda).extracting(Reserva::getInicio).containsExactly(t(0), t(210));
		assertThat(agenda).allSatisfy(r -> assertThat(r.getEstado()).isEqualTo(EstadoReserva.CONFIRMADA));
		// adyacente por ambos lados: no entra
		assertThat(reservas.solapadasConfirmadas(pistaId, t(90), t(210))).isEmpty();
	}

	@Test
	void equivalenteAlPredicadoClasico_sobreReservasYConsultasAleatorias() {
		Random azar = new Random(42);
		List<Instant[]> confirmadas = new ArrayList<>();
		int cursor = 0;
		for (int i = 0; i < 150; i++) {
			cursor += azar.nextInt(60); // hueco (0 = adyacente a la anterior)
			int duracion = 15 + azar.nextInt(120);
			insertar(pistaId, t(cursor), t(cursor + duracion), "CONFIRMADA");
			confirmadas.add(new Instant[] { t(cursor), t(cursor + duracion) });
			cursor += duracion;
			// una cancelada arbitraria (puede pisar a cualquiera: no bloquea)
			int ci = azar.nextInt(cursor + 1);
			insertar(pistaId, t(ci), t(ci + 20 + azar.nextInt(100)), "CANCELADA");
		}
		for (int q = 0; q < 300; q++) {
			Instant desde = t(azar.nextInt(cursor + 200) - 100);
			Instant hasta = desde.plus(Duration.ofMinutes(1 + azar.nextInt(200)));
			List<Instant> esperadas = confirmadas.stream()
					.filter(r -> r[0].isBefore(hasta) && r[1].isAfter(desde)).map(r -> r[0]).toList();

			assertThat(reservas.haySolape(pistaId, desde, hasta)).as("haySolape %s-%s", desde, hasta)
					.isEqualTo(!esperadas.isEmpty());
			assertThat(reservas.solapadasConfirmadas(pistaId, desde, hasta)).as("agenda %s-%s", desde, hasta)
					.extracting(Reserva::getInicio).containsExactlyElementsOf(esperadas);
		}
	}

	// ---- rendimiento: el plan usa el indice gist de reserva_sin_solape ----

	@Test
	void conSesentaMilReservas_lasConsultasUsanElIndiceGistDeReservaSinSolape() {
		jdbc.update("insert into pista (club_id, nombre, tipo) select c.id, 'X' || n, 'INTERIOR' "
				+ "from club c, generate_series(1, 98) n");
		// 98 pistas + las 2 del fixture = 100 pistas x 600 reservas (una al dia, sin solapes): 60.000 filas; 1 de cada 7 cancelada
		jdbc.update("insert into reserva (pista_id, usuario_id, inicio, fin, estado, precio_total) "
				+ "select p.id, ?, timestamptz '2027-01-01 10:00+00' + n * interval '1 day', "
				+ "timestamptz '2027-01-01 11:30+00' + n * interval '1 day', "
				+ "case when n % 7 = 0 then 'CANCELADA' else 'CONFIRMADA' end, 30 "
				+ "from pista p, generate_series(0, 599) n", usuarioId);
		jdbc.execute("vacuum analyze reserva");
		jdbc.execute("analyze pista");
		assertThat(jdbc.queryForObject("select count(*) from reserva", Long.class)).isEqualTo(60000L);

		String pista = String.valueOf(pistaId);
		String hay = ReservaRepository.SQL_HAY_SOLAPE
				.replace(":pistaId", pista).replace(":inicio", "'2028-03-01 10:00+00'").replace(":fin", "'2028-03-01 11:30+00'");
		String agenda = ReservaRepository.SQL_SOLAPADAS_CONFIRMADAS
				.replace(":pistaId", pista).replace(":desde", "'2028-03-01 00:00+00'").replace(":hasta", "'2028-03-02 00:00+00'");

		for (String consulta : List.of(hay, agenda)) {
			String plan = String.join("\n", jdbc.queryForList("explain " + consulta, String.class));
			assertThat(plan).as(plan).contains("reserva_sin_solape").doesNotContain("Seq Scan on reserva");
		}
	}
}
