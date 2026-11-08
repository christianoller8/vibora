package com.vibora.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;

/**
 * Limites anti-abuso del login y el registro (vibora.seguridad.*). Los intentos se cuentan al ADMITIRLOS (no al fallar):
 * asi el limite es exacto aunque lleguen muchos a la vez.
 * <ul>
 * <li>{@code loginMaxPorEmail}: intentos de login por (IP, email) dentro de {@code loginVentana}. Un login correcto lo reinicia.</li>
 * <li>{@code loginMaxPorIp}: intentos de login por IP en la misma ventana (un login correcto no cuenta).</li>
 * <li>{@code registroMaxPorIp}: registros por IP dentro de {@code registroVentana}.</li>
 * <li>{@code maxEntradas}: tope de claves en memoria por contador (al llenarse se descartan las caducadas y, si hace
 * falta, las mas antiguas).</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "vibora.seguridad")
public record SeguridadProperties(
		@DefaultValue("5") int loginMaxPorEmail,
		@DefaultValue("30") int loginMaxPorIp,
		@DefaultValue("15m") Duration loginVentana,
		@DefaultValue("10") int registroMaxPorIp,
		@DefaultValue("1h") Duration registroVentana,
		@DefaultValue("10000") int maxEntradas) {
}
