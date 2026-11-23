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
 * V9 (sesiones de refresco): se migra hasta V8, se insertan usuarios y se aplica V9. Los usuarios previos quedan con
 * version_sesion = 0; la tabla nueva tiene sus restricciones e indices; el hash es unico y con forma de SHA-256 en
 * hexadecimal; borrar un usuario borra sus sesiones (ON DELETE CASCADE).
 */
class MigracionV9Tests extends PostgresTestBase {

	private String url;
	private String usuario;
	private String password;

	private void baseNuevaEnV8ConDatos() throws Exception {
		String base = "migracion_v9_" + System.nanoTime();
		usuario = POSTGRES.getUsername();
		password = POSTGRES.getPassword();
		try (Connection c = DriverManager.getConnection(POSTGRES.getJdbcUrl(), usuario, password); Statement s = c.createStatement()) {
			s.execute("create database " + base);
		}
		url = POSTGRES.getJdbcUrl().replace("/" + POSTGRES.getDatabaseName(), "/" + base);
		Flyway.configure().dataSource(url, usuario, password).target("8").load().migrate();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute("insert into usuario (email, password_hash, apellidos, rol) values ('j@x.com', 'h', 'J', 'JUGADOR')");
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

	private static String fila(String hash) {
		return "insert into sesion_refresco (usuario_id, familia, hash_token, creado_en, expira_en, familia_expira_en) "
				+ "select id, gen_random_uuid(), '" + hash + "', now(), now() + interval '14 days', now() + interval '30 days' "
				+ "from usuario where email = 'j@x.com'";
	}

	private static final String HASH_A = "a".repeat(64);
	private static final String HASH_B = "b".repeat(64);

	@Test
	void v9AnadeLaVersionDeSesionConValor0_yCreaLaTablaConSusIndices() throws Exception {
		baseNuevaEnV8ConDatos();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			assertThat(lista(s, "select max(version::int)::text from flyway_schema_history")).containsExactly("9");
			assertThat(lista(s, "select version_sesion::text from usuario where email = 'j@x.com'")).containsExactly("0");
			assertThat(lista(s, "select is_nullable || '/' || column_default from information_schema.columns "
					+ "where table_name = 'usuario' and column_name = 'version_sesion'")).containsExactly("NO/0");
			assertThat(lista(s, "select indexname from pg_indexes where tablename = 'sesion_refresco' "
					+ "and indexname <> 'sesion_refresco_pkey' order by indexname"))
					.containsExactly("sesion_refresco_familia_expira_en_idx", "sesion_refresco_familia_idx", "sesion_refresco_hash_uk",
							"sesion_refresco_revocado_en_idx", "sesion_refresco_usuario_idx");
			assertThat(lista(s, "select pg_get_expr(indpred, indrelid) from pg_index "
					+ "where indexrelid = 'sesion_refresco_revocado_en_idx'::regclass")).containsExactly("(revocado_en IS NOT NULL)");
			assertThat(lista(s, "select column_name from information_schema.columns where table_name = 'sesion_refresco' "
					+ "and is_nullable = 'YES' order by column_name")).containsExactly("revocado_en", "usado_en");
		}
	}

	@Test
	void elHashEsUnicoYConFormaDeSha256() throws Exception {
		baseNuevaEnV8ConDatos();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute(fila(HASH_A));
			assertThatThrownBy(() -> s.execute(fila(HASH_A))).hasMessageContaining("sesion_refresco_hash_uk");
			assertThatThrownBy(() -> s.execute(fila("no-es-un-hash"))).hasMessageContaining("sesion_refresco_hash_ck");
			assertThatThrownBy(() -> s.execute(fila("A".repeat(64)))).hasMessageContaining("sesion_refresco_hash_ck");
			s.execute(fila(HASH_B));
			assertThat(lista(s, "select count(*)::text from sesion_refresco")).containsExactly("2");
		}
	}

	@Test
	void borrarUnUsuarioBorraSusSesiones() throws Exception {
		baseNuevaEnV8ConDatos();
		try (Connection c = conexion(); Statement s = c.createStatement()) {
			s.execute(fila(HASH_A));
			s.execute("delete from usuario where email = 'j@x.com'");
			assertThat(lista(s, "select count(*)::text from sesion_refresco")).containsExactly("0");
		}
	}
}
