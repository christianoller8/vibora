package com.vibora;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V7 (endurecimiento de la BD): se migra paso a paso (hasta V6, datos, V7). Las restricciones nuevas existen con su
 * nombre y rechazan lo que deben; la comprobacion previa aborta con un mensaje claro cuando los datos de V6 las
 * violarian; y los indices de notificaciones se usan de verdad en las consultas reales.
 */
class MigracionV7Tests extends PostgresTestBase {

	private String url;
	private String usuario;
	private String password;

	private void baseNueva(String prefijo) throws Exception {
		String base = prefijo + System.nanoTime();
		usuario = POSTGRES.getUsername();
		password = POSTGRES.getPassword();
		try (Connection c = DriverManager.getConnection(POSTGRES.getJdbcUrl(), usuario, password);
				Statement s = c.createStatement()) {
			s.execute("create database " + base);
		}
		url = POSTGRES.getJdbcUrl().replace("/" + POSTGRES.getDatabaseName(), "/" + base);
	}

	private void migrarHasta(String version) {
		Flyway.configure().dataSource(url, usuario, password).target(version).load().migrate();
	}

	private Connection conexion() throws SQLException {
		return DriverManager.getConnection(url, usuario, password);
	}

	private static List<String> lista(Statement s, String sql) throws SQLException {
		List<String> resultado = new ArrayList<>();
		ResultSet rs = s.executeQuery(sql);
		while (rs.next()) {
			resultado.add(rs.getString(1));
		}
		return resultado;
	}

	private void v6ConDatos(String... sentenciasExtra) throws Exception {
		migrarHasta("6");
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			for (String sql : sentenciasExtra) {
				s.execute(sql);
			}
		}
	}

	private void migrarV7() {
		Flyway.configure().dataSource(url, usuario, password).load().migrate();
	}

	// ---- aplicacion limpia ----

	@Test
	void v7AplicaSobreDatosValidos_creaLasRestriccionesConSusNombres_yConservaLosDatos() throws Exception {
		baseNueva("migracion_v7_");
		v6ConDatos(
				"insert into club (nombre, hora_apertura, hora_cierre) values ('C', '08:00', '23:00')",
				"insert into usuario (email, password_hash, apellidos, rol) values ('a@x.com', 'h', 'A', 'JUGADOR')",
				"insert into tarifa_franja (club_id, dia_semana, hora_inicio, hora_fin, precio_hora, tipo) "
						+ "select id, 1, '18:00', '20:00', 10, 'NORMAL' from club",
				// franja adyacente [20:00-22:00): debe seguir permitida
				"insert into tarifa_franja (club_id, dia_semana, hora_inicio, hora_fin, precio_hora, tipo) "
						+ "select id, 1, '20:00', '22:00', 12, 'HORA_PUNTA' from club");

		migrarV7();

		try (Connection c = conexion(); Statement s = c.createStatement()) {
			assertThat(lista(s, "select conname from pg_constraint where conname in ('usuario_email_normalizado_ck', "
					+ "'club_horario_ck', 'tarifa_sin_solape', 'usuario_email_uk') order by conname"))
					.containsExactly("club_horario_ck", "tarifa_sin_solape", "usuario_email_normalizado_ck",
							"usuario_email_uk");
			assertThat(lista(s, "select indexname from pg_indexes where indexname in ('usuario_email_lower_uk', "
					+ "'notificacion_usuario_creada_idx', 'notificacion_usuario_no_leidas_idx', 'notificacion_creada_en_idx') "
					+ "order by indexname"))
					.containsExactly("notificacion_creada_en_idx", "notificacion_usuario_creada_idx",
							"notificacion_usuario_no_leidas_idx", "usuario_email_lower_uk");
			assertThat(lista(s, "select indexname from pg_indexes where indexname in ('notificacion_usuario_leida_idx', "
					+ "'pista_club_id_idx')")).isEmpty();
			assertThat(lista(s, "select indexdef from pg_indexes where indexname = 'notificacion_usuario_no_leidas_idx'"))
					.singleElement().asString().contains("WHERE (NOT leida)");
			assertThat(lista(s, "select count(*) from tarifa_franja")).containsExactly("2");
			assertThat(lista(s, "select count(*) from usuario")).containsExactly("1");
			assertThat(lista(s, "select max(version::int)::text from flyway_schema_history")).containsExactly("7");
		}
	}

	// ---- cada restriccion rechaza lo que debe (con su nombre en la causa) ----

	@Test
	void losEmailsSeRechazanSiSoloSeDiferenciaEnMayusculasOEspacios_yLosNoNormalizadosTambien() throws Exception {
		baseNueva("migracion_v7_email_");
		migrarHasta("7");
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute("insert into usuario (email, password_hash, apellidos, rol) values ('a@x.com', 'h', 'A', 'JUGADOR')");

			// no normalizado: lo para el CHECK (se evalua antes que los indices unicos)
			assertThatThrownBy(() -> s.execute("insert into usuario (email, password_hash, apellidos, rol) "
					+ "values ('A@x.com', 'h', 'A', 'JUGADOR')")).hasMessageContaining("usuario_email_normalizado_ck");
			assertThatThrownBy(() -> s.execute("insert into usuario (email, password_hash, apellidos, rol) "
					+ "values (' a@x.com', 'h', 'A', 'JUGADOR')")).hasMessageContaining("usuario_email_normalizado_ck");

			// el indice unico sobre lower(btrim()) es la segunda barrera: sin el CHECK, la variante tambien chocaria
			s.execute("alter table usuario drop constraint usuario_email_normalizado_ck");
			assertThatThrownBy(() -> s.execute("insert into usuario (email, password_hash, apellidos, rol) "
					+ "values ('A@X.com ', 'h', 'A', 'JUGADOR')")).hasMessageContaining("usuario_email_lower_uk");
			// y el exacto sigue chocando con el de siempre
			assertThatThrownBy(() -> s.execute("insert into usuario (email, password_hash, apellidos, rol) "
					+ "values ('a@x.com', 'h', 'A', 'JUGADOR')")).hasMessageContaining("usuario_email_uk");
		}
	}

	@Test
	void unClubNoPuedeCerrarAntesOIgualQueAbre() throws Exception {
		baseNueva("migracion_v7_club_");
		migrarHasta("7");
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			assertThatThrownBy(() -> s.execute("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '10:00', '10:00')"))
					.hasMessageContaining("club_horario_ck");
			assertThatThrownBy(() -> s.execute("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '10:00', '09:00')"))
					.hasMessageContaining("club_horario_ck");
			s.execute("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '08:00', '23:00')");
		}
	}

	@Test
	void dosFranjasSolapadasDelMismoClubYDiaSeRechazan_perAdyacentesYOtrosDiasOClubesNo() throws Exception {
		baseNueva("migracion_v7_tarifa_");
		migrarHasta("7");
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute("insert into club (nombre, hora_apertura, hora_cierre) values ('C1', '08:00', '23:00'), ('C2', '08:00', '23:00')");
			String franja = "insert into tarifa_franja (club_id, dia_semana, hora_inicio, hora_fin, precio_hora, tipo) "
					+ "select id, %d, '%s', '%s', 10, 'NORMAL' from club where nombre = '%s'";
			s.execute(franja.formatted(1, "18:00", "20:00", "C1"));

			// adyacentes, otro dia y otro club: permitidos
			s.execute(franja.formatted(1, "20:00", "22:00", "C1"));
			s.execute(franja.formatted(1, "16:00", "18:00", "C1"));
			s.execute(franja.formatted(2, "18:00", "20:00", "C1"));
			s.execute(franja.formatted(1, "18:00", "20:00", "C2"));

			// solapes parciales, contenidos y envolventes: rechazados
			assertThatThrownBy(() -> s.execute(franja.formatted(1, "19:00", "21:00", "C1")))
					.hasMessageContaining("tarifa_sin_solape");
			assertThatThrownBy(() -> s.execute(franja.formatted(1, "18:30", "19:00", "C1")))
					.hasMessageContaining("tarifa_sin_solape");
			assertThatThrownBy(() -> s.execute(franja.formatted(1, "15:00", "23:00", "C1")))
					.hasMessageContaining("tarifa_sin_solape");
		}
	}

	// ---- comprobacion previa: la migracion aborta con un mensaje claro ----

	private void exigeAbortoConMensaje(String mensaje) throws Exception {
		assertThatThrownBy(this::migrarV7).isInstanceOf(FlywayException.class).hasMessageContaining(mensaje);
		// no queda nada a medias: la migracion es transaccional
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			assertThat(lista(s, "select max(version::int)::text from flyway_schema_history")).containsExactly("6");
			assertThat(lista(s, "select conname from pg_constraint where conname in ('club_horario_ck', 'tarifa_sin_solape', "
					+ "'usuario_email_normalizado_ck')")).isEmpty();
		}
	}

	@Test
	void laComprobacionPreviaAbortaConEmailsDuplicadosAlIgnorarMayusculas() throws Exception {
		baseNueva("migracion_v7_pre_dup_");
		v6ConDatos(
				"insert into usuario (email, password_hash, apellidos, rol) values ('a@x.com', 'h', 'A', 'JUGADOR')",
				"insert into usuario (email, password_hash, apellidos, rol) values ('a@x.com ', 'h', 'A', 'JUGADOR')");

		exigeAbortoConMensaje("V7: hay 1 email(s) duplicados al ignorar mayusculas y espacios");
	}

	@Test
	void laComprobacionPreviaAbortaConUnEmailNoNormalizado() throws Exception {
		baseNueva("migracion_v7_pre_email_");
		v6ConDatos("insert into usuario (email, password_hash, apellidos, rol) values ('Solo@X.com', 'h', 'A', 'JUGADOR')");

		exigeAbortoConMensaje("V7: hay 1 usuario(s) cuyo email no esta normalizado");
	}

	@Test
	void laComprobacionPreviaAbortaConUnClubQueCierraAntesDeAbrir() throws Exception {
		baseNueva("migracion_v7_pre_club_");
		v6ConDatos("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '10:00', '10:00')");

		exigeAbortoConMensaje("V7: hay 1 club(es) cuya hora de cierre no es posterior a la de apertura");
	}

	@Test
	void laComprobacionPreviaAbortaConFranjasSolapadas() throws Exception {
		baseNueva("migracion_v7_pre_tarifa_");
		v6ConDatos(
				"insert into club (nombre, hora_apertura, hora_cierre) values ('C', '08:00', '23:00')",
				"insert into tarifa_franja (club_id, dia_semana, hora_inicio, hora_fin, precio_hora, tipo) "
						+ "select id, 1, '18:00', '20:00', 10, 'NORMAL' from club",
				"insert into tarifa_franja (club_id, dia_semana, hora_inicio, hora_fin, precio_hora, tipo) "
						+ "select id, 1, '19:00', '21:00', 10, 'NORMAL' from club");

		exigeAbortoConMensaje("V7: hay 1 pareja(s) de franjas de tarifa solapadas");
	}

	@Test
	void elMensajeDeLaComprobacionPreviaNoFiltraEmails() throws Exception {
		baseNueva("migracion_v7_pre_pii_");
		v6ConDatos("insert into usuario (email, password_hash, apellidos, rol) values ('Secreto@Privado.com', 'h', 'A', 'JUGADOR')");

		assertThatThrownBy(this::migrarV7).hasMessageNotContaining("Secreto").hasMessageNotContaining("Privado");
	}

	// ---- los indices de notificaciones se usan en las consultas reales ----

	@Test
	void lasConsultasDeNotificacionesUsanLosIndicesNuevos() throws Exception {
		baseNueva("migracion_v7_plan_");
		migrarHasta("7");
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute("insert into usuario (email, password_hash, apellidos, rol) select 'u' || g || '@x.com', 'h', 'U', 'JUGADOR' "
					+ "from generate_series(1, 100) g");
			// 100 usuarios x 300 notificaciones (30.000 filas), el 5 % sin leer
			s.execute("insert into notificacion (usuario_id, tipo, mensaje, leida, creada_en) "
					+ "select u.id, 'JUGADOR_SE_APUNTO', 'm', n % 20 <> 0, timestamptz '2029-01-01 00:00+00' + n * interval '1 hour' "
					+ "from usuario u, generate_series(1, 300) n");
			s.execute("vacuum analyze notificacion");
			assertThat(lista(s, "select count(*) from notificacion")).containsExactly("30000");
			String id = lista(s, "select min(id) from usuario").get(0);

			assertThat(plan(s, "select * from notificacion where usuario_id = " + id
					+ " order by creada_en desc, id desc limit 20"))
					.contains("notificacion_usuario_creada_idx").doesNotContain("Seq Scan").doesNotContain("Sort");
			assertThat(plan(s, "select * from notificacion where usuario_id = " + id + " and leida = false "
					+ "order by creada_en desc, id desc limit 20"))
					.contains("notificacion_usuario_no_leidas_idx").doesNotContain("Seq Scan");
			assertThat(plan(s, "select count(*) from notificacion where usuario_id = " + id + " and leida = false"))
					.contains("notificacion_usuario_no_leidas_idx").doesNotContain("Seq Scan");
			assertThat(plan(s, "select id from notificacion where creada_en < timestamptz '2029-01-01 05:00+00' limit 1000"))
					.contains("notificacion_creada_en_idx").doesNotContain("Seq Scan");
		}
	}

	private static String plan(Statement s, String consulta) throws SQLException {
		return String.join("\n", lista(s, "explain " + consulta));
	}
}
