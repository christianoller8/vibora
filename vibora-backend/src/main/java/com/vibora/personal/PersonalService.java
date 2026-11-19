package com.vibora.personal;

import com.vibora.auth.AutorizacionClub;
import com.vibora.club.Club;
import com.vibora.club.ClubRepository;
import com.vibora.common.exception.ConflictoException;
import com.vibora.common.exception.RecursoNoEncontradoException;
import com.vibora.incidencia.IncidenciaService;
import com.vibora.notificacion.NotificacionService;
import com.vibora.notificacion.TipoNotificacion;
import com.vibora.usuario.BloqueoUsuario;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Baja del personal de un club, por su administrador o voluntaria ({@link #salir()}). El alta es por invitacion
 * aceptada ({@link InvitacionService}). Orden de comprobaciones: club (404) -> administrador del club (403) -> persona
 * (404) -> estado de la persona (409).
 * <p>
 * La baja bloquea la fila de la persona (SELECT ... FOR UPDATE) antes de decidir: una asignacion de incidencia
 * mientras se la retira se serializa y la segunda ve el resultado de la primera. Ambas bajas comparten
 * {@link #retirar}, asi que se comportan igual.
 * <p>
 * OJO con el token: el rol viaja en el JWT. La persona retirada conserva su token anterior (MONITOR/MANTENIMIENTO)
 * hasta que expire o vuelva a iniciar sesion. Eso no deja abierto nada: los permisos de club se leen SIEMPRE de la
 * BD, nunca del token.
 */
@Service
@RequiredArgsConstructor
public class PersonalService {

	private final UsuarioRepository usuarios;
	private final ClubRepository clubs;
	private final AutorizacionClub autorizacion;
	private final NotificacionService notificaciones;
	private final IncidenciaService incidencias;
	private final BloqueoUsuario bloqueo;

	/** Administradores del club (marcados como ADMIN_CLUB) y su personal, administradores primero. */
	@Transactional(readOnly = true)
	public List<PersonalResponse> listar(Long clubId) {
		buscarClub(clubId);
		autorizacion.exigirAdminDe(clubId);
		return usuarios.findPersonalDelClub(clubId, List.of(Rol.ADMIN_CLUB, Rol.MONITOR, Rol.MANTENIMIENTO)).stream()
				.map(PersonalResponse::de).toList();
	}

	/** 404 si no es personal de ESTE club; 409 si es administrador (los administradores no se quitan por aqui). */
	@Transactional
	public void quitar(Long clubId, Long usuarioId) {
		Club club = buscarClub(clubId);
		Usuario admin = autorizacion.exigirAdminDe(clubId);
		Usuario persona = usuarios.findById(usuarioId)
				.orElseThrow(() -> new RecursoNoEncontradoException("Personal no encontrado"));
		bloqueo.bloquear(persona);
		if (persona.getClub() == null || !persona.getClub().getId().equals(clubId) || persona.getRol() == Rol.JUGADOR) {
			throw new RecursoNoEncontradoException("Personal no encontrado");
		}
		if (persona.getRol() == Rol.ADMIN_CLUB) {
			throw new ConflictoException("No se puede quitar a un administrador del club");
		}
		retirar(persona, admin, clubId);
		notificaciones.notificar(persona, TipoNotificacion.PERSONAL_QUITADO,
				"Has dejado de formar parte del personal de %s".formatted(club.getNombre()), null);
	}

	/**
	 * El personal (monitor o mantenimiento) abandona su club. Mismo efecto que la retirada del administrador; avisa a los
	 * administradores. 409 para el administrador y para quien no es personal. Se decide con la fila ya bloqueada y releida:
	 * un token viejo no cuenta.
	 */
	@Transactional
	public void salir() {
		Usuario yo = autorizacion.usuarioActual();
		bloqueo.bloquear(yo);
		if (yo.getRol() == Rol.ADMIN_CLUB) {
			throw new ConflictoException("El administrador no puede abandonar el club");
		}
		if (yo.getRol() == Rol.JUGADOR || yo.getClub() == null) {
			throw new ConflictoException("No perteneces al personal de ningún club");
		}
		Club club = yo.getClub();
		retirar(yo, yo, club.getId());
		String aviso = "%s ha dejado el personal de %s".formatted(yo.nombreCompleto(), club.getNombre());
		for (Usuario admin : usuarios.findByClubIdAndRol(club.getId(), Rol.ADMIN_CLUB)) {
			notificaciones.notificar(admin, TipoNotificacion.PERSONAL_QUITADO, aviso, null);
		}
	}

	/** Deja a la persona como JUGADOR sin club (con su fila ya bloqueada). {@code actor} firma lo que pase en las incidencias. */
	private void retirar(Usuario persona, Usuario actor, Long clubId) {
		// antes de cambiar el rol: la BD exige responsable en las incidencias asignadas o en curso
		incidencias.desasignarActivasDe(persona, actor, clubId);
		persona.setRol(Rol.JUGADOR);
		persona.setClub(null);
		usuarios.saveAndFlush(persona);
	}

	private Club buscarClub(Long clubId) {
		return clubs.findById(clubId).orElseThrow(() -> new RecursoNoEncontradoException("Club no encontrado"));
	}
}
