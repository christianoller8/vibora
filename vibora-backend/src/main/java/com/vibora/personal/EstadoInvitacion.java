package com.vibora.personal;

/** Estado de una invitacion del personal. Solo PENDIENTE esta viva; el resto son estados finales. */
public enum EstadoInvitacion {
	PENDIENTE, ACEPTADA, RECHAZADA, CANCELADA, CADUCADA
}
