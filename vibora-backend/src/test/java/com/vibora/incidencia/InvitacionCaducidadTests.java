package com.vibora.incidencia;

import com.vibora.personal.InvitacionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Barrido de invitaciones vencidas, con el reloj mutable de test y lotes de 2 para ejercitar varios lotes. */
@TestPropertySource(properties = "vibora.personal.lote=2")
class InvitacionCaducidadTests extends IncidenciaApiTestBase {

	@Autowired InvitacionService servicio;

	private long contar(String estado) {
		em.flush();
		return jdbc.queryForObject("select count(*) from invitacion_personal where estado = ?", Long.class, estado);
	}

	private void invitarA(String... emails) throws Exception {
		for (String e : emails) {
			invitar(admin, club.getId(), e, "MONITOR").andExpect(status().isAccepted());
		}
	}

	@Test
	void barrido_marcaCaducadasPorLotes_conResueltaEnIgualASuCaducidad_yNoTocaNadaMas() throws Exception {
		invitarA("a@vibora.com", "b@vibora.com", "c@vibora.com", "d@vibora.com", "e@vibora.com");
		long rechazada = invitacionDe(club.getId(), "a@vibora.com");
		jdbc.update("update invitacion_personal set estado = 'RECHAZADA', resuelta_en = creada_en where id = ?", rechazada);
		reloj.fijar(reloj.instant().plus(Duration.ofDays(5)));
		invitarA("f@vibora.com"); // esta caducara 5 dias mas tarde que las otras
		reloj.fijar(RelojTestConfigHolder.inicio().plus(Duration.ofDays(14)));

		assertThat(servicio.caducarVencidas()).isEqualTo(4); // b, c, d, e: la rechazada y la f no
		assertThat(contar("CADUCADA")).isEqualTo(4);
		assertThat(contar("RECHAZADA")).isEqualTo(1);
		assertThat(contar("PENDIENTE")).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from invitacion_personal where estado = 'CADUCADA' "
				+ "and resuelta_en = caduca_en", Long.class)).isEqualTo(4);
		assertThat(servicio.caducarVencidas()).isZero(); // idempotente
	}

	@Test
	void barrido_unSegundoAntesDelLimiteNoCaduca_yEnElLimiteExactoSi() throws Exception {
		invitarA("a@vibora.com");
		Instant caduca = jdbc.queryForObject("select caduca_en from invitacion_personal", Instant.class);

		reloj.fijar(caduca.minusSeconds(1));
		assertThat(servicio.caducarVencidas()).isZero();
		assertThat(contar("PENDIENTE")).isEqualTo(1);

		reloj.fijar(caduca);
		servicio.barridoProgramado(); // la tarea programada hace lo mismo
		assertThat(contar("CADUCADA")).isEqualTo(1);
	}

	/** Instante con el que arranca cada test (2030-01-01T00:00Z). */
	static final class RelojTestConfigHolder {
		static Instant inicio() {
			return com.vibora.RelojTestConfig.AHORA_INICIAL;
		}
	}
}
