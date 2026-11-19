package com.vibora;

import org.flywaydb.core.Flyway;
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
 * V8 (invitaciones del personal): se migra hasta V7, se insertan datos y se aplica V8. La tabla, sus restricciones
 * (con nombre) y sus indices existen; el CHECK de tipos de notificacion acepta los tres tipos nuevos y sigue
 * rechazando cualquier otro; los datos previos se conservan.
 */
class MigracionV8Tests extends PostgresTestBase {

	private String url;
	private String usuario;
	private String password;

	private void baseNuevaEnV7ConDatos() throws Exception {
		String base = "migracion_v8_" + System.nanoTime();
		usuario = POSTGRES.getUsername();
		password = POSTGRES.getPassword();
		try (Connection c = DriverManager.getConnection(POSTGRES.getJdbcUrl(), usuario, password);
				Statement s = c.createStatement()) {
			s.execute("create database " + base);
		}
		url = POSTGRES.getJdbcUrl().replace("/" + POSTGRES.getDatabaseName(), "/" + base);
		Flyway.configure().dataSource(url, usuario, password).target("7").load().migrate();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '08:00', '23:00')");
			s.execute("insert into usuario (email, password_hash, apellidos, rol, club_id) "
					+ "select 'admin@x.com', 'h', 'A', 'ADMIN_CLUB', id from club");
			s.execute("insert into usuario (email, password_hash, apellidos, rol) values ('j@x.com', 'h', 'J', 'JUGADOR')");
			s.execute("insert into notificacion (usuario_id, tipo, mensaje, creada_en) "
					+ "select id, 'PERSONAL_ANADIDO', 'm', now() from usuario where email = 'j@x.com'");
		}
		Flyway.configure().dataSource(url, usuario, password).load().migrate();
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

	private static String invitacion(String email, String rol, String estado, String creada, String caduca, String resuelta) {
		return "insert into invitacion_personal (club_id, email, rol, estado, invitado_por, creada_en, caduca_en, resuelta_en) "
				+ "select c.id, " + email + ", " + rol + ", " + estado + ", u.id, " + creada + ", " + caduca + ", " + resuelta
				+ " from club c, usuario u where u.email = 'admin@x.com'";
	}

	private static final String AHORA = "'2030-01-01T00:00:00Z'";
	private static final String MAS_14 = "'2030-01-15T00:00:00Z'";

	@Test
	void v8CreaLaTablaConSusRestriccionesEIndices_yConservaLosDatos() throws Exception {
		baseNuevaEnV7ConDatos();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			assertThat(lista(s, "select conname from pg_constraint where conname like 'invitacion_personal_%' "
					+ "and contype = 'c' order by conname"))
					.containsExactly("invitacion_personal_caducidad_ck", "invitacion_personal_email_normalizado_ck",
							"invitacion_personal_estado_ck", "invitacion_personal_resuelta_ck", "invitacion_personal_rol_ck");
			assertThat(lista(s, "select indexname from pg_indexes where tablename = 'invitacion_personal' "
					+ "and indexname <> 'invitacion_personal_pkey' order by indexname"))
					.containsExactly("invitacion_personal_club_estado_idx", "invitacion_personal_email_pendiente_idx",
							"invitacion_personal_invitado_por_idx", "invitacion_personal_pendiente_uk");
			assertThat(lista(s, "select indexdef from pg_indexes where indexname = 'invitacion_personal_pendiente_uk'"))
					.singleElement().asString().contains("UNIQUE").contains("PENDIENTE");
			assertThat(lista(s, "select count(*) from usuario")).containsExactly("2");
			assertThat(lista(s, "select count(*) from notificacion")).containsExactly("1");
			assertThat(lista(s, "select max(version::int)::text from flyway_schema_history")).containsExactly("8");
		}
	}

	@Test
	void estadoPorDefectoEsPendiente_yUnaFilaValidaEntra() throws Exception {
		baseNuevaEnV7ConDatos();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute("insert into invitacion_personal (club_id, email, rol, invitado_por, creada_en, caduca_en) "
					+ "select c.id, 'nueva@x.com', 'MONITOR', u.id, " + AHORA + ", " + MAS_14
					+ " from club c, usuario u where u.email = 'admin@x.com'");
			assertThat(lista(s, "select estado from invitacion_personal")).containsExactly("PENDIENTE");
		}
	}

	@Test
	void lasRestriccionesRechazanLoQueDeben_conSuNombre() throws Exception {
		baseNuevaEnV7ConDatos();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			assertThatThrownBy(() -> s.execute(invitacion("'Mayus@x.com'", "'MONITOR'", "'PENDIENTE'", AHORA, MAS_14, "null")))
					.hasMessageContaining("invitacion_personal_email_normalizado_ck");
			assertThatThrownBy(() -> s.execute(invitacion("' a@x.com'", "'MONITOR'", "'PENDIENTE'", AHORA, MAS_14, "null")))
					.hasMessageContaining("invitacion_personal_email_normalizado_ck");
			assertThatThrownBy(() -> s.execute(invitacion("'a@x.com'", "'ADMIN_CLUB'", "'PENDIENTE'", AHORA, MAS_14, "null")))
					.hasMessageContaining("invitacion_personal_rol_ck");
			assertThatThrownBy(() -> s.execute(invitacion("'a@x.com'", "'JUGADOR'", "'PENDIENTE'", AHORA, MAS_14, "null")))
					.hasMessageContaining("invitacion_personal_rol_ck");
			assertThatThrownBy(() -> s.execute(invitacion("'a@x.com'", "'MONITOR'", "'OTRA'", AHORA, MAS_14, "null")))
					.hasMessageContaining("invitacion_personal_estado_ck");
			// caduca_en debe ser posterior a creada_en (igual tampoco vale)
			assertThatThrownBy(() -> s.execute(invitacion("'a@x.com'", "'MONITOR'", "'PENDIENTE'", AHORA, AHORA, "null")))
					.hasMessageContaining("invitacion_personal_caducidad_ck");
			// un estado resuelto exige resuelta_en...
			for (String estado : List.of("'ACEPTADA'", "'RECHAZADA'", "'CANCELADA'", "'CADUCADA'")) {
				assertThatThrownBy(() -> s.execute(invitacion("'a@x.com'", "'MONITOR'", estado, AHORA, MAS_14, "null")))
						.hasMessageContaining("invitacion_personal_resuelta_ck");
			}
			// ...y una PENDIENTE no puede tenerla
			assertThatThrownBy(() -> s.execute(invitacion("'a@x.com'", "'MONITOR'", "'PENDIENTE'", AHORA, MAS_14, AHORA)))
					.hasMessageContaining("invitacion_personal_resuelta_ck");
			// y las validas entran
			s.execute(invitacion("'a@x.com'", "'MANTENIMIENTO'", "'CADUCADA'", AHORA, MAS_14, MAS_14));
			assertThat(lista(s, "select count(*) from invitacion_personal")).containsExactly("1");
		}
	}

	@Test
	void soloUnaPendientePorClubYEmail_peroLasResueltasNoEstorban() throws Exception {
		baseNuevaEnV7ConDatos();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute(invitacion("'a@x.com'", "'MONITOR'", "'PENDIENTE'", AHORA, MAS_14, "null"));
			assertThatThrownBy(() -> s.execute(invitacion("'a@x.com'", "'MANTENIMIENTO'", "'PENDIENTE'", AHORA, MAS_14, "null")))
					.hasMessageContaining("invitacion_personal_pendiente_uk");
			// resueltas: tantas como se quiera, incluso del mismo email
			s.execute(invitacion("'a@x.com'", "'MONITOR'", "'RECHAZADA'", AHORA, MAS_14, AHORA));
			s.execute(invitacion("'a@x.com'", "'MONITOR'", "'RECHAZADA'", AHORA, MAS_14, AHORA));
			// otro email, misma pendiente: vale
			s.execute(invitacion("'b@x.com'", "'MONITOR'", "'PENDIENTE'", AHORA, MAS_14, "null"));
			assertThat(lista(s, "select count(*) from invitacion_personal")).containsExactly("4");
		}
	}

	@Test
	void elCheckDeTiposDeNotificacionAceptaLosTresNuevos_yRechazaOtros_ySeConservanLosAnteriores() throws Exception {
		baseNuevaEnV7ConDatos();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			for (String tipo : List.of("INVITACION_RECIBIDA", "INVITACION_ACEPTADA", "INVITACION_RECHAZADA",
					"FACTURA_RECTIFICATIVA", "PERSONAL_ANADIDO", "JUGADOR_SE_APUNTO")) {
				s.execute("insert into notificacion (usuario_id, tipo, mensaje, creada_en) "
						+ "select id, '" + tipo + "', 'm', now() from usuario where email = 'j@x.com'");
			}
			assertThatThrownBy(() -> s.execute("insert into notificacion (usuario_id, tipo, mensaje, creada_en) "
					+ "select id, 'INVITACION_OTRA', 'm', now() from usuario where email = 'j@x.com'"))
					.hasMessageContaining("notificacion_tipo_ck");
		}
	}
}
