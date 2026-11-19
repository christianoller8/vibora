package com.vibora.personal;

import com.vibora.personal.InvitacionDtos.InvitacionAceptadaResponse;
import com.vibora.personal.InvitacionDtos.InvitacionMiaResponse;
import com.vibora.personal.InvitacionDtos.InvitacionRequest;
import com.vibora.personal.InvitacionDtos.InvitacionResponse;
import com.vibora.personal.InvitacionDtos.MensajeResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Invitaciones del personal: las del club (solo su administrador) y las propias (cualquier usuario autenticado). */
@RestController
@RequiredArgsConstructor
public class InvitacionController {

	private final InvitacionService invitaciones;
	private final PersonalService personal;

	@PostMapping("/api/clubes/{clubId}/invitaciones")
	@ResponseStatus(HttpStatus.ACCEPTED)
	public MensajeResponse invitar(@PathVariable Long clubId, @Valid @RequestBody InvitacionRequest peticion) {
		return invitaciones.invitar(clubId, peticion);
	}

	@GetMapping("/api/clubes/{clubId}/invitaciones")
	public List<InvitacionResponse> listar(@PathVariable Long clubId, @RequestParam(required = false) String estado) {
		return invitaciones.listar(clubId, estado);
	}

	@DeleteMapping("/api/clubes/{clubId}/invitaciones/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void cancelar(@PathVariable Long clubId, @PathVariable Long id) {
		invitaciones.cancelar(clubId, id);
	}

	@GetMapping("/api/invitaciones/mias")
	public List<InvitacionMiaResponse> mias() {
		return invitaciones.mias();
	}

	@PostMapping("/api/invitaciones/{id}/aceptar")
	public InvitacionAceptadaResponse aceptar(@PathVariable Long id) {
		return invitaciones.aceptar(id);
	}

	@PostMapping("/api/invitaciones/{id}/rechazar")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void rechazar(@PathVariable Long id) {
		invitaciones.rechazar(id);
	}

	@PostMapping("/api/personal/salir")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void salir() {
		personal.salir();
	}
}
