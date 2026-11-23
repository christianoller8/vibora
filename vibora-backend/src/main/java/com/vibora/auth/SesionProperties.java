package com.vibora.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Sesiones de refresco (vibora.sesion.*).
 * <ul>
 * <li>{@code refrescoDias}: vida DESLIZANTE de cada token de refresco (cada rotacion da otros tantos dias).</li>
 * <li>{@code maximoDias}: tope ABSOLUTO desde el login: pasado, hay que volver a iniciar sesion aunque se use cada dia.</li>
 * <li>{@code cookieSegura}: atributo Secure de la cookie. Solo se pone a false en desarrollo sin HTTPS.</li>
 * <li>{@code lote}: filas por lote de la purga diaria (ver {@link SesionRefrescoPurgaService}).</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "vibora.sesion")
public record SesionProperties(
		@DefaultValue("14") int refrescoDias,
		@DefaultValue("30") int maximoDias,
		@DefaultValue("true") boolean cookieSegura,
		@DefaultValue("1000") int lote) {
}
