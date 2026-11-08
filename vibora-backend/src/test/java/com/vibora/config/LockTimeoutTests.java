package com.vibora.config;

import com.vibora.PostgresTestBase;
import com.vibora.club.Club;
import com.vibora.club.ClubRepository;
import com.vibora.TestData;
import com.vibora.common.exception.GlobalExceptionHandler;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.LockTimeoutException;
import jakarta.persistence.PessimisticLockException;
import org.hibernate.exception.LockAcquisitionException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.SQLException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * Con lock_timeout (en produccion 15 s; aqui 1 s por propiedad) una sentencia que espera un bloqueo de fila falla con el
 * SQLSTATE 55P03 en vez de colgarse, y el GlobalExceptionHandler lo devuelve como el 409 de concurrencia.
 */
@SpringBootTest(properties = {
		"vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!",
		"spring.datasource.hikari.connection-init-sql=set lock_timeout='1s'; set idle_in_transaction_session_timeout='60s'" })
class LockTimeoutTests extends PostgresTestBase {

	@Autowired JdbcTemplate jdbc;
	@Autowired ClubRepository clubs;
	@Autowired EntityManager em;
	@Autowired PlatformTransactionManager tm;
	@Autowired GlobalExceptionHandler handler;

	private Club club;

	@BeforeEach
	void crear() {
		club = clubs.saveAndFlush(TestData.club());
	}

	@AfterEach
	void limpiar() {
		clubs.deleteAllInBatch();
	}

	/** Mantiene bloqueada la fila del club mientras se ejecuta {@code mientras}. */
	private Throwable conFilaBloqueada(Runnable mientras) throws Exception {
		CountDownLatch bloqueada = new CountDownLatch(1);
		CountDownLatch soltar = new CountDownLatch(1);
		ExecutorService pool = Executors.newSingleThreadExecutor();
		Future<?> titular = pool.submit(() -> new TransactionTemplate(tm).executeWithoutResult(s -> {
			jdbc.queryForList("select id from club where id = ? for update", club.getId());
			bloqueada.countDown();
			try {
				soltar.await(30, TimeUnit.SECONDS);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
		}));
		try {
			assertThat(bloqueada.await(10, TimeUnit.SECONDS)).isTrue();
			return catchThrowable(mientras::run);
		} finally {
			soltar.countDown();
			titular.get(10, TimeUnit.SECONDS);
			pool.shutdownNow();
		}
	}

	private static boolean tieneSqlState(Throwable t, String estado) {
		for (; t != null; t = t.getCause()) {
			if (t instanceof SQLException e && estado.equals(e.getSQLState())) {
				return true;
			}
		}
		return false;
	}

	@Test
	void unaSentenciaBloqueadaFallaTrasElLockTimeoutConSqlState55P03_yElHandlerLaDevuelveComoConflicto() throws Exception {
		long inicio = System.nanoTime();
		Throwable fallo = conFilaBloqueada(() -> jdbc.update("update club set nombre = 'otro' where id = ?", club.getId()));
		long milis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - inicio);

		// Spring NO clasifica el 55P03 de un JdbcTemplate como fallo de concurrencia: llega como UncategorizedSQLException
		assertThat(fallo).isInstanceOf(UncategorizedSQLException.class);
		assertThat(tieneSqlState(fallo, "55P03")).as("SQLSTATE 55P03 (lock_not_available) en la causa").isTrue();
		assertThat(milis).as("espero ~1 s (lock_timeout), no indefinidamente").isBetween(800L, 15_000L);
		var respuesta = handler.sqlNoClasificado((UncategorizedSQLException) fallo);
		assertThat(respuesta.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(respuesta.getBody()).containsKey("error");
		assertThat(respuesta.getBody().get("error")).contains("concurrencia");
	}

	@Test
	void tambienPorLaViaDeJpa_conBloqueoPesimista() throws Exception {
		Throwable fallo = conFilaBloqueada(() -> new TransactionTemplate(tm).executeWithoutResult(
				s -> em.find(Club.class, club.getId(), LockModeType.PESSIMISTIC_WRITE)));

		assertThat(fallo).isInstanceOfAny(ConcurrencyFailureException.class, PessimisticLockException.class,
				LockTimeoutException.class, LockAcquisitionException.class);
		assertThat(tieneSqlState(fallo, "55P03")).isTrue();
		assertThat(handler.concurrencia((Exception) fallo).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
	}
}
