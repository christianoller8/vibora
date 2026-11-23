package com.vibora.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Todas las escrituras masivas limpian el contexto de persistencia: son sentencias directas a la BD y una entidad
 * ya cargada se quedaria con el estado de antes (p. ej. "no usada" tras rotarla).
 */
public interface SesionRefrescoRepository extends JpaRepository<SesionRefresco, Long> {

	Optional<SesionRefresco> findByHashToken(String hashToken);

	/**
	 * Rotacion ATOMICA: marca el token como usado solo si sigue sin usar ni revocar y no ha caducado (ni el token ni el tope
	 * de su familia). Devuelve 1 si ganó; 0 si no. Con dos peticiones a la vez la segunda espera el bloqueo de fila de la
	 * primera y, al reevaluar el WHERE, ya no cumple "usado_en is null": nunca pueden ganar las dos.
	 */
	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("""
			update SesionRefresco s set s.usadoEn = :ahora
			where s.hashToken = :hash and s.usadoEn is null and s.revocadoEn is null
			  and s.expiraEn > :ahora and s.familiaExpiraEn > :ahora
			""")
	int marcarUsada(String hash, Instant ahora);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("update SesionRefresco s set s.revocadoEn = :ahora where s.familia = :familia and s.revocadoEn is null")
	int revocarFamilia(UUID familia, Instant ahora);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("update SesionRefresco s set s.revocadoEn = :ahora where s.usuarioId = :usuarioId and s.revocadoEn is null")
	int revocarDeUsuario(Long usuarioId, Instant ahora);

	/**
	 * Purga: borra hasta {@code lote} filas cuya FAMILIA caduco o que se revocaron antes de {@code limite} (estrictamente; usa
	 * sesion_refresco_familia_expira_en_idx y sesion_refresco_revocado_en_idx) y devuelve cuantas borro. Se purga por el tope de
	 * la familia, no por la caducidad propia de la fila: un token rotado debe seguir existiendo mientras la familia pueda
	 * refrescarse, o reutilizarlo daria "desconocido" en vez de revocar la familia. El lote se elige ordenado por id y con
	 * {@code for update skip locked}: toma los bloqueos de fila en un orden fijo y se salta las que una revocacion concurrente
	 * (cerrar-sesion-todas) tiene bloqueadas, asi que nunca espera ni puede interbloquearse con ella. Cada llamada es su propia
	 * transaccion corta.
	 */
	@Transactional
	@Modifying
	@Query(value = """
			delete from sesion_refresco where id in (
			  select id from sesion_refresco
			  where familia_expira_en < cast(:limite as timestamptz) or revocado_en < cast(:limite as timestamptz)
			  order by id limit :lote for update skip locked)
			""", nativeQuery = true)
	int borrarVencidasAnterioresA(Instant limite, int lote);
}
