package com.vibora;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * ops/db-roles.sql: tras migrar con el superusuario del contenedor y ejecutar el script REAL del repositorio, el rol de la
 * aplicacion (vibora_app) puede hacer DML pero ni DDL ni tocar las facturas, y vibora_ro solo lee.
 */
class RolesBdTest extends PostgresTestBase {

	private static final String PASSWORD = "clave-de-test";

	private String base;
	private String urlBase;

	@BeforeEach
	void prepararBase() throws Exception {
		base = "roles_" + System.nanoTime();
		try (Connection c = superusuario(POSTGRES.getJdbcUrl()); Statement s = c.createStatement()) {
			s.execute("create database " + base);
		}
		urlBase = POSTGRES.getJdbcUrl().replace("/" + POSTGRES.getDatabaseName(), "/" + base);
		Flyway.configure().dataSource(urlBase, POSTGRES.getUsername(), POSTGRES.getPassword()).load().migrate();
		ejecutarScript();
	}

	private Connection superusuario(String url) throws SQLException {
		return DriverManager.getConnection(url, POSTGRES.getUsername(), POSTGRES.getPassword());
	}

	private void ejecutarScript() throws Exception {
		Path script = Path.of("..", "ops", "db-roles.sql");
		if (!Files.exists(script)) {
			script = Path.of("ops", "db-roles.sql");
		}
		String sql = Files.readString(script, StandardCharsets.UTF_8);
		try (Connection c = superusuario(urlBase); Statement s = c.createStatement()) {
			s.execute(sql);
			for (String rol : new String[] { "vibora_owner", "vibora_app", "vibora_ro" }) {
				s.execute("alter role " + rol + " password '" + PASSWORD + "'");
			}
		}
	}

	private Connection como(String rol) throws SQLException {
		return DriverManager.getConnection(urlBase, rol, PASSWORD);
	}

	private static String uno(Statement s, String sql) throws SQLException {
		ResultSet rs = s.executeQuery(sql);
		rs.next();
		return rs.getString(1);
	}

	@Test
	void losRolesNoSonSuperusuarioNiPuedenCrearRolesNiBases() throws Exception {
		try (Connection c = superusuario(urlBase); Statement s = c.createStatement()) {
			assertThat(uno(s, "select count(*) from pg_roles where rolname in ('vibora_owner','vibora_app','vibora_ro') "
					+ "and not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls and rolcanlogin"))
					.isEqualTo("3");
			assertThat(uno(s, "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'flyway_schema_history' "
					+ "and tableowner = 'vibora_owner'")).isEqualTo("15");
		}
	}

	@Test
	void laAplicacionHaceDmlEnTablasRepresentativas_incluidasLasSecuencias() throws Exception {
		try (Connection c = como("vibora_app"); Statement s = c.createStatement()) {
			s.execute("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '08:00', '23:00')");
			s.execute("insert into usuario (email, password_hash, apellidos, rol) values ('a@x.com', 'h', 'A', 'JUGADOR')");
			s.execute("insert into pista (club_id, nombre, tipo) select id, 'P1', 'INTERIOR' from club");
			s.execute("insert into reserva (pista_id, usuario_id, inicio, fin, estado, precio_total) "
					+ "select p.id, u.id, '2030-01-07T10:00Z', '2030-01-07T11:30Z', 'CONFIRMADA', 45 from pista p, usuario u");
			s.execute("insert into notificacion (usuario_id, tipo, mensaje) select id, 'JUGADOR_SE_APUNTO', 'm' from usuario");
			assertThat(uno(s, "select count(*) from reserva")).isEqualTo("1");
			assertThat(s.executeUpdate("update reserva set estado = 'CANCELADA'")).isEqualTo(1);
			assertThat(s.executeUpdate("update club set nombre = 'D'")).isEqualTo(1);
			assertThat(s.executeUpdate("delete from notificacion")).isEqualTo(1);
			assertThat(s.executeUpdate("delete from reserva")).isEqualTo(1);
			// secuencias: USAGE concedido (las de identidad y, por si acaso, nextval explicito)
			assertThat(uno(s, "select nextval(pg_get_serial_sequence('club', 'id')) > 0")).isEqualTo("t");
		}
	}

	@Test
	void enFacturaSoloSeInsertaYSeLee_peroFacturaSerieSeActualiza() throws Exception {
		try (Connection c = como("vibora_app"); Statement s = c.createStatement()) {
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'SELECT')")).isEqualTo("t");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'INSERT')")).isEqualTo("t");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'UPDATE')")).isEqualTo("f");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'DELETE')")).isEqualTo("f");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'TRUNCATE')")).isEqualTo("f");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura_serie', 'UPDATE')")).isEqualTo("t");

			assertThatThrownBy(() -> s.execute("update factura set club_id = club_id where false"))
					.hasMessageContaining("permission denied for table factura");
			assertThatThrownBy(() -> s.execute("delete from factura where false"))
					.hasMessageContaining("permission denied for table factura");
		}
	}

	@Test
	void laAplicacionNoPuedeHacerDdlNiDesactivarTriggersNiTruncar() throws Exception {
		try (Connection c = como("vibora_app"); Statement s = c.createStatement()) {
			assertThatThrownBy(() -> s.execute("drop table club cascade")).hasMessageContaining("must be owner");
			assertThatThrownBy(() -> s.execute("alter table factura disable trigger factura_inmutable_tg"))
					.hasMessageContaining("must be owner");
			assertThatThrownBy(() -> s.execute("alter table factura disable trigger all")).hasMessageContaining("must be owner");
			assertThatThrownBy(() -> s.execute("alter table club add column x int")).hasMessageContaining("must be owner");
			assertThatThrownBy(() -> s.execute("create table intruso (id int)")).hasMessageContaining("permission denied for schema public");
			assertThatThrownBy(() -> s.execute("truncate reserva")).hasMessageContaining("permission denied for table reserva");
			assertThatThrownBy(() -> s.execute("create temporary table t (id int)")).hasMessageContaining("permission denied");
			assertThatThrownBy(() -> s.execute("select * from flyway_schema_history")).hasMessageContaining("permission denied");
			assertThatThrownBy(() -> s.execute("create role otro")).hasMessageContaining("permission denied");
			assertThatThrownBy(() -> s.execute("set role vibora_owner")).hasMessageContaining("permission denied");
		}
	}

	@Test
	void soloLecturaPuedeLeerPeroNoEscribir() throws Exception {
		try (Connection c = como("vibora_ro"); Statement s = c.createStatement()) {
			assertThat(uno(s, "select count(*) from club")).isEqualTo("0");
			assertThat(uno(s, "select count(*) from factura")).isEqualTo("0");
			assertThatThrownBy(() -> s.execute("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '08:00', '23:00')"))
					.hasMessageContaining("permission denied for table club");
			assertThatThrownBy(() -> s.execute("update club set nombre = 'x'")).hasMessageContaining("permission denied");
			assertThatThrownBy(() -> s.execute("delete from usuario")).hasMessageContaining("permission denied");
			assertThatThrownBy(() -> s.execute("truncate club")).hasMessageContaining("permission denied");
			assertThatThrownBy(() -> s.execute("select * from flyway_schema_history")).hasMessageContaining("permission denied");
		}
	}

	@Test
	void unaTablaCreadaDespuesPorElDuenoLlegaConLosPrivilegiosPorDefecto() throws Exception {
		try (Connection c = como("vibora_owner"); Statement s = c.createStatement()) {
			s.execute("create table futura (id bigint generated always as identity primary key, dato text)");
		}
		try (Connection c = como("vibora_app"); Statement s = c.createStatement()) {
			s.execute("insert into futura (dato) values ('x')");
			assertThat(s.executeUpdate("update futura set dato = 'y'")).isEqualTo(1);
			assertThat(s.executeUpdate("delete from futura")).isEqualTo(1);
		}
		try (Connection c = como("vibora_ro"); Statement s = c.createStatement()) {
			assertThat(uno(s, "select count(*) from futura")).isEqualTo("0");
			assertThatThrownBy(() -> s.execute("insert into futura (dato) values ('x')")).hasMessageContaining("permission denied");
		}
	}

	/**
	 * Flujo de "base nueva": script ANTES de migrar (las tablas aun no existen, asi que no puede revocar nada sobre ellas),
	 * migraciones hechas por vibora_owner, y script OTRA VEZ. Hasta la segunda ejecucion las tablas nacen con los privilegios
	 * por defecto (DML completo para la aplicacion); la segunda aplica los revoques de factura y del historial de Flyway.
	 */
	@Test
	void baseNueva_scriptAntesDeMigrarYOtraVezDespues_dejaFacturaEHistorialProtegidos() throws Exception {
		String nueva = "roles_nueva_" + System.nanoTime();
		try (Connection c = superusuario(POSTGRES.getJdbcUrl()); Statement s = c.createStatement()) {
			s.execute("create database " + nueva);
		}
		String url = POSTGRES.getJdbcUrl().replace("/" + POSTGRES.getDatabaseName(), "/" + nueva);
		String script = leerScript();
		try (Connection c = DriverManager.getConnection(url, POSTGRES.getUsername(), POSTGRES.getPassword());
				Statement s = c.createStatement()) {
			s.execute(script);
			s.execute("alter role vibora_owner password '" + PASSWORD + "'");
			s.execute("alter role vibora_app password '" + PASSWORD + "'");
		}
		Flyway.configure().dataSource(url, "vibora_owner", PASSWORD).load().migrate();

		try (Connection c = DriverManager.getConnection(url, POSTGRES.getUsername(), POSTGRES.getPassword());
				Statement s = c.createStatement()) {
			// por que hace falta repetirlo: sin la segunda pasada la aplicacion podria reescribir facturas
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'UPDATE')")).isEqualTo("t");
			s.execute(script);
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'SELECT')")).isEqualTo("t");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'INSERT')")).isEqualTo("t");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'UPDATE')")).isEqualTo("f");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'factura', 'DELETE')")).isEqualTo("f");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'flyway_schema_history', 'SELECT')")).isEqualTo("f");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'flyway_schema_history', 'UPDATE')")).isEqualTo("f");
			assertThat(uno(s, "select has_table_privilege('vibora_app', 'flyway_schema_history', 'DELETE')")).isEqualTo("f");
		}
		try (Connection c = DriverManager.getConnection(url, "vibora_app", PASSWORD); Statement s = c.createStatement()) {
			assertThatThrownBy(() -> s.execute("update factura set club_id = club_id where false"))
					.hasMessageContaining("permission denied for table factura");
			assertThatThrownBy(() -> s.execute("delete from factura where false"))
					.hasMessageContaining("permission denied for table factura");
			assertThatThrownBy(() -> s.execute("update flyway_schema_history set success = true"))
					.hasMessageContaining("permission denied");
			assertThatThrownBy(() -> s.execute("delete from flyway_schema_history"))
					.hasMessageContaining("permission denied");
		}
	}

	private static String leerScript() throws Exception {
		Path script = Path.of("..", "ops", "db-roles.sql");
		if (!Files.exists(script)) {
			script = Path.of("ops", "db-roles.sql");
		}
		return Files.readString(script, StandardCharsets.UTF_8);
	}

	@Test
	void elScriptEsIdempotente() throws Exception {
		ejecutarScript();
		try (Connection c = como("vibora_app"); Statement s = c.createStatement()) {
			s.execute("insert into club (nombre, hora_apertura, hora_cierre) values ('C', '08:00', '23:00')");
			assertThatThrownBy(() -> s.execute("update factura set club_id = club_id where false"))
					.hasMessageContaining("permission denied");
		}
	}
}
