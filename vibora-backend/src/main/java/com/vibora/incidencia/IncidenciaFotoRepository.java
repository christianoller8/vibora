package com.vibora.incidencia;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface IncidenciaFotoRepository extends JpaRepository<IncidenciaFoto, Long> {

	@EntityGraph(attributePaths = "subidaPor")
	List<IncidenciaFoto> findByIncidenciaIdOrderByIdAsc(Long incidenciaId);

	/** Filtra tambien por incidencia: una foto de otra incidencia es, a todos los efectos, inexistente (sin IDOR). */
	@EntityGraph(attributePaths = "subidaPor")
	Optional<IncidenciaFoto> findByIdAndIncidenciaId(Long id, Long incidenciaId);

	long countByIncidenciaId(Long incidenciaId);

	/** Fotos subidas por una persona despues de {@code desde} (cuota diaria: ventana movil de 24 h). */
	long countBySubidaPorIdAndCreadaEnAfter(Long usuarioId, java.time.Instant desde);

	/** La foto mas antigua que todavia cuenta para la cuota (la primera que saldra de la ventana); vacio si no hay ninguna. */
	@Query("select min(f.creadaEn) from IncidenciaFoto f where f.subidaPor.id = :usuarioId and f.creadaEn > :desde")
	Optional<java.time.Instant> primeraSubidaDesde(@Param("usuarioId") Long usuarioId, @Param("desde") java.time.Instant desde);
}
