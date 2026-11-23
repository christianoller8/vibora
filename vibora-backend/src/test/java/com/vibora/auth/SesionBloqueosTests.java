package com.vibora.auth;

import com.nimbusds.jwt.SignedJWT;
import com.vibora.PostgresTestBase;
import com.vibora.TestData;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Bloqueo de la fila del usuario en TODOS los caminos de sesion (sin transaccion de test: commits reales). Dos formas de
 * comprobarlo:
 * <ul>
 * <li>Deterministas: una transaccion del test hace de "operacion en curso" (sostiene el bloqueo que tomaria
 * {@code refrescar} o {@code cerrarTodas} y no confirma) y la operacion probada debe quedarse esperando hasta que confirma.</li>
 * <li>Repetidas y concurrentes: las dos operaciones compiten de verdad y al final debe cumplirse el invariante. Son
 * probabilisticas (una carrera sin bloqueo puede salir bien por suerte), por eso se repiten.</li>
 * </ul>
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
class SesionBloqueosTests extends PostgresTestBase {

	private static final long ESPERA_MS = 700;

	@Autowired SesionService sesiones;
	@Autowired SesionRefrescoRepository filas;
	@Autowired UsuarioRepository usuarios;
	@Autowired JdbcTemplate jdbc;
	@Autowired PlatformTransactionManager tm;

	private Usuario crear() {
		return usuarios.saveAndFlush(TestData.usuario("bloqueos-" + UUID.randomUUID() + "@vibora.com", Rol.JUGADOR, null));
	}

	private void borrar(Usuario u) {
		usuarios.deleteById(u.getId()); // las filas de sesion_refresco caen en cascada
	}

	private static int versionDelToken(String jwt) throws Exception {
		return ((Number) SignedJWT.parse(jwt).getJWTClaimsSet().getClaim(JwtService.CLAIM_VERSION)).intValue();
	}

	@Test
	void cerrar_esperaAUnaRotacionEnCurso_yDespuesRevocaLaFamilia() throws Exception {
		Usuario u = crear();
		ExecutorService pool = Executors.newSingleThreadExecutor();
		try {
			SesionIniciada sesion = sesiones.iniciar(u);
			AtomicReference<Future<?>> cierre = new AtomicReference<>();
			new TransactionTemplate(tm).executeWithoutResult(estado -> {
				usuarios.findBloqueadoPorId(u.getId()); // lo primero que hace refrescar: el usuario FOR SHARE
				cierre.set(pool.submit(() -> sesiones.cerrar(sesion.refresco())));
				assertThatThrownBy(() -> cierre.get().get(ESPERA_MS, TimeUnit.MILLISECONDS))
						.as("cerrar debe esperar a la rotacion en curso").isInstanceOf(TimeoutException.class);
			});
			cierre.get().get(5, TimeUnit.SECONDS);
			assertThat(jdbc.queryForObject("select count(*) from sesion_refresco where usuario_id = ? and revocado_en is null",
					Long.class, u.getId())).isZero();
		} finally {
			pool.shutdownNow();
			borrar(u);
		}
	}

	@Test
	void refrescar_esperaAUnCerrarTodasEnCurso_yDespuesFallaPorqueLaFamiliaQuedoRevocada() throws Exception {
		Usuario u = crear();
		ExecutorService pool = Executors.newSingleThreadExecutor();
		try {
			SesionIniciada sesion = sesiones.iniciar(u);
			AtomicReference<Future<Optional<SesionIniciada>>> refresco = new AtomicReference<>();
			new TransactionTemplate(tm).executeWithoutResult(estado -> {
				// cerrarTodas a medias: bloqueo exclusivo del usuario y version subida, sin confirmar ni revocar aun los refrescos
				usuarios.bloquearParaActualizar(u.getId());
				usuarios.incrementarVersionSesion(u.getEmail());
				refresco.set(pool.submit(() -> sesiones.refrescar(sesion.refresco())));
				assertThatThrownBy(() -> refresco.get().get(ESPERA_MS, TimeUnit.MILLISECONDS))
						.as("refrescar debe esperar al cerrarTodas en curso (si no, rotaria una fila nueva que cerrarTodas no veria)")
						.isInstanceOf(TimeoutException.class);
				filas.revocarDeUsuario(u.getId(), Instant.now());
			});
			assertThat(refresco.get().get(5, TimeUnit.SECONDS)).as("al confirmar, la familia ya esta revocada").isEmpty();
			assertThat(jdbc.queryForObject("select count(*) from sesion_refresco where usuario_id = ? and revocado_en is null",
					Long.class, u.getId())).as("ninguna fila sin revocar").isZero();
			assertThat(jdbc.queryForObject("select count(*) from sesion_refresco where usuario_id = ?", Long.class, u.getId()))
					.as("refrescar no llego a emitir una fila nueva").isEqualTo(1);
		} finally {
			pool.shutdownNow();
			borrar(u);
		}
	}

	@Test
	void iniciar_esperaAUnCerrarTodasEnCurso_yEmiteLaVersionNueva() throws Exception {
		Usuario u = crear();
		Usuario cargadoAntes = usuarios.findByEmail(u.getEmail()).orElseThrow(); // lo que AuthService.login tiene antes de bcrypt
		ExecutorService pool = Executors.newSingleThreadExecutor();
		try {
			AtomicReference<Future<SesionIniciada>> login = new AtomicReference<>();
			new TransactionTemplate(tm).executeWithoutResult(estado -> {
				usuarios.incrementarVersionSesion(u.getEmail()); // cerrarTodas a medias: version 1 sin confirmar
				login.set(pool.submit(() -> sesiones.iniciar(cargadoAntes)));
				assertThatThrownBy(() -> login.get().get(ESPERA_MS, TimeUnit.MILLISECONDS))
						.as("el login debe esperar al cerrarTodas en curso").isInstanceOf(TimeoutException.class);
			});
			SesionIniciada iniciada = login.get().get(5, TimeUnit.SECONDS);
			assertThat(versionDelToken(iniciada.acceso().token())).as("claim ver leido bajo el bloqueo").isEqualTo(1);
		} finally {
			pool.shutdownNow();
			borrar(u);
		}
	}

	@RepeatedTest(10)
	void cerrarYRefrescarConcurrentes_dejanLaFamiliaSinFilasVivas() throws Exception {
		Usuario u = crear();
		int familias = 10;
		ExecutorService pool = Executors.newFixedThreadPool(2 * familias);
		try {
			List<String> tokens = new ArrayList<>();
			for (int i = 0; i < familias; i++) {
				tokens.add(sesiones.iniciar(u).refresco());
			}
			CountDownLatch salida = new CountDownLatch(1);
			List<Future<?>> futuros = new ArrayList<>();
			for (String token : tokens) {
				futuros.add(pool.submit(() -> {
					salida.await();
					sesiones.refrescar(token);
					return null;
				}));
				futuros.add(pool.submit(() -> {
					salida.await();
					sesiones.cerrar(token);
					return null;
				}));
			}
			salida.countDown();
			for (Future<?> f : futuros) {
				f.get(30, TimeUnit.SECONDS);
			}
			assertThat(jdbc.queryForObject("select count(*) from sesion_refresco where usuario_id = ? and revocado_en is null",
					Long.class, u.getId())).as("cerrar y refrescar a la vez: ninguna fila de la familia sigue viva").isZero();
		} finally {
			pool.shutdownNow();
			borrar(u);
		}
	}

	@RepeatedTest(10)
	void loginYCerrarTodasConcurrentes_cadaAccesoTieneLaVersionFinalOSuFamiliaEstaRevocada() throws Exception {
		Usuario u = crear();
		Usuario cargadoAntes = usuarios.findByEmail(u.getEmail()).orElseThrow(); // version 0, como la entidad previa a bcrypt
		int logins = 8;
		ExecutorService pool = Executors.newFixedThreadPool(logins + 1);
		try {
			CountDownLatch salida = new CountDownLatch(1);
			List<Future<SesionIniciada>> futuros = new ArrayList<>();
			for (int i = 0; i < logins; i++) {
				futuros.add(pool.submit(() -> {
					salida.await();
					return sesiones.iniciar(cargadoAntes);
				}));
			}
			Future<?> cierre = pool.submit(() -> {
				salida.await();
				sesiones.cerrarTodas(u.getEmail());
				return null;
			});
			salida.countDown();
			cierre.get(30, TimeUnit.SECONDS);
			int versionFinal = jdbc.queryForObject("select version_sesion from usuario where id = ?", Integer.class, u.getId());
			assertThat(versionFinal).isEqualTo(1);
			for (Future<SesionIniciada> f : futuros) {
				SesionIniciada s = f.get(30, TimeUnit.SECONDS);
				boolean revocada = Boolean.TRUE.equals(jdbc.queryForObject("""
						select revocado_en is not null from sesion_refresco
						where hash_token = encode(sha256(convert_to(?, 'UTF8')), 'hex')
						""", Boolean.class, s.refresco()));
				assertThat(versionDelToken(s.acceso().token()) == versionFinal || revocada)
						.as("un acceso vivo con version vieja y su refresco sin revocar sobreviviria al 'cerrar todas'").isTrue();
			}
		} finally {
			pool.shutdownNow();
			borrar(u);
		}
	}
}
