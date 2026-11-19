package com.vibora.personal;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface InvitacionPersonalRepository extends JpaRepository<InvitacionPersonal, Long> {

	/** La invitacion con SELECT ... FOR UPDATE (aceptar, rechazar y cancelar se serializan sobre su fila). */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select i from InvitacionPersonal i where i.id = :id")
	Optional<InvitacionPersonal> bloquearPorId(@Param("id") Long id);

	/** La invitacion PENDIENTE (vigente o no) de ese correo en ese club, bloqueada. Como mucho una (indice unico parcial). */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select i from InvitacionPersonal i where i.club.id = :clubId and i.email = :email "
			+ "and i.estado = com.vibora.personal.EstadoInvitacion.PENDIENTE")
	Optional<InvitacionPersonal> pendienteBloqueada(@Param("clubId") Long clubId, @Param("email") String email);

	@Query("select count(i) from InvitacionPersonal i where i.club.id = :clubId "
			+ "and i.estado = com.vibora.personal.EstadoInvitacion.PENDIENTE and i.caducaEn > :ahora")
	long contarVigentes(@Param("clubId") Long clubId, @Param("ahora") Instant ahora);

	/** Creadas despues de {@code desde} (estrictamente: lo creado justo en el limite ya no cuenta). */
	@Query("select count(i) from InvitacionPersonal i where i.club.id = :clubId and i.creadaEn > :desde")
	long contarCreadasDesde(@Param("clubId") Long clubId, @Param("desde") Instant desde);

	@Query("select count(i) from InvitacionPersonal i where i.email = :email "
			+ "and i.estado = com.vibora.personal.EstadoInvitacion.PENDIENTE and i.caducaEn > :ahora")
	long contarVigentesDe(@Param("email") String email, @Param("ahora") Instant ahora);

	@Query("select i from InvitacionPersonal i join fetch i.invitadoPor where i.club.id = :clubId "
			+ "order by i.creadaEn desc, i.id desc")
	List<InvitacionPersonal> listarDelClub(@Param("clubId") Long clubId, Pageable pagina);

	@Query("select i from InvitacionPersonal i join fetch i.invitadoPor where i.club.id = :clubId and i.estado = :estado "
			+ "order by i.creadaEn desc, i.id desc")
	List<InvitacionPersonal> listarDelClubPorEstado(@Param("clubId") Long clubId,
			@Param("estado") EstadoInvitacion estado, Pageable pagina);

	/** Pendientes y dentro de plazo. */
	@Query("select i from InvitacionPersonal i join fetch i.invitadoPor where i.club.id = :clubId "
			+ "and i.estado = com.vibora.personal.EstadoInvitacion.PENDIENTE and i.caducaEn > :ahora "
			+ "order by i.creadaEn desc, i.id desc")
	List<InvitacionPersonal> listarVigentesDelClub(@Param("clubId") Long clubId, @Param("ahora") Instant ahora,
			Pageable pagina);

	/** CADUCADAS: las marcadas y las PENDIENTES ya pasadas de plazo. */
	@Query("select i from InvitacionPersonal i join fetch i.invitadoPor where i.club.id = :clubId "
			+ "and (i.estado = com.vibora.personal.EstadoInvitacion.CADUCADA "
			+ "or (i.estado = com.vibora.personal.EstadoInvitacion.PENDIENTE and i.caducaEn <= :ahora)) "
			+ "order by i.creadaEn desc, i.id desc")
	List<InvitacionPersonal> listarCaducadasDelClub(@Param("clubId") Long clubId, @Param("ahora") Instant ahora,
			Pageable pagina);

	@Query("select i from InvitacionPersonal i join fetch i.club left join fetch i.invitadoPor where i.email = :email "
			+ "and i.estado = com.vibora.personal.EstadoInvitacion.PENDIENTE and i.caducaEn > :ahora "
			+ "order by i.creadaEn desc, i.id desc")
	List<InvitacionPersonal> listarVigentesDe(@Param("email") String email, @Param("ahora") Instant ahora);

	/**
	 * Marca CADUCADA hasta {@code lote} pendientes vencidas (resuelta_en = su propio caduca_en: cuando caducaron, no cuando
	 * corrio el barrido). FOR UPDATE SKIP LOCKED: no espera a quien este aceptando o cancelando una de ellas. Cada llamada
	 * es su propia transaccion corta.
	 */
	@Transactional
	@Modifying
	@Query(value = "update invitacion_personal set estado = 'CADUCADA', resuelta_en = caduca_en where id in ("
			+ "select id from invitacion_personal where estado = 'PENDIENTE' and caduca_en <= :ahora "
			+ "order by id limit :lote for update skip locked)", nativeQuery = true)
	int caducarLote(@Param("ahora") Instant ahora, @Param("lote") int lote);
}
