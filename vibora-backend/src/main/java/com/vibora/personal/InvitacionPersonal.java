package com.vibora.personal;

import com.vibora.club.Club;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * Invitacion de un club a un CORREO para ser monitor o personal de mantenimiento. Va dirigida al correo (ya
 * normalizado: trim + minusculas), no a un usuario: puede existir antes de que la persona se registre.
 */
@Entity
@Table(name = "invitacion_personal")
@Getter
@Setter
@NoArgsConstructor
public class InvitacionPersonal {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "club_id")
	private Club club;

	@Column(nullable = false, length = 255)
	private String email;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 20)
	private Rol rol;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 20)
	private EstadoInvitacion estado = EstadoInvitacion.PENDIENTE;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "invitado_por")
	private Usuario invitadoPor;

	@Column(name = "creada_en", nullable = false)
	private Instant creadaEn;

	@Column(name = "caduca_en", nullable = false)
	private Instant caducaEn;

	@Column(name = "resuelta_en")
	private Instant resueltaEn;

	/** Quien la acepto o rechazo. */
	@ManyToOne(fetch = FetchType.LAZY)
	@JoinColumn(name = "usuario_id")
	private Usuario usuario;

	/** Pendiente y todavia dentro de plazo (justo en caduca_en ya esta caducada). */
	public boolean vigente(Instant ahora) {
		return estado == EstadoInvitacion.PENDIENTE && caducaEn.isAfter(ahora);
	}

	/** Estado que ve el cliente: una PENDIENTE pasada de plazo se muestra CADUCADA aunque el barrido no haya corrido. */
	public EstadoInvitacion estadoVisible(Instant ahora) {
		return estado == EstadoInvitacion.PENDIENTE && !caducaEn.isAfter(ahora) ? EstadoInvitacion.CADUCADA : estado;
	}
}
