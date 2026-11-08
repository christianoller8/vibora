package com.vibora.reserva;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Configuracion de reservas: vibora.reservas.duracion-minutos, cancelacion-minima-horas, horizonte-dias (antelacion
 * maxima, dia natural de la zona del club) y max-activas-por-usuario (reservas confirmadas que aun no han empezado).
 */
@ConfigurationProperties(prefix = "vibora.reservas")
public record ReservaProperties(int duracionMinutos, long cancelacionMinimaHoras,
		@DefaultValue("60") int horizonteDias, @DefaultValue("10") int maxActivasPorUsuario) {
}
