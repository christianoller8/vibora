package com.vibora.auth;

import com.vibora.PostgresTestBase;
import org.springframework.beans.factory.annotation.Value;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/** Base de los tests por la red real (Tomcat + RemoteIpValve): la IP del cliente solo puede venir de un proxy de confianza. */
abstract class RealIpHttpBase extends PostgresTestBase {

	@Value("${local.server.port}") int puerto;

	private final HttpClient http = HttpClient.newHttpClient();

	/** Login fallido (el email no existe: da igual, el limitador no mira cuentas) con la cabecera X-Forwarded-For indicada. */
	int loginFallido(String email, String xForwardedFor) throws Exception {
		HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + puerto + "/api/auth/login"))
				.header("Content-Type", "application/json")
				.POST(HttpRequest.BodyPublishers.ofString("{\"email\":\"%s\",\"password\":\"mala\"}".formatted(email)));
		if (xForwardedFor != null) {
			b.header("X-Forwarded-For", xForwardedFor);
		}
		HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
		return r.statusCode();
	}
}
