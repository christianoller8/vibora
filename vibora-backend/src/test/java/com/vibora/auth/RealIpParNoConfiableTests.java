package com.vibora.auth;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Ahora el par directo (127.0.0.1) NO es un proxy de confianza (solo lo es 10.99.99.99): un X-Forwarded-For puesto por el
 * cliente se IGNORA y rotarlo no permite esquivar el limite.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
		"vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!",
		"vibora.seguridad.login-max-por-email=5", "vibora.seguridad.login-max-por-ip=30",
		"server.tomcat.remoteip.internal-proxies=10\\.99\\.99\\.99" })
class RealIpParNoConfiableTests extends RealIpHttpBase {

	@Test
	void rotarXForwardedForNoEsquivaElLimite() throws Exception {
		String email = "spoof@vibora.com";
		for (int i = 0; i < 5; i++) {
			assertThat(loginFallido(email, "203.0.113." + i)).isEqualTo(401);
		}
		assertThat(loginFallido(email, "203.0.113.200")).as("cabecera distinta, mismo par real").isEqualTo(429);
		assertThat(loginFallido(email, null)).as("sin cabecera, tambien bloqueado").isEqualTo(429);
	}
}
