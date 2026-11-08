package com.vibora.reserva;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface ReservaRepository extends JpaRepository<Reserva, Long> {

	/*
	 * Las dos consultas de solape comparan rangos con tstzrange(inicio, fin) && tstzrange(?, ?) y el estado como LITERAL
	 * ('CONFIRMADA'): son exactamente la expresion y el predicado del indice gist parcial de reserva_sin_solape
	 * (pista_id, tstzrange(inicio, fin)) WHERE estado = 'CONFIRMADA' (V1), asi PostgreSQL puede usarlo. El predicado
	 * "inicio < fin AND fin > inicio" solo podia usar el btree por inicio. Semantica identica: tstzrange es semiabierto [),
	 * un rango que empieza donde acaba otro no lo solapa. El estado no es un parametro a proposito: con un parametro el
	 * planificador no puede demostrar el predicado del indice parcial en un plan generico. Constantes publicas para que
	 * los tests hagan EXPLAIN de la SQL real.
	 */
	String SQL_HAY_SOLAPE = """
			select exists (
			  select 1 from reserva r
			  where r.pista_id = :pistaId and r.estado = 'CONFIRMADA'
			    and tstzrange(r.inicio, r.fin) && tstzrange(cast(:inicio as timestamptz), cast(:fin as timestamptz)))
			""";

	String SQL_SOLAPADAS_CONFIRMADAS = """
			select r.* from reserva r
			where r.pista_id = :pistaId and r.estado = 'CONFIRMADA'
			  and tstzrange(r.inicio, r.fin) && tstzrange(cast(:desde as timestamptz), cast(:hasta as timestamptz))
			order by r.inicio, r.id
			""";

	/** Hay una reserva CONFIRMADA de la pista que solapa [inicio, fin) (intervalos semiabiertos; las canceladas no cuentan). */
	@Query(value = SQL_HAY_SOLAPE, nativeQuery = true)
	boolean haySolape(Long pistaId, Instant inicio, Instant fin);

	/** El usuario ha reservado (en cualquier estado) alguna pista del club. */
	boolean existsByUsuarioIdAndPistaClubId(Long usuarioId, Long clubId);

	/** Reservas CONFIRMADAS de la pista que solapan [desde, hasta), por hora de inicio (agenda). */
	@Query(value = SQL_SOLAPADAS_CONFIRMADAS, nativeQuery = true)
	List<Reserva> solapadasConfirmadas(Long pistaId, Instant desde, Instant hasta);

	/** Con pista, club y jugadores en la misma consulta: evita una consulta por reserva al construir la respuesta. */
	@EntityGraph(attributePaths = { "pista", "pista.club", "participantes" })
	List<Reserva> findByUsuarioIdOrderByCreadoEnDescIdDesc(Long usuarioId);

	/** Reservas del usuario en ese estado que empiezan despues de {@code ahora} (las "activas" para el tope por jugador). */
	long countByUsuarioIdAndEstadoAndInicioAfter(Long usuarioId, EstadoReserva estado, Instant ahora);

	/**
	 * Con bloqueo de escritura de la fila (SELECT ... FOR UPDATE): altas, bajas, cancelaciones y pagos de una misma
	 * reserva se serializan. Orden de bloqueo en todo el sistema: primero la reserva, despues sus cargos.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select r from Reserva r where r.id = :id")
	Optional<Reserva> findByIdParaActualizar(Long id);

	/**
	 * Partidos abiertos, confirmados, que empiezan en (despues de ahora) y [desde, hasta), con alguna plaza libre,
	 * por club opcional. Trae pista, club, organizador y jugadores (con su usuario) en una sola consulta.
	 */
	@EntityGraph(attributePaths = { "pista", "pista.club", "usuario", "participantes", "participantes.usuario" })
	@Query("""
			select r from Reserva r
			where r.abierta = true and r.estado = com.vibora.reserva.EstadoReserva.CONFIRMADA
			  and r.inicio > :ahora and r.inicio >= :desde and r.inicio < :hasta
			  and (:clubId is null or r.pista.club.id = :clubId)
			  and size(r.participantes) < 4
			order by r.inicio, r.id
			""")
	List<Reserva> partidosAbiertos(Instant ahora, Instant desde, Instant hasta, Long clubId);

	/**
	 * Reservas AFECTADAS por un bloqueo de la pista: confirmadas, que aun no han empezado ({@code inicio > ahora}) y
	 * que solapan [desde, hasta). Las adyacentes no cuentan (intervalos semiabiertos). Un bloqueo sin fin se consulta
	 * con un {@code hasta} lejano (PostgreSQL no tipa un parametro nulo en "? is null"). Con organizador y jugadores
	 * en la misma consulta.
	 */
	@EntityGraph(attributePaths = { "usuario", "participantes", "participantes.usuario" })
	@Query("""
			select r from Reserva r
			where r.pista.id = :pistaId and r.estado = com.vibora.reserva.EstadoReserva.CONFIRMADA
			  and r.inicio > :ahora and r.fin > :desde and r.inicio < :hasta
			order by r.inicio, r.id
			""")
	List<Reserva> afectadasPorBloqueo(Long pistaId, Instant ahora, Instant desde, Instant hasta);

	/** Los ids de las mismas, en orden ascendente: el orden en el que se bloquean para cancelarlas (sin interbloqueos). */
	@Query("""
			select r.id from Reserva r
			where r.pista.id = :pistaId and r.estado = com.vibora.reserva.EstadoReserva.CONFIRMADA
			  and r.inicio > :ahora and r.fin > :desde and r.inicio < :hasta
			order by r.id
			""")
	List<Long> idsAfectadasPorBloqueo(Long pistaId, Instant ahora, Instant desde, Instant hasta);

	/** Reservas (cualquier estado) del club que empiezan en [desde, hasta). */
	List<Reserva> findByPistaClubIdAndInicioGreaterThanEqualAndInicioLessThanOrderByInicioAscIdAsc(Long clubId,
			Instant desde, Instant hasta);
}
