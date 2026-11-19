package com.vibora.personal;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Invitaciones del personal (vibora.personal.*): dias de validez, tope de invitaciones PENDIENTES por club, tope de
 * invitaciones creadas por club en las ultimas 24 h (ambos 429) y tamano del lote del barrido de caducadas.
 */
@ConfigurationProperties(prefix = "vibora.personal")
public record InvitacionProperties(
		@DefaultValue("14") int invitacionDias,
		@DefaultValue("50") int maxPendientesPorClub,
		@DefaultValue("30") int maxInvitacionesPorClub24h,
		@DefaultValue("1000") int lote) {
}
