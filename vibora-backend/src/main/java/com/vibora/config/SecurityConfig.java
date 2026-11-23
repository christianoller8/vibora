package com.vibora.config;

import com.vibora.auth.JwtProperties;
import com.vibora.auth.JwtService;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.List;

@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties({ JwtProperties.class, com.vibora.auth.SeguridadProperties.class })
public class SecurityConfig {

	@Bean
	SecurityFilterChain filterChain(HttpSecurity http, JwtAuthenticationConverter convertidor) throws Exception {
		http
				.csrf(AbstractHttpConfigurer::disable) // el acceso va en Authorization (sin cookie: sin CSRF); la cookie de refresco es solo de /api/auth y SameSite=Strict (ver AuthController)
				.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(a -> a
						.requestMatchers(HttpMethod.POST, "/api/auth/registro", "/api/auth/login").permitAll()
						// se identifican por la cookie de refresco, no por el acceso (que puede haber caducado ya)
						.requestMatchers(HttpMethod.POST, "/api/auth/refrescar", "/api/auth/cerrar-sesion").permitAll()
						.requestMatchers("/error").permitAll()
						// solo el estado (UP/DOWN) para el HEALTHCHECK; el resto de actuator ni esta expuesto
						.requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/health/**").permitAll()
						// OpenAPI y Swagger UI: publicos para poder abrirlos; con VIBORA_API_DOCS=false springdoc no registra
						// las rutas y responden 404
						.requestMatchers(HttpMethod.GET, "/v3/api-docs", "/v3/api-docs/**", "/swagger-ui.html",
								"/swagger-ui/**").permitAll()
						// el navegador no puede poner Authorization en el handshake: el JWT se valida en el frame CONNECT
						.requestMatchers("/ws", "/ws/**").permitAll()
						.anyRequest().authenticated())
				.exceptionHandling(e -> e
						.authenticationEntryPoint(entryPoint())
						.accessDeniedHandler(accessDeniedHandler()))
				.oauth2ResourceServer(o -> o
						.jwt(j -> j.jwtAuthenticationConverter(convertidor))
						.bearerTokenResolver(resolutorDeBearer())
						.authenticationEntryPoint(entryPoint())
						.accessDeniedHandler(accessDeniedHandler()));
		return http.build();
	}

	@Bean
	PasswordEncoder passwordEncoder() {
		return new BCryptPasswordEncoder();
	}

	@Bean
	Clock clock() {
		return Clock.systemUTC();
	}

	@Bean
	JwtDecoder jwtDecoder(JwtService jwtService) {
		return jwtService.decoder();
	}

	/** Claim "rol" -> authority ROLE_<ROL>, para hasRole(...) y @PreAuthorize. */
	@Bean
	JwtAuthenticationConverter jwtAuthenticationConverter() {
		JwtAuthenticationConverter convertidor = new JwtAuthenticationConverter();
		convertidor.setJwtGrantedAuthoritiesConverter(jwt -> {
			String rol = jwt.getClaimAsString(JwtService.CLAIM_ROL);
			return rol == null ? List.of() : List.of(new SimpleGrantedAuthority("ROLE_" + rol));
		});
		return convertidor;
	}

	/**
	 * Refrescar y cerrar una sesion funcionan solo con la cookie: si el cliente aun manda un acceso caducado en la cabecera,
	 * no se le hace caso (si no, el filtro de Bearer lo rechazaria con 401 antes de llegar al controlador).
	 */
	private BearerTokenResolver resolutorDeBearer() {
		DefaultBearerTokenResolver delegado = new DefaultBearerTokenResolver();
		RequestMatcher soloCookie = new OrRequestMatcher(
				PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST, "/api/auth/refrescar"),
				PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST, "/api/auth/cerrar-sesion"));
		return request -> soloCookie.matches(request) ? null : delegado.resolve(request);
	}

	private AuthenticationEntryPoint entryPoint() {
		return (request, response, ex) -> escribirError(response, HttpStatus.UNAUTHORIZED, "No autenticado");
	}

	private AccessDeniedHandler accessDeniedHandler() {
		return (request, response, ex) -> escribirError(response, HttpStatus.FORBIDDEN, "Acceso denegado");
	}

	private static void escribirError(jakarta.servlet.http.HttpServletResponse response, HttpStatus estado, String mensaje)
			throws java.io.IOException {
		response.setStatus(estado.value());
		response.setContentType(MediaType.APPLICATION_JSON_VALUE);
		response.setCharacterEncoding(StandardCharsets.UTF_8.name());
		response.getWriter().write("{\"error\":\"" + mensaje + "\"}");
	}
}
