package com.vibora.auth;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * El par directo es 127.0.0.1, que Tomcat considera proxy interno (es lo que hace nginx desde la red de Docker): su
 * X-Forwarded-For SI se respeta y la clave del limitador es la IP real del cliente.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
		"vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!",
		"vibora.seguridad.login-max-por-email=5", "vibora.seguridad.login-max-por-ip=30" })
class RealIpProxyConfiableTests extends RealIpHttpBase {

	@Test
	void detrasDeUnProxyDeConfianzaLaIpDelClienteEsLaDeXForwardedFor() throws Exception {
		String email = "proxy-ok@vibora.com";
		for (int i = 0; i < 5; i++) {
			assertThat(loginFallido(email, "203.0.113.5")).isEqualTo(401);
		}
		assertThat(loginFallido(email, "203.0.113.5")).as("mismo cliente: bloqueado").isEqualTo(429);
		assertThat(loginFallido(email, "203.0.113.9")).as("otro cliente real: su contador es aparte").isEqualTo(401);
	}

	@Test
	void conVariosSaltosSeUsaElClienteMasCercanoQueNoEsProxy() throws Exception {
		String email = "proxy-saltos@vibora.com";
		// "falsa, real": el ultimo no es de confianza (IP publica) -> es el cliente; lo que ponga delante se ignora
		for (int i = 0; i < 5; i++) {
			assertThat(loginFallido(email, "198.51.100." + i + ", 203.0.113.77")).isEqualTo(401);
		}
		assertThat(loginFallido(email, "198.51.100.99, 203.0.113.77")).isEqualTo(429);
	}
}
