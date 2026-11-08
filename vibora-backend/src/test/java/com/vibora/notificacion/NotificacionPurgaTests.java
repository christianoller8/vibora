package com.vibora.notificacion;

import com.vibora.PostgresTestBase;
import com.vibora.RelojMutable;
import com.vibora.RelojTestConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * Purga de notificaciones antiguas: las LEIDAS se borran pasados 90 dias y las NO leidas pasados 365 (estrictamente mas
 * antiguas que el limite: justo en el limite se conservan), por lotes y devolviendo cuantas borro. Reloj mutable de test
 * (2030-01-01). Commits reales y limpieza en @AfterEach.
 */
@SpringBootTest(properties = { "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!",
		"vibora.notificaciones.lote=3" })
@Import(RelojTestConfig.class)
class NotificacionPurgaTests extends PostgresTestBase {

	@Autowired NotificacionPurgaService purga;
	@Autowired NotificacionRetencionProperties propiedades;
	@Autowired RelojMutable reloj;
	@Autowired JdbcTemplate jdbc;
	@MockitoSpyBean NotificacionRepository notificaciones;

	private long usuarioId;

	@BeforeEach
	void datos() {
		reloj.fijar(RelojTestConfig.AHORA_INICIAL);
		jdbc.update("insert into usuario (email, password_hash, apellidos, rol) values ('purga@x.com', 'h', 'P', 'JUGADOR')");
		usuarioId = jdbc.queryForObject("select max(id) from usuario", Long.class);
		clearInvocations(notificaciones);
	}

	@AfterEach
	void limpiar() {
		jdbc.update("delete from notificacion");
		jdbc.update("delete from usuario");
	}

	private void insertar(boolean leida, Duration antiguedad) {
		insertar(leida, antiguedad, 1);
	}

	private void insertar(boolean leida, Duration antiguedad, int veces) {
		Instant creada = reloj.instant().minus(antiguedad);
		for (int i = 0; i < veces; i++) {
			jdbc.update("insert into notificacion (usuario_id, tipo, mensaje, leida, creada_en) "
					+ "values (?, 'JUGADOR_SE_APUNTO', 'm', ?, ?::timestamptz)", usuarioId, leida, creada.toString());
		}
	}

	private long total() {
		return jdbc.queryForObject("select count(*) from notificacion", Long.class);
	}

	private static Duration dias(long d) {
		return Duration.ofDays(d);
	}

	@Test
	void porDefectoLasLeidasSeConservan90DiasYLasNoLeidas365_yLaPurgaEstaActiva() {
		assertThat(propiedades.retencionDias()).isEqualTo(90);
		assertThat(propiedades.retencionNoLeidasDias()).isEqualTo(365);
		assertThat(propiedades.purgaActiva()).isTrue();
	}

	@Test
	void leidas_borraLasMasAntiguasQue90Dias_yConservaLasDelLimiteYLasMasRecientes() {
		insertar(true, dias(91));
		insertar(true, dias(90).plusSeconds(1));
		insertar(true, dias(90));              // justo en el limite: se conserva
		insertar(true, dias(90).minusSeconds(1));
		insertar(true, dias(1));

		assertThat(purga.purgar()).isEqualTo(2);
		assertThat(total()).isEqualTo(3);
	}

	@Test
	void noLeidas_seConservanHasta365Dias_ySoloSeBorranLasMasAntiguas() {
		insertar(false, dias(366));
		insertar(false, dias(365).plusSeconds(1));
		insertar(false, dias(365));            // limite: se conserva
		insertar(false, dias(200));            // mas vieja que el limite de las leidas, pero sin leer: se conserva
		insertar(false, dias(1));

		assertThat(purga.purgar()).isEqualTo(2);
		assertThat(total()).isEqualTo(3);
		assertThat(jdbc.queryForObject("select count(*) from notificacion where leida", Long.class)).isZero();
	}

	@Test
	void mezcla_devuelveElTotalBorrado_yNoTocaLoQueNoToca() {
		insertar(true, dias(100), 4);
		insertar(false, dias(400), 2);
		insertar(false, dias(100), 5);
		insertar(true, dias(10), 3);

		assertThat(purga.purgar()).isEqualTo(6);
		assertThat(total()).isEqualTo(8);
	}

	@Test
	void borraPorLotes_hastaQueNoQuedaNada() {
		insertar(true, dias(120), 10); // lote = 3: 3 + 3 + 3 + 1
		insertar(false, dias(500), 7); // 3 + 3 + 1
		insertar(true, dias(5), 2);

		assertThat(purga.purgar()).isEqualTo(17);
		assertThat(total()).isEqualTo(2);
		verify(notificaciones, times(4)).borrarLeidasAnterioresA(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq(3));
		verify(notificaciones, times(3)).borrarNoLeidasAnterioresA(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq(3));
	}

	@Test
	void unLoteExacto_comprueba_queNoQuedaNada() {
		insertar(true, dias(120), 6); // dos lotes llenos y uno vacio de confirmacion

		assertThat(purga.purgar()).isEqualTo(6);
		assertThat(total()).isZero();
		verify(notificaciones, times(3)).borrarLeidasAnterioresA(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq(3));
	}

	@Test
	void usaElRelojInyectado() {
		insertar(true, dias(60));
		assertThat(purga.purgar()).isZero();

		reloj.fijar(reloj.instant().plus(dias(31))); // ahora esa notificacion tiene 91 dias
		assertThat(purga.purgar()).isEqualTo(1);
		assertThat(total()).isZero();
	}

	@Test
	void sinNadaQueBorrar_devuelveCero() {
		assertThat(purga.purgar()).isZero();
	}

	@Test
	void laTareaProgramadaCorreCadaDiaALas0330ConLaZonaDelClub_yBorraComoLaPurga() throws Exception {
		Scheduled anotacion = NotificacionPurgaService.class.getMethod("purgaProgramada").getAnnotation(Scheduled.class);
		assertThat(anotacion).isNotNull();
		assertThat(anotacion.cron()).contains("vibora.notificaciones.purga-cron").contains("0 30 3 * * *");
		assertThat(anotacion.zone()).contains("vibora.zona-horaria");

		insertar(true, dias(120));
		purga.purgaProgramada();
		assertThat(total()).isZero();
	}
}
