package com.vibora.auth;

import com.vibora.common.exception.CredencialesInvalidasException;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

/**
 * Tokens de refresco rotatorios. Cada login abre una FAMILIA; cada refresco consume el token presentado y entrega el
 * siguiente de la misma familia. El token son 32 bytes de SecureRandom en base64url y nunca se guarda en claro (solo su
 * SHA-256). Vida deslizante {@code refresco-dias} por token, acotada por el tope absoluto {@code maximo-dias} desde el login.
 * <p>
 * Reutilizar un token ya rotado (o perder la carrera contra otra peticion con el mismo token) indica que hay una copia
 * en otras manos: se revoca la familia entera. Los metodos que "fallan" devuelven vacio en vez de lanzar, para que la
 * transaccion CONFIRME esa revocacion.
 */
@Service
@RequiredArgsConstructor
public class SesionService {

	private static final SecureRandom ALEATORIO = new SecureRandom();

	private final SesionRefrescoRepository sesiones;
	private final UsuarioRepository usuarios;
	private final JwtService jwtService;
	private final SesionProperties propiedades;
	private final Clock reloj;

	/** Login: familia nueva con su tope absoluto. */
	@Transactional
	public SesionIniciada iniciar(Usuario usuario) {
		Instant ahora = ahora();
		// FOR SHARE antes de abrir la familia (choca con el bloqueo exclusivo de "cerrar todas") y la version del claim "ver"
		// se lee AQUI, bajo el bloqueo: la entidad recibida se cargo antes de bcrypt y puede estar desfasada.
		int version = usuarios.findVersionSesionBloqueadaPorId(usuario.getId()).orElseThrow(CredencialesInvalidasException::new);
		return emitir(usuario, version, UUID.randomUUID(), ahora.plus(Duration.ofDays(propiedades.maximoDias())), ahora);
	}

	/** Vacio si el token no sirve (desconocido, caducado, revocado, pasado de tope, reutilizado o usuario inactivo). */
	@Transactional
	public Optional<SesionIniciada> refrescar(String token) {
		if (token == null || token.isBlank()) {
			return Optional.empty();
		}
		String hash = sha256(token);
		SesionRefresco fila = sesiones.findByHashToken(hash).orElse(null);
		if (fila == null) {
			return Optional.empty();
		}
		UUID familia = fila.getFamilia();
		Instant tope = fila.getFamiliaExpiraEn();
		Instant ahora = ahora();

		// Primero el bloqueo del usuario (igual que cerrarTodas): evita que "cerrar todas" deje pasar una fila nueva
		Usuario usuario = usuarios.findBloqueadoPorId(fila.getUsuarioId()).orElse(null);

		if (sesiones.marcarUsada(hash, ahora) == 0) {
			SesionRefresco actual = sesiones.findByHashToken(hash).orElse(null);
			if (actual != null && actual.getUsadoEn() != null) {
				// Rotacion ESTRICTA, sin margen de gracia (decision): el cliente debe serializar sus refrescos (el frontend lo
				// hara con Web Locks en R2). Reintentar con un token ya rotado, p. ej. tras perder la respuesta, cierra la
				// sesion a proposito: no se distingue de una copia robada.
				sesiones.revocarFamilia(familia, ahora); // reutilizacion o carrera perdida
			}
			return Optional.empty(); // revocado, caducado o pasado de tope: basta con negarlo
		}
		if (usuario == null || !usuario.isActivo()) {
			sesiones.revocarFamilia(familia, ahora);
			return Optional.empty();
		}
		return Optional.of(emitir(usuario, usuario.getVersionSesion(), familia, tope, ahora)); // cargado bajo FOR SHARE
	}

	/** Revoca la familia del token presentado (aunque ya este rotado). Idempotente: sin token o desconocido no hace nada. */
	@Transactional
	public void cerrar(String token) {
		if (token == null || token.isBlank()) {
			return;
		}
		sesiones.findByHashToken(sha256(token)).ifPresent(fila -> {
			// Primero el usuario (FOR NO KEY UPDATE, choca con el FOR SHARE de refrescar): una rotacion en curso termina antes
			// (y su fila nueva se revoca aqui) o ya ve la familia revocada. Mismo orden que cerrarTodas: sin interbloqueos.
			usuarios.bloquearParaActualizar(fila.getUsuarioId());
			sesiones.revocarFamilia(fila.getFamilia(), ahora());
		});
	}

	/** Cerrar sesion en todas partes: sube la version (invalida los accesos vigentes) y revoca todos los refrescos. */
	@Transactional
	public void cerrarTodas(String email) {
		usuarios.findByEmail(email).ifPresent(u -> {
			usuarios.bloquearParaActualizar(u.getId()); // primero el usuario, como en cerrar, refrescar e iniciar
			usuarios.incrementarVersionSesion(email);
			sesiones.revocarDeUsuario(u.getId(), ahora());
		});
	}

	private SesionIniciada emitir(Usuario usuario, int version, UUID familia, Instant tope, Instant ahora) {
		String token = nuevoToken();
		Instant expira = min(ahora.plus(Duration.ofDays(propiedades.refrescoDias())), tope);
		SesionRefresco fila = new SesionRefresco();
		fila.setUsuarioId(usuario.getId());
		fila.setFamilia(familia);
		fila.setHashToken(sha256(token));
		fila.setCreadoEn(ahora);
		fila.setExpiraEn(expira);
		fila.setFamiliaExpiraEn(tope);
		sesiones.save(fila);
		return new SesionIniciada(TokenResponse.bearer(jwtService.generar(usuario, version)), token, Duration.between(ahora, expira));
	}

	private Instant ahora() {
		return reloj.instant().truncatedTo(ChronoUnit.MILLIS);
	}

	private static Instant min(Instant a, Instant b) {
		return a.isBefore(b) ? a : b;
	}

	private static String nuevoToken() {
		byte[] bytes = new byte[32];
		ALEATORIO.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	private static String sha256(String valor) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(valor.getBytes(StandardCharsets.UTF_8)));
		} catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex); // SHA-256 existe en toda JVM
		}
	}
}
