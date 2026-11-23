package com.vibora.usuario;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface UsuarioRepository extends JpaRepository<Usuario, Long> {

	Optional<Usuario> findByEmail(String email);

	/** Usuario con su club en la misma consulta (evita una carga perezosa aparte para el perfil). */
	@EntityGraph(attributePaths = "club")
	@Query("select u from Usuario u where u.email = :email")
	Optional<Usuario> findConClubByEmail(@Param("email") String email);

	boolean existsByEmail(String email);

	/** Version de sesion vigente (una consulta por indice; la usa el validador del JWT en cada peticion). */
	@Query("select u.versionSesion from Usuario u where u.email = :email")
	Optional<Integer> findVersionSesionByEmail(String email);

	/** Sube la version de sesion de golpe (atomico): todos los accesos emitidos antes dejan de valer. */
	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query(value = "update usuario set version_sesion = version_sesion + 1 where email = :email", nativeQuery = true)
	int incrementarVersionSesion(String email);

	/**
	 * Carga con FOR SHARE. Refrescar y "cerrar todas" toman primero este bloqueo (y "cerrar todas" lo pide exclusivo al subir
	 * la version): asi una rotacion en curso no puede dejar una fila nueva sin revocar tras el "cerrar todas", y ambos
	 * toman los bloqueos en el mismo orden (sin interbloqueo).
	 */
	@Lock(LockModeType.PESSIMISTIC_READ)
	@Query("select u from Usuario u where u.id = :id")
	Optional<Usuario> findBloqueadoPorId(Long id);

	/**
	 * Bloqueo exclusivo de la fila (FOR NO KEY UPDATE, el mismo que toma la subida de version): choca con el FOR SHARE de
	 * refrescar y de iniciar. Cerrar y "cerrar todas" lo toman PRIMERO, antes de tocar sesion_refresco (orden unico: sin interbloqueos).
	 */
	@Query(value = "select id from usuario where id = :id for no key update", nativeQuery = true)
	Optional<Long> bloquearParaActualizar(Long id);

	/**
	 * Version de sesion leida BAJO FOR SHARE (nativa: una entidad ya cargada no se refrescaria). La usa el login para el claim
	 * "ver" y a la vez para serializarse contra "cerrar todas": o ve la version nueva, o su familia queda revocada.
	 */
	@Query(value = "select version_sesion from usuario where id = :id for share", nativeQuery = true)
	Optional<Integer> findVersionSesionBloqueadaPorId(Long id);

	/** Administradores de un club (a quienes avisar de incidencias nuevas). */
	List<Usuario> findByClubIdAndRol(Long clubId, Rol rol);

	/** Personal del club con alguno de los roles dados: administradores primero, luego por apellidos. */
	@Query("""
			select u from Usuario u
			where u.club.id = :clubId and u.rol in :roles
			order by case when u.rol = com.vibora.usuario.Rol.ADMIN_CLUB then 0 else 1 end, u.apellidos, u.id
			""")
	List<Usuario> findPersonalDelClub(Long clubId, Collection<Rol> roles);
}
