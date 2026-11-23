package com.vibora.auth;

import com.vibora.PostgresTestBase;
import com.vibora.RelojMutable;
import com.vibora.RelojTestConfig;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Purga diaria de sesiones de refresco: se borran las filas cuya FAMILIA caduco o que se REVOCARON hace mas de 1 dia
 * (estrictamente: justo en el limite se conservan); lo vigente, lo rotado de una familia viva (aunque su caducidad propia
 * ya pasara: reutilizarlo debe seguir revocando la familia) y lo recien caducado o revocado se queda. Por lotes (aqui de 3).
 * Reloj mutable (2030-01-01), commits reales y limpieza en @AfterEach.
 */
@SpringBootTest(properties = { "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!", "vibora.sesion.lote=3" })
@Import(RelojTestConfig.class)
class SesionRefrescoPurgaTests extends PostgresTestBase {

	@Autowired SesionRefrescoPurgaService purga;
	@Autowired SesionService sesiones;
	@Autowired UsuarioRepository usuarios;
	@Autowired SesionProperties propiedades;
	@Autowired RelojMutable reloj;
	@Autowired JdbcTemplate jdbc;

	private long usuarioId;
	private int secuencia;

	@BeforeEach
	void datos() {
		reloj.fijar(RelojTestConfig.AHORA_INICIAL);
		usuarioId = jdbc.queryForObject("insert into usuario (email, password_hash, apellidos, rol) "
				+ "values (?, 'h', 'P', 'JUGADOR') returning id", Long.class, "purga-sesion-" + UUID.randomUUID() + "@x.com");
	}

	@AfterEach
	void limpiar() {
		jdbc.update("delete from usuario where id = ?", usuarioId); // sesion_refresco cae en cascada; solo lo propio
	}

	private static String hash(int n) {
		return String.format("%064x", n);
	}

	/** Fila con la familia viva (tope a 60 dias): solo cambian la caducidad propia, la revocacion y el uso. */
	private String insertar(Duration expiraDentroDe, Duration revocadaHace, Duration usadaHace) {
		return insertar(expiraDentroDe, Duration.ofDays(60), revocadaHace, usadaHace);
	}

	/** Inserta una fila con la caducidad, el tope de la familia y la revocacion dados, relativos a "ahora" (null = no revocada). */
	private String insertar(Duration expiraDentroDe, Duration familiaExpiraDentroDe, Duration revocadaHace, Duration usadaHace) {
		Instant ahora = reloj.instant();
		String h = hash(++secuencia);
		jdbc.update("insert into sesion_refresco (usuario_id, familia, hash_token, creado_en, expira_en, familia_expira_en, usado_en, revocado_en) "
				+ "values (?, ?, ?, ?::timestamptz, ?::timestamptz, ?::timestamptz, ?::timestamptz, ?::timestamptz)",
				usuarioId, UUID.randomUUID(), h, ahora.minus(Duration.ofDays(20)).toString(), ahora.plus(expiraDentroDe).toString(),
				ahora.plus(familiaExpiraDentroDe).toString(), usadaHace == null ? null : ahora.minus(usadaHace).toString(),
				revocadaHace == null ? null : ahora.minus(revocadaHace).toString());
		return h;
	}

	private List<String> restantes() {
		return jdbc.queryForList("select hash_token from sesion_refresco where usuario_id = ? order by hash_token", String.class,
				usuarioId);
	}

	@Test
	void lasPropiedadesDeSesionTienenSusValoresPorDefecto_yLaPurgaCorreAlas4EnLaZonaDelClub() throws Exception {
		assertThat(propiedades.refrescoDias()).isEqualTo(14);
		assertThat(propiedades.maximoDias()).isEqualTo(30);
		assertThat(propiedades.cookieSegura()).isTrue();
		assertThat(propiedades.lote()).isEqualTo(3); // el de produccion (1000) se comprueba en LimitesProduccionTests
		Scheduled programada = SesionRefrescoPurgaService.class.getMethod("purgaProgramada").getAnnotation(Scheduled.class);
		assertThat(programada.cron()).isEqualTo("${vibora.sesion.purga-cron:0 0 4 * * *}");
		assertThat(programada.zone()).isEqualTo("${vibora.zona-horaria}");
	}

	@Test
	void borraSoloLoQueTieneLaFamiliaCaducadaORevocadoHaceMasDeUnDia() {
		String vigente = insertar(Duration.ofDays(5), null, null);
		String rotadaVigente = insertar(Duration.ofDays(5), null, Duration.ofDays(2)); // usada pero la familia sigue
		String familiaCaducadaHaceHoras = insertar(Duration.ofHours(-5), Duration.ofHours(-5), null, null);
		String familiaCaducadaJustoEnElLimite = insertar(Duration.ofDays(-1), Duration.ofDays(-1), null, null);
		String familiaCaducadaHaceDias = insertar(Duration.ofDays(-3), Duration.ofDays(-3), null, null);
		String revocadaHaceHoras = insertar(Duration.ofDays(5), Duration.ofHours(5), null);
		String revocadaJustoEnElLimite = insertar(Duration.ofDays(5), Duration.ofDays(1), null);
		String revocadaHaceDias = insertar(Duration.ofDays(5), Duration.ofDays(3), null);

		int borradas = purga.purgar();

		assertThat(borradas).isEqualTo(2);
		assertThat(restantes()).containsExactlyInAnyOrder(vigente, rotadaVigente, familiaCaducadaHaceHoras,
				familiaCaducadaJustoEnElLimite, revocadaHaceHoras, revocadaJustoEnElLimite);
		assertThat(restantes()).doesNotContain(familiaCaducadaHaceDias, revocadaHaceDias);
	}

	@Test
	void unaFilaRotadaCuyaCaducidadPropiaPasoPeroSuFamiliaSigueViva_noSeBorra_yReutilizarlaRevocaLaFamilia() {
		Usuario u = usuarios.findById(usuarioId).orElseThrow();
		SesionIniciada primera = sesiones.iniciar(u);
		String robado = primera.refresco(); // la copia que alguien se llevo
		SesionIniciada segunda = sesiones.refrescar(robado).orElseThrow(); // el dueño rota: la fila "robado" queda usada

		reloj.fijar(RelojTestConfig.AHORA_INICIAL.plus(Duration.ofDays(16))); // pasa expira_en (14 dias) y el margen; el tope es a los 30
		assertThat(purga.purgar()).as("la familia aun puede refrescarse: no se purga nada").isZero();
		assertThat(jdbc.queryForObject("select count(*) from sesion_refresco where usuario_id = ?", Long.class, usuarioId)).isEqualTo(2);

		assertThat(sesiones.refrescar(robado)).as("reutilizar el token robado sigue siendo reutilizacion, no 'desconocido'").isEmpty();

		assertThat(jdbc.queryForObject("select count(*) from sesion_refresco where usuario_id = ? and revocado_en is null",
				Long.class, usuarioId)).as("la familia entera quedo revocada").isZero();
		assertThat(sesiones.refrescar(segunda.refresco())).isEmpty();
	}

	@Test
	void borraPorLotesHastaVaciarLoVencido_yDevuelveElTotal() {
		for (int i = 0; i < 7; i++) { // 7 vencidas con lote de 3: tres lotes (3 + 3 + 1)
			insertar(Duration.ofDays(-10), Duration.ofDays(-10), null, null);
		}
		String vigente = insertar(Duration.ofDays(5), null, null);

		assertThat(purga.purgar()).isEqualTo(7);

		assertThat(restantes()).containsExactly(vigente);
		assertThat(purga.purgar()).as("segunda pasada: nada que borrar").isZero();
	}
}
