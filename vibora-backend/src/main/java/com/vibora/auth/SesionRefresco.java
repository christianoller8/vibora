package com.vibora.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/** Un token de refresco (solo su SHA-256). Ver V9__sesiones_refresco.sql. */
@Entity
@Table(name = "sesion_refresco")
@Getter
@Setter
@NoArgsConstructor
public class SesionRefresco {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(name = "usuario_id", nullable = false, updatable = false)
	private Long usuarioId;

	@Column(nullable = false, updatable = false)
	private UUID familia;

	@Column(name = "hash_token", nullable = false, updatable = false, length = 64)
	private String hashToken;

	@Column(name = "creado_en", nullable = false, updatable = false)
	private Instant creadoEn;

	@Column(name = "expira_en", nullable = false, updatable = false)
	private Instant expiraEn;

	@Column(name = "familia_expira_en", nullable = false, updatable = false)
	private Instant familiaExpiraEn;

	@Column(name = "usado_en")
	private Instant usadoEn;

	@Column(name = "revocado_en")
	private Instant revocadoEn;
}
