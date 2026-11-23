package com.vibora.auth;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/** El toString de la sesion recien abierta no puede filtrar los tokens a un log o a un mensaje de excepcion. */
class SesionIniciadaTests {

	@Test
	void toStringNoMuestraNingunToken() {
		SesionIniciada sesion = new SesionIniciada(new TokenResponse("acceso-secreto-123", "Bearer", Instant.now()),
				"refresco-secreto-456", Duration.ofDays(14));

		assertThat(sesion.toString()).doesNotContain("acceso-secreto-123").doesNotContain("refresco-secreto-456");
	}
}
