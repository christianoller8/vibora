package com.vibora.notificacion;

import com.vibora.PostgresTestBase;
import com.vibora.RelojMutable;
import com.vibora.RelojTestConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/** Con vibora.notificaciones.purga-activa=false no se borra nada, ni llamando a purgar() ni por la tarea programada. */
@SpringBootTest(properties = { "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!",
		"vibora.notificaciones.purga-activa=false" })
@Import(RelojTestConfig.class)
class NotificacionPurgaDesactivadaTests extends PostgresTestBase {

	@Autowired NotificacionPurgaService purga;
	@Autowired RelojMutable reloj;
	@Autowired JdbcTemplate jdbc;

	@AfterEach
	void limpiar() {
		jdbc.update("delete from notificacion");
		jdbc.update("delete from usuario");
	}

	@Test
	void desactivada_noBorraNada() {
		reloj.fijar(RelojTestConfig.AHORA_INICIAL);
		jdbc.update("insert into usuario (email, password_hash, apellidos, rol) values ('off@x.com', 'h', 'P', 'JUGADOR')");
		jdbc.update("insert into notificacion (usuario_id, tipo, mensaje, leida, creada_en) "
				+ "select id, 'JUGADOR_SE_APUNTO', 'm', true, timestamptz '2020-01-01 00:00+00' from usuario");
		jdbc.update("insert into notificacion (usuario_id, tipo, mensaje, leida, creada_en) "
				+ "select id, 'JUGADOR_SE_APUNTO', 'm', false, timestamptz '2020-01-01 00:00+00' from usuario");

		assertThat(purga.purgar()).isZero();
		purga.purgaProgramada();

		assertThat(jdbc.queryForObject("select count(*) from notificacion", Long.class)).isEqualTo(2L);
	}
}
