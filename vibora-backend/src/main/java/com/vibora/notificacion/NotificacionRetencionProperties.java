package com.vibora.notificacion;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Retencion de notificaciones (vibora.notificaciones.*): las leidas se conservan {@code retencionDias}, las no leidas
 * {@code retencionNoLeidasDias} (el usuario aun puede querer verlas), la purga se activa/desactiva con
 * {@code purgaActiva} y borra por lotes de {@code lote} filas para no mantener bloqueos largos.
 */
@ConfigurationProperties(prefix = "vibora.notificaciones")
public record NotificacionRetencionProperties(
		@DefaultValue("90") int retencionDias,
		@DefaultValue("365") int retencionNoLeidasDias,
		@DefaultValue("true") boolean purgaActiva,
		@DefaultValue("1000") int lote) {
}
