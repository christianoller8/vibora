package com.vibora.usuario;

import com.vibora.PostgresTestBase;
import com.vibora.TestData;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Comprobacion (no suposicion) del analisis de orden de bloqueos: el bloqueo de BloqueoUsuario (PESSIMISTIC_WRITE) en
 * PostgreSQL es FOR NO KEY UPDATE, que NO choca con FOR KEY SHARE (el que toma una clave foranea al insertar una fila
 * hija que apunta a un usuario: reserva, notificacion, cargo...). Control positivo: un segundo FOR NO KEY UPDATE si espera.
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
class BloqueoUsuarioCompatibilidadTests extends PostgresTestBase {

	@Autowired UsuarioRepository usuarios;
	@Autowired BloqueoUsuario bloqueo;
	@Autowired PlatformTransactionManager transacciones;
	@Autowired DataSource dataSource;

	@Test
	void elBloqueoDelUsuarioNoImpideAInsertarHijosConFk_peroSiOtroBloqueoExclusivo() throws Exception {
		Usuario u = usuarios.saveAndFlush(TestData.usuario("bloqueo-fk@vibora.com", Rol.JUGADOR, null));
		try {
			new TransactionTemplate(transacciones).executeWithoutResult(estado -> {
				bloqueo.bloquear(usuarios.findById(u.getId()).orElseThrow());
				try (Connection otra = dataSource.getConnection(); Statement st = otra.createStatement()) {
					otra.setAutoCommit(false);
					st.execute("set local lock_timeout = '1500ms'");
					// lo que hace la comprobacion de una FK al insertar una fila hija: no espera
					st.execute("select 1 from usuario where id = " + u.getId() + " for key share");
					assertThatThrownBy(() -> st.execute("select 1 from usuario where id = " + u.getId() + " for no key update"))
							.isInstanceOfSatisfying(SQLException.class, ex -> assertThat(ex.getSQLState()).isEqualTo("55P03"));
				} catch (SQLException ex) {
					throw new IllegalStateException(ex);
				}
			});
		} finally {
			usuarios.deleteById(u.getId());
		}
	}
}
