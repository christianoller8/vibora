package com.vibora.auth;

import com.vibora.usuario.UsuarioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

/**
 * Revocacion inmediata de accesos: el claim "ver" del JWT debe coincidir con usuario.version_sesion (una consulta por
 * indice por peticion). Un JWT SIN el claim cuenta como version 0, asi los emitidos antes de existir la version siguen
 * valiendo hasta que caduquen. Un usuario que ya no existe tampoco pasa. Se engancha al decodificador, de modo que lo
 * aplican por igual la API REST y el frame CONNECT del WebSocket.
 */
@Component
@RequiredArgsConstructor
public class VersionSesionValidador implements OAuth2TokenValidator<Jwt> {

	private static final OAuth2Error ERROR = new OAuth2Error("invalid_token", "La sesión ya no es válida", null);

	private final UsuarioRepository usuarios;

	@Override
	public OAuth2TokenValidatorResult validate(Jwt jwt) {
		Integer actual = usuarios.findVersionSesionByEmail(jwt.getSubject()).orElse(null);
		if (actual == null) {
			return OAuth2TokenValidatorResult.failure(ERROR);
		}
		Object enToken = jwt.getClaims().get(JwtService.CLAIM_VERSION);
		int version = enToken == null ? 0 : enToken instanceof Number n ? n.intValue() : -1;
		return version == actual ? OAuth2TokenValidatorResult.success() : OAuth2TokenValidatorResult.failure(ERROR);
	}
}
