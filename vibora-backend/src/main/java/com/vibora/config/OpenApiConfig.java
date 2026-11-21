package com.vibora.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Metadatos de la especificacion OpenAPI: JWT en la cabecera Authorization como requisito global. */
@Configuration
public class OpenApiConfig {

	static final String ESQUEMA_BEARER = "bearerAuth";

	@Bean
	OpenAPI openApi() {
		return new OpenAPI()
				.info(new Info()
						.title("Víbora API")
						.description("API REST de Víbora: reserva, juega, divide. Gestión de clubes de pádel.")
						.version("v1")) // version del contrato de la API, no la del build (la del pom)
				.components(new Components().addSecuritySchemes(ESQUEMA_BEARER, new SecurityScheme()
						.type(SecurityScheme.Type.HTTP)
						.scheme("bearer")
						.bearerFormat("JWT")))
				.addSecurityItem(new SecurityRequirement().addList(ESQUEMA_BEARER));
	}
}
