package com.vibora.personal;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Gestion del personal del club: solo su administrador. El alta ya no es un POST aqui: se entra por invitacion
 * aceptada (ver {@link InvitacionController}).
 */
@RestController
@RequestMapping("/api/clubes/{clubId}/personal")
@RequiredArgsConstructor
public class PersonalController {

	private final PersonalService personalService;

	@GetMapping
	public List<PersonalResponse> listar(@PathVariable Long clubId) {
		return personalService.listar(clubId);
	}

	@DeleteMapping("/{usuarioId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void quitar(@PathVariable Long clubId, @PathVariable Long usuarioId) {
		personalService.quitar(clubId, usuarioId);
	}
}
