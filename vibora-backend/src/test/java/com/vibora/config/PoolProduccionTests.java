package com.vibora.config;

import com.vibora.PostgresTestBase;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pool, timeouts de sesion y apagado ordenado con los valores de PRODUCCION. Los tests normales los neutralizan
 * (src/test/resources/config/application.properties: hay tests de bloqueos que esperan decenas de segundos a proposito);
 * este los toma del application.properties REAL (el de src/main) y los inyecta, de modo que si alguien los cambia o
 * los borra, falla.
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
class PoolProduccionTests extends PostgresTestBase {

	private static final List<String> CLAVES = List.of(
			"spring.datasource.hikari.maximum-pool-size",
			"spring.datasource.hikari.connection-timeout",
			"spring.datasource.hikari.connection-init-sql");

	private static Properties principal() {
		Properties p = new Properties();
		try (InputStream in = new ClassPathResource("application.properties").getInputStream()) {
			p.load(new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8));
		} catch (IOException e) {
			throw new IllegalStateException(e);
		}
		return p;
	}

	@DynamicPropertySource
	static void valoresDeProduccion(DynamicPropertyRegistry registro) {
		Properties p = principal();
		for (String clave : CLAVES) {
			registro.add(clave, () -> p.getProperty(clave));
		}
	}

	@Autowired DataSource dataSource;
	@Autowired JdbcTemplate jdbc;

	@Test
	void elApplicationPropertiesDeProduccionDefineElPoolLosTimeoutsYElApagadoOrdenado() {
		Properties p = principal();
		assertThat(p.getProperty("spring.datasource.hikari.maximum-pool-size")).isEqualTo("20");
		assertThat(p.getProperty("spring.datasource.hikari.connection-timeout")).isEqualTo("5000");
		assertThat(p.getProperty("spring.datasource.hikari.connection-init-sql"))
				.contains("lock_timeout").contains("15s").contains("idle_in_transaction_session_timeout").contains("60s");
		assertThat(p.getProperty("server.shutdown")).isEqualTo("graceful");
		assertThat(p.getProperty("spring.lifecycle.timeout-per-shutdown-phase")).isEqualTo("20s");
	}

	@Test
	void elPoolRealTieneVeinteConexionesYUnTimeoutDeCincoSegundos() {
		HikariDataSource hikari = dataSource instanceof HikariDataSource h ? h : unwrap(dataSource);
		assertThat(hikari.getMaximumPoolSize()).isEqualTo(20);
		assertThat(hikari.getConnectionTimeout()).isEqualTo(5000);
	}

	@Test
	void cadaConexionDelPoolArrancaConLosTimeoutsDeSesion() {
		// varias conexiones distintas, no solo la primera: el init SQL se ejecuta al crear cada una
		for (int i = 0; i < 3; i++) {
			assertThat(jdbc.queryForObject("show lock_timeout", String.class)).isEqualTo("15s");
			assertThat(jdbc.queryForObject("show idle_in_transaction_session_timeout", String.class)).isEqualTo("1min");
		}
	}

	private static HikariDataSource unwrap(DataSource ds) {
		try {
			return ds.unwrap(HikariDataSource.class);
		} catch (java.sql.SQLException e) {
			throw new IllegalStateException(e);
		}
	}
}
