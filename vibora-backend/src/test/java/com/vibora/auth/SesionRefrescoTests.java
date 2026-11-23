package com.vibora.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.vibora.ApiTestBase;
import com.vibora.RelojMutable;
import com.vibora.RelojTestConfig;
import com.vibora.usuario.Rol;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Refresh tokens rotatorios en cookie httpOnly y revocacion inmediata por version de sesion, de extremo a extremo
 * (MockMvc, rollback por test). Reloj mutable (arranca en 2030): el TTL deslizante (14 dias) y el tope absoluto (30) se
 * prueban moviendolo, sin esperas.
 */
@Import(RelojTestConfig.class)
class SesionRefrescoTests extends ApiTestBase {

	private static final String COOKIE = "vibora_refresco";
	private static final Instant T0 = RelojTestConfig.AHORA_INICIAL;
	private static final Pattern VALOR_COOKIE = Pattern.compile(COOKIE + "=([^;]*)");
	private static final String NO_AUTENTICADO = "{\"error\":\"No autenticado\"}";

	@Autowired RelojMutable reloj;
	@Autowired JdbcTemplate jdbc;
	@jakarta.persistence.PersistenceContext jakarta.persistence.EntityManager em;
	@Value("${vibora.jwt.secret}") String secreto;

	@BeforeEach
	void relojAlInicio() {
		reloj.fijar(T0);
	}

	@AfterEach
	void restaurarReloj() {
		reloj.fijar(T0);
	}

	// ---- ayudas ----

	private MvcResult login(String email) throws Exception {
		return mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, PASSWORD)))
				.andExpect(status().isOk()).andReturn();
	}

	private static String setCookie(MvcResult r) {
		return r.getResponse().getHeader("Set-Cookie");
	}

	private static String valorDe(MvcResult r) {
		Matcher m = VALOR_COOKIE.matcher(String.valueOf(setCookie(r)));
		assertThat(m.find()).as("Set-Cookie: %s", setCookie(r)).isTrue();
		return m.group(1);
	}

	private static String accesoDe(MvcResult r) throws Exception {
		Matcher m = Pattern.compile("\"token\":\"([^\"]+)\"").matcher(r.getResponse().getContentAsString());
		assertThat(m.find()).isTrue();
		return m.group(1);
	}

	private ResultActions refrescar(String valor) throws Exception {
		return mvc.perform(post("/api/auth/refrescar").cookie(new Cookie(COOKIE, valor)));
	}

	private ResultActions cerrarSesion(String valor) throws Exception {
		return mvc.perform(post("/api/auth/cerrar-sesion").cookie(new Cookie(COOKIE, valor)));
	}

	private ResultActions me(String token) throws Exception {
		return mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token));
	}

	private static String sha256(String valor) throws Exception {
		return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(valor.getBytes(StandardCharsets.UTF_8)));
	}

	private static void assertCookieBorrada(MvcResult r) {
		assertThat(setCookie(r)).startsWith(COOKIE + "=;").contains("Max-Age=0").contains("Path=/api/auth")
				.contains("HttpOnly").contains("Secure").contains("SameSite=Strict");
	}

	private long maxAgeDe(MvcResult r) {
		Matcher m = Pattern.compile("Max-Age=(\\d+)").matcher(setCookie(r));
		assertThat(m.find()).as("Set-Cookie: %s", setCookie(r)).isTrue();
		return Long.parseLong(m.group(1));
	}

	private long filas(String condicion) {
		return jdbc.queryForObject("select count(*) from sesion_refresco where " + condicion, Long.class);
	}

	/** JWT firmado a mano (como el de antes del despliegue si {@code version} es null). */
	private String jwt(String email, Integer version) {
		var clave = new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
		var codificador = new NimbusJwtEncoder(new ImmutableSecret<>(clave));
		Instant ahora = Instant.now();
		JwtClaimsSet.Builder claims = JwtClaimsSet.builder().issuer("vibora").subject(email).claim("rol", "JUGADOR")
				.issuedAt(ahora).expiresAt(ahora.plus(Duration.ofHours(1)));
		if (version != null) {
			claims.claim("ver", version);
		}
		return codificador.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims.build()))
				.getTokenValue();
	}

	/** Acceso firmado correctamente pero caducado ayer: lo que un cliente inactivo aun tendria en memoria. */
	private String jwtCaducado() {
		var clave = new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
		Instant ayer = Instant.now().minus(Duration.ofDays(1));
		return new NimbusJwtEncoder(new ImmutableSecret<>(clave)).encode(JwtEncoderParameters.from(
				JwsHeader.with(MacAlgorithm.HS256).build(), JwtClaimsSet.builder().issuer("vibora").subject("ana@vibora.com")
						.claim("rol", "JUGADOR").issuedAt(ayer.minusSeconds(3600)).expiresAt(ayer).build())).getTokenValue();
	}

	// ---- login ----

	@Test
	void login_estableceLaCookieDeRefrescoConTodosSusAtributos_yElCuerpoNoCambia() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		MvcResult r = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"ana@vibora.com\",\"password\":\"%s\"}".formatted(PASSWORD)))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.token").isNotEmpty())
				.andExpect(jsonPath("$.tipo").value("Bearer"))
				.andExpect(jsonPath("$.expiraEn").isNotEmpty())
				.andExpect(jsonPath("$.refresco").doesNotExist())
				.andReturn();

		assertThat(setCookie(r)).startsWith(COOKIE + "=").contains("HttpOnly").contains("Secure").contains("SameSite=Strict")
				.contains("Path=/api/auth").contains("Max-Age=1209600");
		assertThat(valorDe(r)).matches("[A-Za-z0-9_-]{43}"); // 32 bytes en base64url sin relleno
		assertThat(r.getResponse().getContentAsString()).doesNotContain(valorDe(r));
	}

	@Test
	void elTokenNuncaSeGuardaEnClaro_soloSuSha256() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		String valor = valorDe(login("ana@vibora.com"));

		assertThat(filas("hash_token = '" + sha256(valor) + "'")).isEqualTo(1);
		assertThat(filas("hash_token = '" + valor + "'")).isZero();
	}

	@Test
	void cadaLoginAbreUnaFamiliaNueva() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		login("ana@vibora.com");
		login("ana@vibora.com");

		assertThat(jdbc.queryForObject("select count(distinct familia) from sesion_refresco", Long.class)).isEqualTo(2);
	}

	@Test
	void loginFallido_noPoneCookieNiCreaFilas() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		MvcResult r = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"ana@vibora.com\",\"password\":\"incorrecta-123\"}"))
				.andExpect(status().isUnauthorized()).andReturn();

		assertThat(setCookie(r)).isNull();
		assertThat(filas("true")).isZero();
	}

	// ---- refrescar ----

	@Test
	void refrescar_rotaElToken_devuelveUnAccesoNuevoQueFuncionaYUnaCookieNueva() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		MvcResult inicial = login("ana@vibora.com");
		String vieja = valorDe(inicial);
		reloj.fijar(T0.plusSeconds(120));

		MvcResult r = refrescar(vieja).andExpect(status().isOk())
				.andExpect(jsonPath("$.token").isNotEmpty())
				.andExpect(jsonPath("$.tipo").value("Bearer"))
				.andExpect(jsonPath("$.expiraEn").isNotEmpty()).andReturn();

		assertThat(valorDe(r)).isNotEqualTo(vieja);
		assertThat(setCookie(r)).contains("HttpOnly").contains("Secure").contains("SameSite=Strict")
				.contains("Path=/api/auth").contains("Max-Age=1209600");
		assertThat(accesoDe(r)).isNotEqualTo(accesoDe(inicial)); // otro instante de emision
		me(accesoDe(r)).andExpect(status().isOk()).andExpect(jsonPath("$.email").value("ana@vibora.com"));
		assertThat(filas("usado_en is not null")).isEqualTo(1);
		assertThat(filas("usado_en is null and revocado_en is null")).isEqualTo(1);
	}

	@Test
	void reutilizarUnTokenYaRotado_revocaToda_laFamilia_yElNuevoTambienFalla() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String primero = valorDe(login("ana@vibora.com"));
		MvcResult rotado = refrescar(primero).andExpect(status().isOk()).andReturn();
		String segundo = valorDe(rotado);

		MvcResult reuso = refrescar(primero).andExpect(status().isUnauthorized()).andExpect(content().json(NO_AUTENTICADO)).andReturn();

		assertCookieBorrada(reuso);
		assertThat(filas("revocado_en is null")).as("toda la familia queda revocada").isZero();
		MvcResult tambienFalla = refrescar(segundo).andExpect(status().isUnauthorized()).andReturn();
		assertCookieBorrada(tambienFalla);
	}

	@Test
	void laRevocacionDeUnaFamiliaNoTocaOtraFamiliaDelMismoUsuario() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String a = valorDe(login("ana@vibora.com"));
		String b = valorDe(login("ana@vibora.com"));
		refrescar(a).andExpect(status().isOk());
		refrescar(a).andExpect(status().isUnauthorized()); // reuso en la familia A

		refrescar(b).andExpect(status().isOk()); // la B sigue viva
	}

	@Test
	void sinCookie_oDesconocida_401_yLaCookieSeBorra() throws Exception {
		MvcResult sin = mvc.perform(post("/api/auth/refrescar")).andExpect(status().isUnauthorized())
				.andExpect(content().json(NO_AUTENTICADO)).andReturn();
		MvcResult desconocida = refrescar("no-existe").andExpect(status().isUnauthorized())
				.andExpect(content().json(NO_AUTENTICADO)).andReturn();

		assertCookieBorrada(sin);
		assertCookieBorrada(desconocida);
	}

	@Test
	void tokenCaducado_401_yLaCookieSeBorra() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String valor = valorDe(login("ana@vibora.com"));
		reloj.fijar(T0.plus(Duration.ofDays(14)).plusSeconds(1));

		MvcResult r = refrescar(valor).andExpect(status().isUnauthorized()).andReturn();

		assertCookieBorrada(r);
	}

	@Test
	void justoAntesDeCaducar_todaviaSeRefresca() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String valor = valorDe(login("ana@vibora.com"));
		reloj.fijar(T0.plus(Duration.ofDays(14)).minusSeconds(1));

		refrescar(valor).andExpect(status().isOk());
	}

	@Test
	void elTopeAbsolutoDeLaFamiliaCortaElTtlDeslizante() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String valor = valorDe(login("ana@vibora.com"));
		for (int dia : new int[] { 13, 26 }) { // cada refresco dentro de los 14 dias del anterior
			reloj.fijar(T0.plus(Duration.ofDays(dia)));
			MvcResult r = refrescar(valor).andExpect(status().isOk()).andReturn();
			valor = valorDe(r);
			if (dia == 26) {
				// 26 + 14 = 40 dias superaria el tope de 30 desde el login: la cookie dura solo los 4 que quedan
				assertThat(maxAgeDe(r)).isEqualTo(Duration.ofDays(4).toSeconds());
				assertThat(filas("revocado_en is null and usado_en is null and expira_en = familia_expira_en")).isEqualTo(1);
			}
		}
		reloj.fijar(T0.plus(Duration.ofDays(30)).plusSeconds(1));

		MvcResult r = refrescar(valor).andExpect(status().isUnauthorized()).andReturn();

		assertCookieBorrada(r);
	}

	@Test
	void elTopeAbsolutoTambienSeComprueba_aunLaFilaNoHayaCaducado() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String valor = valorDe(login("ana@vibora.com"));
		// fila vigente (expira dentro de 14 dias) pero con la familia ya pasada de su tope: no puede rotar
		jdbc.update("update sesion_refresco set familia_expira_en = ?", java.sql.Timestamp.from(T0.minusSeconds(1)));

		refrescar(valor).andExpect(status().isUnauthorized());
	}

	@Test
	void usuarioDesactivado_noRefresca_yLaFamiliaQuedaRevocada() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String valor = valorDe(login("ana@vibora.com"));
		jdbc.update("update usuario set activo = false where email = 'ana@vibora.com'");
		em.clear(); // el test es una sola transaccion: sin esto el usuario seguiria "activo" en el contexto de persistencia

		MvcResult r = refrescar(valor).andExpect(status().isUnauthorized()).andReturn();

		assertCookieBorrada(r);
		assertThat(filas("revocado_en is null")).isZero();
	}

	@Test
	void elRefrescoNoNecesitaTokenDeAcceso_yUnAccesoCaducadoEnLaCabeceraNoLoImpide() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String valor = valorDe(login("ana@vibora.com"));

		mvc.perform(post("/api/auth/refrescar").cookie(new Cookie(COOKIE, valor)).header("Authorization", "Bearer " + jwtCaducado()))
				.andExpect(status().isOk());
	}

	// ---- cerrar sesion ----

	@Test
	void cerrarSesion_revocaLaFamilia_borraLaCookie_yEsIdempotente() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String primero = valorDe(login("ana@vibora.com"));
		String segundo = valorDe(refrescar(primero).andExpect(status().isOk()).andReturn());

		MvcResult r = cerrarSesion(segundo).andExpect(status().isNoContent()).andReturn();

		assertCookieBorrada(r);
		assertThat(filas("revocado_en is null")).isZero();
		refrescar(segundo).andExpect(status().isUnauthorized());
		assertCookieBorrada(cerrarSesion(segundo).andExpect(status().isNoContent()).andReturn()); // otra vez: sigue siendo 204
	}

	@Test
	void cerrarSesionConUnTokenYaRotado_tambienRevocaLaFamilia() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String primero = valorDe(login("ana@vibora.com"));
		String segundo = valorDe(refrescar(primero).andExpect(status().isOk()).andReturn());

		cerrarSesion(primero).andExpect(status().isNoContent());

		refrescar(segundo).andExpect(status().isUnauthorized());
	}

	@Test
	void cerrarSesionSinCookie_204_yBorraLaCookie() throws Exception {
		MvcResult r = mvc.perform(post("/api/auth/cerrar-sesion")).andExpect(status().isNoContent()).andReturn();

		assertCookieBorrada(r);
	}

	@Test
	void cerrarSesion_funcionaSoloConLaCookie_aunqueElAccesoYaHayaCaducado() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String valor = valorDe(login("ana@vibora.com"));

		mvc.perform(post("/api/auth/cerrar-sesion").cookie(new Cookie(COOKIE, valor)).header("Authorization", "Bearer " + jwtCaducado()))
				.andExpect(status().isNoContent());

		assertThat(filas("revocado_en is null")).isZero();
	}

	// ---- cerrar todas las sesiones / version de sesion ----

	@Test
	void cerrarSesionTodas_invalidaAlInstanteElAccesoVigente_revocaTodasLasFamilias_yBorraLaCookie() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		MvcResult uno = login("ana@vibora.com");
		MvcResult dos = login("ana@vibora.com");
		String acceso = accesoDe(uno);
		me(acceso).andExpect(status().isOk());

		MvcResult r = mvc.perform(post("/api/auth/cerrar-sesion-todas").header("Authorization", "Bearer " + acceso))
				.andExpect(status().isNoContent()).andReturn();

		assertCookieBorrada(r);
		me(acceso).andExpect(status().isUnauthorized()).andExpect(content().json(NO_AUTENTICADO));
		me(accesoDe(dos)).andExpect(status().isUnauthorized());
		refrescar(valorDe(uno)).andExpect(status().isUnauthorized());
		refrescar(valorDe(dos)).andExpect(status().isUnauthorized());
		assertThat(filas("revocado_en is null")).isZero();
		assertThat(jdbc.queryForObject("select version_sesion from usuario where email = 'ana@vibora.com'", Integer.class))
				.isEqualTo(1);
	}

	@Test
	void trasCerrarSesionTodas_unLoginNuevoVuelveAFuncionar() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		String acceso = accesoDe(login("ana@vibora.com"));
		mvc.perform(post("/api/auth/cerrar-sesion-todas").header("Authorization", "Bearer " + acceso))
				.andExpect(status().isNoContent());

		MvcResult nuevo = login("ana@vibora.com");

		me(accesoDe(nuevo)).andExpect(status().isOk());
		refrescar(valorDe(nuevo)).andExpect(status().isOk());
	}

	@Test
	void cerrarSesionTodas_noAfectaAOtroUsuario() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		crearUsuario("beto@vibora.com", Rol.JUGADOR, null);
		String deAna = accesoDe(login("ana@vibora.com"));
		MvcResult beto = login("beto@vibora.com");

		mvc.perform(post("/api/auth/cerrar-sesion-todas").header("Authorization", "Bearer " + deAna))
				.andExpect(status().isNoContent());

		me(accesoDe(beto)).andExpect(status().isOk());
		refrescar(valorDe(beto)).andExpect(status().isOk());
	}

	@Test
	void cerrarSesionTodas_exigeAutenticacion() throws Exception {
		mvc.perform(post("/api/auth/cerrar-sesion-todas")).andExpect(status().isUnauthorized())
				.andExpect(content().json(NO_AUTENTICADO));
	}

	@Test
	void unaccesoSinClaimVer_cuentaComoVersion0_yFuncionaMientrasLaVersionSea0() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		me(jwt("ana@vibora.com", null)).andExpect(status().isOk());
		me(jwt("ana@vibora.com", 0)).andExpect(status().isOk());
	}

	@Test
	void unAccesoConVersionDistintaDeLaDeLaBd_401() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);

		me(jwt("ana@vibora.com", 1)).andExpect(status().isUnauthorized()).andExpect(content().json(NO_AUTENTICADO));
	}

	@Test
	void unAccesoSinVer_deja_deValer_cuandoLaVersionYaNoEs0() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		jdbc.update("update usuario set version_sesion = 3 where email = 'ana@vibora.com'");

		me(jwt("ana@vibora.com", null)).andExpect(status().isUnauthorized());
		me(jwt("ana@vibora.com", 0)).andExpect(status().isUnauthorized());
		me(jwt("ana@vibora.com", 3)).andExpect(status().isOk());
	}

	@Test
	void unAccesoDeUnUsuarioQueNoExiste_401() throws Exception {
		me(jwt("fantasma@vibora.com", 0)).andExpect(status().isUnauthorized()).andExpect(content().json(NO_AUTENTICADO));
	}

	@Test
	void elAccesoEmitidoLlevaElClaimVerConLaVersionActual() throws Exception {
		crearUsuario("ana@vibora.com", Rol.JUGADOR, null);
		jdbc.update("update usuario set version_sesion = 7 where email = 'ana@vibora.com'");
		em.clear(); // el test es una sola transaccion: el usuario cacheado aun tendria la version 0

		String acceso = accesoDe(login("ana@vibora.com"));

		String carga = new String(java.util.Base64.getUrlDecoder().decode(acceso.split("\\.")[1]), StandardCharsets.UTF_8);
		assertThat(carga).contains("\"ver\":7");
	}
}
