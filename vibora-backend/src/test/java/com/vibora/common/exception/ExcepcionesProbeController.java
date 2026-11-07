package com.vibora.common.exception;

import jakarta.persistence.LockTimeoutException;
import jakarta.persistence.PessimisticLockException;
import org.hibernate.exception.ConstraintViolationException;
import org.hibernate.exception.JDBCConnectionException;
import org.hibernate.exception.LockAcquisitionException;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.CannotSerializeTransactionException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DeadlockLoserDataAccessException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.sql.SQLException;
import java.sql.SQLTransientConnectionException;

/**
 * Controlador SOLO de test: lanza a peticion cada tipo de excepcion que el GlobalExceptionHandler tiene que traducir.
 * Todos los mensajes llevan textos que NUNCA deben llegar al cliente (SQL, nombres de restricciones, secretos).
 */
@RestController
class ExcepcionesProbeController {

	static final String SECRETO = "SELECT secreto FROM usuario WHERE constraint usuario_email_uk";

	@GetMapping("/api/test/excepciones/{caso}")
	String lanzar(@PathVariable String caso) throws Exception {
		switch (caso) {
			case "integridad" -> throw new DataIntegrityViolationException(
					"could not execute statement [ERROR: duplicate key value violates unique constraint \"usuario_email_uk\"] ["
							+ SECRETO + "]");
			case "restriccion-hibernate" -> throw new ConstraintViolationException(SECRETO, new SQLException("x"),
					"insert into usuario", "usuario_email_uk");
			case "interbloqueo" -> throw new DeadlockLoserDataAccessException(SECRETO, new SQLException("deadlock"));
			case "no-adquiere-bloqueo" -> throw new CannotAcquireLockException(SECRETO);
			case "bloqueo-pesimista" -> throw new PessimisticLockingFailureException(SECRETO);
			case "serializacion" -> throw new CannotSerializeTransactionException(SECRETO);
			case "bloqueo-jpa" -> throw new PessimisticLockException(SECRETO);
			case "tiempo-de-bloqueo-jpa" -> throw new LockTimeoutException(SECRETO);
			case "bloqueo-hibernate" -> throw new LockAcquisitionException(SECRETO, new SQLException("lock"));
			case "sin-transaccion" -> throw new CannotCreateTransactionException(SECRETO, new SQLException("down"));
			case "sin-recurso" -> throw new DataAccessResourceFailureException(SECRETO);
			case "sin-conexion-jdbc" -> throw new CannotGetJdbcConnectionException(SECRETO, new SQLException("down"));
			case "conexion-hibernate" -> throw new JDBCConnectionException(SECRETO, new SQLException("down"));
			case "pool-agotado" -> throw new SQLTransientConnectionException("HikariPool-1 - Connection is not available, " + SECRETO);
			case "inesperada" -> throw new IllegalStateException(SECRETO);
			case "nula" -> throw new NullPointerException(SECRETO);
			case "comprobada" -> throw new Exception(SECRETO);
			case "denegada" -> throw new AccessDeniedException(SECRETO);
			default -> {
				return "ok";
			}
		}
	}
}
