package com.vibora.auth;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Los tests suben los limites de login/registro (src/test/resources/config/application.properties); este lee el
 * application.properties REAL de src/main y los valores por defecto del record, para que no se puedan aflojar sin que falle.
 */
class LimitesProduccionTests {

	private static Properties principal() throws Exception {
		Properties p = new Properties();
		try (InputStream in = new ClassPathResource("application.properties").getInputStream()) {
			p.load(new InputStreamReader(in, StandardCharsets.UTF_8));
		}
		return p;
	}

	@Test
	void elApplicationPropertiesDeProduccionDefineLosLimitesAcordados() throws Exception {
		Properties p = principal();
		assertThat(p.getProperty("vibora.seguridad.login-max-por-email")).isEqualTo("5");
		assertThat(p.getProperty("vibora.seguridad.login-max-por-ip")).isEqualTo("30");
		assertThat(p.getProperty("vibora.seguridad.login-ventana")).isEqualTo("15m");
		assertThat(p.getProperty("vibora.seguridad.registro-max-por-ip")).isEqualTo("10");
		assertThat(p.getProperty("vibora.seguridad.registro-ventana")).isEqualTo("1h");
		assertThat(p.getProperty("vibora.seguridad.refresco-max-por-ip")).isEqualTo("60");
		assertThat(p.getProperty("vibora.seguridad.refresco-ventana")).isEqualTo("15m");
		assertThat(p.getProperty("vibora.sesion.refresco-dias")).isEqualTo("14");
		assertThat(p.getProperty("vibora.sesion.maximo-dias")).isEqualTo("30");
		assertThat(p.getProperty("vibora.sesion.cookie-segura")).isEqualTo("${VIBORA_SESION_COOKIE_SEGURA:true}"); // por defecto true
		assertThat(p.getProperty("vibora.sesion.purga-cron")).isEqualTo("0 0 4 * * *");
		assertThat(p.getProperty("vibora.sesion.lote")).isEqualTo("1000");
		assertThat(p.getProperty("vibora.jwt.expiracion-minutos")).isEqualTo("15");
		assertThat(p.getProperty("server.forward-headers-strategy")).isEqualTo("native");
		// sin lista propia: valen los proxies internos por defecto de Tomcat (privadas/loopback), nunca "todo el mundo"
		assertThat(p.getProperty("server.tomcat.remoteip.internal-proxies")).isNull();
	}
}
