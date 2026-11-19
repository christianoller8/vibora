package com.vibora.notificacion;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface NotificacionRepository extends JpaRepository<Notificacion, Long> {

	List<Notificacion> findByUsuarioIdOrderByCreadaEnDescIdDesc(Long usuarioId, Pageable pagina);

	List<Notificacion> findByUsuarioIdAndLeidaFalseOrderByCreadaEnDescIdDesc(Long usuarioId, Pageable pagina);

	long countByUsuarioIdAndLeidaFalse(Long usuarioId);

	Optional<Notificacion> findByIdAndUsuarioId(Long id, Long usuarioId);

	/** Hay una NO leida del mismo tipo y texto creada despues de {@code desde} (estrictamente). */
	boolean existsByUsuarioIdAndTipoAndMensajeAndLeidaFalseAndCreadaEnAfter(Long usuarioId, TipoNotificacion tipo,
			String mensaje, Instant desde);

	/** Marca de golpe todas las no leidas del usuario; devuelve cuantas cambiaron. */
	@Modifying(flushAutomatically = true)
	@Query("update Notificacion n set n.leida = true where n.usuario.id = :usuarioId and n.leida = false")
	int marcarTodasLeidas(Long usuarioId);

	/**
	 * Purga: borra hasta {@code lote} notificaciones LEIDAS creadas antes de {@code limite} (las mas antiguas primero; usa
	 * notificacion_creada_en_idx) y devuelve cuantas borro. Cada llamada es su propia transaccion corta.
	 */
	@Transactional
	@Modifying
	@Query(value = """
			delete from notificacion where id in (
			  select id from notificacion
			  where leida = true and creada_en < cast(:limite as timestamptz)
			  order by creada_en limit :lote)
			""", nativeQuery = true)
	int borrarLeidasAnterioresA(Instant limite, int lote);

	/** Igual, para las NO leidas (ventana de retencion mas larga). */
	@Transactional
	@Modifying
	@Query(value = """
			delete from notificacion where id in (
			  select id from notificacion
			  where leida = false and creada_en < cast(:limite as timestamptz)
			  order by creada_en limit :lote)
			""", nativeQuery = true)
	int borrarNoLeidasAnterioresA(Instant limite, int lote);
}
