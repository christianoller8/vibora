package com.vibora.personal;

import com.vibora.usuario.Rol;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

/** Contratos HTTP de las invitaciones del personal (se agrupan aqui por ser todos minusculos). */
public final class InvitacionDtos {

	private InvitacionDtos() {
	}

	/** Body de POST /api/clubes/{id}/invitaciones. Solo MONITOR y MANTENIMIENTO son validos (lo comprueba el servicio). */
	public record InvitacionRequest(@NotBlank @Email @Size(max = 255) String email, @NotNull Rol rol) {
	}

	/** Respuesta UNICA de invitar: no depende de si el correo esta registrado ni de en que club este. */
	public record MensajeResponse(String mensaje) {
	}

	/** Fila del listado del administrador. Nada dice si el correo esta registrado. */
	public record InvitacionResponse(Long id, String email, Rol rol, EstadoInvitacion estado, Instant creadaEn,
			Instant caducaEn, Instant resueltaEn) {

		static InvitacionResponse de(InvitacionPersonal i, Instant ahora) {
			return new InvitacionResponse(i.getId(), i.getEmail(), i.getRol(), i.estadoVisible(ahora), i.getCreadaEn(),
					i.getCaducaEn(), i.getResueltaEn());
		}
	}

	/** Invitacion que veo como invitado. */
	public record InvitacionMiaResponse(Long id, String clubNombre, Rol rol, String invitadoPor, Instant caducaEn) {

		static InvitacionMiaResponse de(InvitacionPersonal i) {
			return new InvitacionMiaResponse(i.getId(), i.getClub().getNombre(), i.getRol(),
					i.getInvitadoPor() == null ? null : i.getInvitadoPor().nombreCompleto(), i.getCaducaEn());
		}
	}

	/** El token que ya tiene sigue diciendo JUGADOR: la persona debe iniciar sesion de nuevo. */
	public record InvitacionAceptadaResponse(boolean requiereNuevoLogin, String clubNombre, Rol rol) {
	}
}
