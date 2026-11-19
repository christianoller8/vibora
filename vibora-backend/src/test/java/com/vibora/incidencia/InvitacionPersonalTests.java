package com.vibora.incidencia;

import com.vibora.RelojTestConfig;
import com.vibora.notificacion.TipoNotificacion;
import com.vibora.usuario.Rol;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Invitaciones del personal: administrador del club (/api/clubes/{id}/invitaciones) e invitado (/api/invitaciones). */
class InvitacionPersonalTests extends IncidenciaApiTestBase {

	static final String MENSAJE_UNIFORME = "{\"mensaje\":\"Si el correo es válido, la persona recibirá la invitación.\"}";

	ResultActions listarInv(Persona actor, long clubId, String estado) throws Exception {
		var peticion = get("/api/clubes/" + clubId + "/invitaciones").header("Authorization", actor.token());
		if (estado != null) {
			peticion.param("estado", estado);
		}
		return mvc.perform(peticion);
	}

	ResultActions cancelar(Persona actor, long clubId, long id) throws Exception {
		return mvc.perform(delete("/api/clubes/" + clubId + "/invitaciones/" + id).header("Authorization", actor.token()));
	}

	ResultActions mias(Persona p) throws Exception {
		return mvc.perform(get("/api/invitaciones/mias").header("Authorization", p.token()));
	}

	ResultActions rechazar(Persona p, long id) throws Exception {
		return mvc.perform(post("/api/invitaciones/" + id + "/rechazar").header("Authorization", p.token()));
	}

	/** Estado y cuerpo completos: lo que veria el cliente. */
	record Respuesta(int estado, String cuerpo) {
	}

	Respuesta respuesta(ResultActions r) throws Exception {
		MvcResult m = r.andReturn();
		return new Respuesta(m.getResponse().getStatus(), m.getResponse().getContentAsString());
	}

	String estadoDe(long id) {
		em.flush(); // lo pendiente de la transaccion del test (el servicio no hace commit) antes de leer por JDBC
		return jdbc.queryForObject("select estado from invitacion_personal where id = ?", String.class, id);
	}

	long filas(String where, Object... args) {
		em.flush();
		return jdbc.queryForObject("select count(*) from invitacion_personal where " + where, Long.class, args);
	}

	void avanzar(Duration d) {
		reloj.fijar(reloj.instant().plus(d));
	}

	// ---- invitar: respuesta uniforme ----

	@Test
	void invitar_respuestaIdenticaSeaCualSeaElEstadoDelCorreo_ySinFugasEnElListado() throws Exception {
		// 1) registrado y libre
		Respuesta libre = respuesta(invitar(admin, club.getId(), "otro@vibora.com", "MONITOR"));
		// 2) registrado en OTRO club
		Respuesta enOtroClub = respuesta(invitar(admin, club.getId(), "mantb@vibora.com", "MONITOR"));
		// 3) registrado en ESTE club
		Respuesta enEsteClub = respuesta(invitar(admin, club.getId(), "mant1@vibora.com", "MONITOR"));
		// 4) no registrado
		Respuesta noRegistrado = respuesta(invitar(admin, club.getId(), "nadie@vibora.com", "MONITOR"));
		// 5) invitacion pendiente caducada que se renueva
		invitar(admin, club.getId(), "jugador@vibora.com", "MONITOR").andExpect(status().isAccepted());
		avanzar(Duration.ofDays(15));
		Respuesta renovada = respuesta(invitar(admin, club.getId(), "jugador@vibora.com", "MONITOR"));
		// 6) duplicada viva
		Respuesta duplicada = respuesta(invitar(admin, club.getId(), "nadie@vibora.com", "MONITOR"));

		assertThat(libre.estado()).isEqualTo(202);
		assertThat(libre.cuerpo()).isEqualTo(MENSAJE_UNIFORME);
		for (Respuesta r : List.of(enOtroClub, enEsteClub, noRegistrado, renovada, duplicada)) {
			assertThat(r).isEqualTo(libre);
		}
		// ni el listado distingue: nada dice si el correo esta registrado
		String listado = listarInv(admin, club.getId(), null).andExpect(status().isOk()).andReturn().getResponse()
				.getContentAsString();
		assertThat(listado).doesNotContain("registrad").doesNotContain("usuarioId");
		// no se crea invitacion para quien ya es personal de este club
		assertThat(filas("club_id = ? and email = 'mant1@vibora.com'", club.getId())).isZero();
	}

	@Test
	void invitar_aUnRegistradoCreaLaFilaYElAviso_aUnNoRegistradoSoloLaFila() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());
		invitar(admin, club.getId(), "nadie@vibora.com", "MONITOR").andExpect(status().isAccepted());

		assertThat(filas("estado = 'PENDIENTE'")).isEqualTo(2);
		assertThat(notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA)).singleElement().satisfies(n -> {
			assertThat(n.getMensaje()).contains("Club A").contains("personal de mantenimiento");
		});
		assertThat(totalNotifs()).isEqualTo(1); // nada se envia al correo no registrado
	}

	@Test
	void invitar_elNombreDelClubSeTrunca60_yElEmailSeNormaliza() throws Exception {
		refrescar();
		jdbc.update("update club set nombre = ? where id = ?", "X".repeat(100), club.getId());
		refrescar(); // el club ya cargado en la sesion no vera el cambio hecho por JDBC
		invitar(admin, club.getId(), "OTRO@Vibora.COM", "MONITOR").andExpect(status().isAccepted());

		assertThat(filas("email = 'otro@vibora.com'")).isEqualTo(1);
		String mensaje = notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA).get(0).getMensaje();
		assertThat(mensaje).contains("X".repeat(60)).doesNotContain("X".repeat(61));
	}

	static final String EMOJI = "😀"; // un solo punto de codigo, dos unidades UTF-16

	@Test
	void invitar_elNombreDelClubSeTruncaA60PuntosDeCodigo_sinPartirUnEmoji() throws Exception {
		jdbc.update("update club set nombre = ? where id = ?", EMOJI.repeat(100), club.getId());
		refrescar();
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());

		String mensaje = notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA).get(0).getMensaje();
		assertThat(mensaje).contains(EMOJI.repeat(60)).doesNotContain(EMOJI.repeat(61));
		assertThat(sinSustitutosSueltos(mensaje)).isTrue();
	}

	@Test
	void invitar_elNombreDelClubQueTerminaEnElLimiteConUnEmoji_noDejaUnSustitutoSuelto() throws Exception {
		jdbc.update("update club set nombre = ? where id = ?", "X".repeat(59) + EMOJI + "cola", club.getId());
		refrescar();
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());

		String mensaje = notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA).get(0).getMensaje();
		assertThat(mensaje).contains("X".repeat(59) + EMOJI + " te invita").doesNotContain("cola");
		assertThat(sinSustitutosSueltos(mensaje)).isTrue();
	}

	private static boolean sinSustitutosSueltos(String texto) {
		for (int i = 0; i < texto.length(); i++) {
			char c = texto.charAt(i);
			if (Character.isHighSurrogate(c)) {
				if (i + 1 >= texto.length() || !Character.isLowSurrogate(texto.charAt(i + 1))) {
					return false;
				}
				i++;
			} else if (Character.isLowSurrogate(c)) {
				return false;
			}
		}
		return true;
	}

	@Test
	void invitar_cancelarYVolverAInvitar_noRepiteElAvisoMientrasNoSeLea() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		for (int i = 0; i < 3; i++) {
			cancelar(admin, club.getId(), invitacionDe(club.getId(), "otro@vibora.com")).andExpect(status().isNoContent());
			invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		}

		assertThat(filas("club_id = ? and estado = 'PENDIENTE'", club.getId())).isEqualTo(1);
		assertThat(filas("club_id = ?", club.getId())).isEqualTo(4); // las filas si se crean: los topes las cuentan
		assertThat(notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA)).hasSize(1);
	}

	@Test
	void invitar_elAvisoSiSeRepiteSiYaSeLeyoOSiPasaronMasDe24h_yNoSeMezclanLosMensajes() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		cancelar(admin, club.getId(), invitacionDe(club.getId(), "otro@vibora.com")).andExpect(status().isNoContent());
		jdbc.update("update notificacion set leida = true"); // ya la leyo
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		assertThat(notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA)).hasSize(2);

		// mensaje distinto (otro rol) = aviso distinto, aunque haya uno sin leer
		cancelar(admin, club.getId(), invitacionDe(club.getId(), "otro@vibora.com")).andExpect(status().isNoContent());
		invitar(admin, club.getId(), "otro@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());
		assertThat(notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA)).hasSize(3);

		// pasadas 24 h, aunque siga sin leer, vuelve a avisar
		cancelar(admin, club.getId(), invitacionDe(club.getId(), "otro@vibora.com")).andExpect(status().isNoContent());
		avanzar(Duration.ofHours(24).plusSeconds(1));
		invitar(admin, club.getId(), "otro@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());
		assertThat(notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA)).hasSize(4);
	}

	@Test
	void invitar_duplicadaMientrasPendiente_noCreaFilaNiAvisoNuevo_yConservaLaFecha() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		Instant caducaAntes = jdbc.queryForObject("select caduca_en from invitacion_personal", Instant.class);
		avanzar(Duration.ofDays(1));

		invitar(admin, club.getId(), "otro@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());

		assertThat(filas("1 = 1")).isEqualTo(1);
		assertThat(jdbc.queryForObject("select caduca_en from invitacion_personal", Instant.class)).isEqualTo(caducaAntes);
		assertThat(jdbc.queryForObject("select rol from invitacion_personal", String.class)).isEqualTo("MONITOR");
		assertThat(notifsDe(otro, TipoNotificacion.INVITACION_RECIBIDA)).hasSize(1);
	}

	@Test
	void invitar_pendienteCaducada_seMarcaCaducadaYSeCreaUnaNueva_con14Dias() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long vieja = invitacionDe(club.getId(), "otro@vibora.com");
		avanzar(Duration.ofDays(14)); // justo en caduca_en: ya caducada

		invitar(admin, club.getId(), "otro@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());

		assertThat(estadoDe(vieja)).isEqualTo("CADUCADA");
		long nueva = invitacionDe(club.getId(), "otro@vibora.com");
		assertThat(nueva).isNotEqualTo(vieja);
		assertThat(estadoDe(nueva)).isEqualTo("PENDIENTE");
		assertThat(jdbc.queryForObject("select caduca_en - creada_en from invitacion_personal where id = ?", String.class, nueva))
				.isEqualTo("14 days");
		// un dia antes de caducar NO se renueva
		avanzar(Duration.ofDays(13));
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		assertThat(invitacionDe(club.getId(), "otro@vibora.com")).isEqualTo(nueva);
	}

	@Test
	void invitar_payloadInvalido400_yPermisos() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "ADMIN_CLUB").andExpect(status().isBadRequest());
		invitar(admin, club.getId(), "otro@vibora.com", "JUGADOR").andExpect(status().isBadRequest());
		invitar(admin, club.getId(), "otro@vibora.com", null).andExpect(status().isBadRequest());
		invitar(admin, club.getId(), "no-es-un-email", "MONITOR").andExpect(status().isBadRequest());
		invitar(admin, club.getId(), null, "MONITOR").andExpect(status().isBadRequest());
		invitar(admin, club.getId(), "a".repeat(250) + "@x.com", "MONITOR").andExpect(status().isBadRequest());
		for (Persona p : List.of(monitor, mant1, jugador, otro, adminB)) {
			invitar(p, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isForbidden());
		}
		mvc.perform(post("/api/clubes/" + club.getId() + "/invitaciones").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"otro@vibora.com\",\"rol\":\"MONITOR\"}")).andExpect(status().isUnauthorized());
		invitar(admin, 999_999L, "otro@vibora.com", "MONITOR").andExpect(status().isNotFound());
		assertThat(filas("1 = 1")).isZero();
	}

	// ---- invitar: topes ----

	@Test
	void invitar_tope24h_la31Es429_yJustoAlCumplirse24hVuelveAPoderse() throws Exception {
		for (int i = 1; i <= 30; i++) {
			invitar(admin, club.getId(), "inv" + i + "@vibora.com", "MONITOR").andExpect(status().isAccepted());
		}
		invitar(admin, club.getId(), "inv31@vibora.com", "MONITOR").andExpect(status().isTooManyRequests());
		// repetir una YA pendiente no crea nada: sigue siendo la respuesta uniforme
		invitar(admin, club.getId(), "inv1@vibora.com", "MONITOR").andExpect(status().isAccepted());
		assertThat(filas("1 = 1")).isEqualTo(30);

		avanzar(Duration.ofHours(24).minusSeconds(1));
		invitar(admin, club.getId(), "inv31@vibora.com", "MONITOR").andExpect(status().isTooManyRequests());
		avanzar(Duration.ofSeconds(1)); // las 30 se crearon hace EXACTAMENTE 24 h: ya no cuentan
		invitar(admin, club.getId(), "inv31@vibora.com", "MONITOR").andExpect(status().isAccepted());
		assertThat(filas("1 = 1")).isEqualTo(31);
	}

	@Test
	void invitar_topePendientes_la51Es429_ElTopeEsPorClub() throws Exception {
		for (int i = 1; i <= 30; i++) {
			invitar(admin, club.getId(), "inv" + i + "@vibora.com", "MONITOR").andExpect(status().isAccepted());
		}
		avanzar(Duration.ofDays(2));
		for (int i = 31; i <= 50; i++) {
			invitar(admin, club.getId(), "inv" + i + "@vibora.com", "MONITOR").andExpect(status().isAccepted());
		}
		invitar(admin, club.getId(), "inv51@vibora.com", "MONITOR").andExpect(status().isTooManyRequests());
		invitar(admin, club.getId(), "inv50@vibora.com", "MONITOR").andExpect(status().isAccepted()); // duplicada
		// otro club no se ve afectado
		invitar(adminB, clubB.getId(), "inv51@vibora.com", "MONITOR").andExpect(status().isAccepted());
		// una caducada libera sitio: a los 14 dias de las 30 primeras solo quedan 20 pendientes
		avanzar(Duration.ofDays(12));
		invitar(admin, club.getId(), "inv51@vibora.com", "MONITOR").andExpect(status().isAccepted());
	}

	// ---- listar y cancelar (administrador) ----

	@Test
	void listar_masRecientesPrimero_conCaducadasDerivadas_yFiltroPorEstado() throws Exception {
		invitar(admin, club.getId(), "a@vibora.com", "MONITOR").andExpect(status().isAccepted());
		avanzar(Duration.ofDays(10));
		invitar(admin, club.getId(), "b@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());
		avanzar(Duration.ofDays(5)); // a caducada (sin barrido), b viva

		listarInv(admin, club.getId(), null)
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(2))
				.andExpect(jsonPath("$[0].email").value("b@vibora.com"))
				.andExpect(jsonPath("$[0].rol").value("MANTENIMIENTO"))
				.andExpect(jsonPath("$[0].estado").value("PENDIENTE"))
				.andExpect(jsonPath("$[0].creadaEn").exists())
				.andExpect(jsonPath("$[0].caducaEn").exists())
				.andExpect(jsonPath("$[0].resueltaEn").doesNotExist())
				.andExpect(jsonPath("$[1].email").value("a@vibora.com"))
				.andExpect(jsonPath("$[1].estado").value("CADUCADA"));
		listarInv(admin, club.getId(), "PENDIENTE").andExpect(jsonPath("$.length()").value(1))
				.andExpect(jsonPath("$[0].email").value("b@vibora.com"));
		listarInv(admin, club.getId(), "CADUCADA").andExpect(jsonPath("$.length()").value(1))
				.andExpect(jsonPath("$[0].email").value("a@vibora.com"));
		listarInv(admin, club.getId(), "RARA").andExpect(status().isBadRequest());
		listarInv(adminB, clubB.getId(), null).andExpect(jsonPath("$.length()").value(0)); // no ve las de otro club
	}

	@Test
	void listar_estaAcotadoA100_yPermisos() throws Exception {
		for (int i = 0; i < 120; i++) {
			jdbc.update("insert into invitacion_personal (club_id, email, rol, estado, invitado_por, creada_en, caduca_en, resuelta_en) "
					+ "values (?, ?, 'MONITOR', 'RECHAZADA', ?, ?::timestamptz + (? * interval '1 minute'), ?::timestamptz + interval '14 days', ?::timestamptz)",
					club.getId(), "r" + i + "@vibora.com", admin.id(), "2029-12-01T00:00:00Z", i, "2029-12-01T00:00:00Z",
					"2029-12-02T00:00:00Z");
		}
		listarInv(admin, club.getId(), null).andExpect(jsonPath("$.length()").value(100));
		for (Persona p : List.of(monitor, mant1, jugador, adminB)) {
			listarInv(p, club.getId(), null).andExpect(status().isForbidden());
		}
		mvc.perform(get("/api/clubes/" + club.getId() + "/invitaciones")).andExpect(status().isUnauthorized());
		listarInv(admin, 999_999L, null).andExpect(status().isNotFound());
	}

	@Test
	void cancelar_pendiente204_idempotente_otrosEstados409_otroClub404_permisos() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "otro@vibora.com");
		for (Persona p : List.of(monitor, mant1, jugador, adminB)) {
			cancelar(p, club.getId(), id).andExpect(status().isForbidden());
		}
		cancelar(adminB, clubB.getId(), id).andExpect(status().isNotFound()); // el id es de otro club
		mvc.perform(delete("/api/clubes/" + club.getId() + "/invitaciones/" + id)).andExpect(status().isUnauthorized());

		cancelar(admin, club.getId(), id).andExpect(status().isNoContent());
		assertThat(estadoDe(id)).isEqualTo("CANCELADA");
		assertThat(jdbc.queryForObject("select resuelta_en is not null from invitacion_personal where id = ?", Boolean.class, id)).isTrue();
		cancelar(admin, club.getId(), id).andExpect(status().isNoContent()); // idempotente
		cancelar(admin, club.getId(), 999_999L).andExpect(status().isNotFound());

		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long nueva = invitacionDe(club.getId(), "otro@vibora.com");
		aceptar(otro, nueva).andExpect(status().isOk());
		cancelar(admin, club.getId(), nueva).andExpect(status().isConflict()); // ya aceptada
		assertThat(estadoDe(nueva)).isEqualTo("ACEPTADA");
	}

	@Test
	void cancelarYLuegoAceptar_409() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "otro@vibora.com");
		cancelar(admin, club.getId(), id).andExpect(status().isNoContent());

		aceptar(otro, id).andExpect(status().isConflict());
		rechazar(otro, id).andExpect(status().isConflict());
		assertThat(usuarios.findById(otro.id()).orElseThrow().getRol()).isEqualTo(Rol.JUGADOR);
	}

	// ---- el invitado ----

	@Test
	void mias_soloLasPendientesNoCaducadasDirigidasAMiCorreo() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		invitar(adminB, clubB.getId(), "otro@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());
		invitar(admin, club.getId(), "jugador@vibora.com", "MONITOR").andExpect(status().isAccepted());
		avanzar(Duration.ofDays(13));
		invitar(admin, club.getId(), "nueva@vibora.com", "MONITOR").andExpect(status().isAccepted());

		mias(otro).andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(2))
				.andExpect(jsonPath("$[*].clubNombre").value(org.hamcrest.Matchers.containsInAnyOrder("Club A", "Club B")))
				.andExpect(jsonPath("$[0].id").exists()).andExpect(jsonPath("$[0].rol").exists())
				.andExpect(jsonPath("$[0].invitadoPor").exists()).andExpect(jsonPath("$[0].caducaEn").exists());
		mias(jugador).andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].invitadoPor").value("Alba Admin"));
		avanzar(Duration.ofDays(2)); // las dos primeras ya caducaron
		mias(otro).andExpect(jsonPath("$.length()").value(0));
		mvc.perform(get("/api/invitaciones/mias")).andExpect(status().isUnauthorized());
	}

	@Test
	void aceptar_cambiaRolYClub_noTocaLasDeOtrosClubes_avisaAlosAdministradores_yPideNuevoLogin() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		invitar(adminB, clubB.getId(), "otro@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "otro@vibora.com");
		long deB = invitacionDe(clubB.getId(), "otro@vibora.com");

		aceptar(otro, id).andExpect(status().isOk())
				.andExpect(jsonPath("$.requiereNuevoLogin").value(true))
				.andExpect(jsonPath("$.clubNombre").value("Club A"))
				.andExpect(jsonPath("$.rol").value("MONITOR"));

		refrescar();
		var u = usuarios.findById(otro.id()).orElseThrow();
		assertThat(u.getRol()).isEqualTo(Rol.MONITOR);
		assertThat(u.getClub().getId()).isEqualTo(club.getId());
		assertThat(estadoDe(id)).isEqualTo("ACEPTADA");
		assertThat(jdbc.queryForObject("select usuario_id from invitacion_personal where id = ?", Long.class, id)).isEqualTo(otro.id());
		assertThat(jdbc.queryForObject("select resuelta_en from invitacion_personal where id = ?", Instant.class, id))
				.isEqualTo(reloj.instant());
		assertThat(estadoDe(deB)).isEqualTo("PENDIENTE"); // la del otro club sigue como estaba: nadie la cancelo
		assertThat(notifsDe(admin, TipoNotificacion.INVITACION_ACEPTADA)).singleElement()
				.satisfies(n -> assertThat(n.getMensaje()).contains("Olga Otra").contains("Club A"));
		assertThat(notifsDe(adminB, TipoNotificacion.INVITACION_ACEPTADA)).isEmpty();
		// el token sigue diciendo JUGADOR; ya es personal segun la BD y un login nuevo trae el rol nuevo
		assertThat(PersonalControllerTests.rolDelToken(otro.token())).isEqualTo("JUGADOR");
		assertThat(PersonalControllerTests.rolDelToken(bearer("otro@vibora.com"))).isEqualTo("MONITOR");
		mias(otro).andExpect(jsonPath("$.length()").value(0));
	}

	@Test
	void aceptar_noRevelaAlOtroClubQueElCorreoEstaRegistradoNiQueSeUnio() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		invitar(adminB, clubB.getId(), "otro@vibora.com", "MANTENIMIENTO").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "otro@vibora.com");
		long deB = invitacionDe(clubB.getId(), "otro@vibora.com");
		String antes = listarInv(adminB, clubB.getId(), null).andExpect(status().isOk()).andReturn().getResponse()
				.getContentAsString();

		aceptar(otro, id).andExpect(status().isOk());

		String despues = listarInv(adminB, clubB.getId(), null).andReturn().getResponse().getContentAsString();
		assertThat(despues).isEqualTo(antes);
		assertThat(estadoDe(deB)).isEqualTo("PENDIENTE");
		assertThat(jdbc.queryForObject("select resuelta_en is null and usuario_id is null from invitacion_personal where id = ?",
				Boolean.class, deB)).isTrue();
		assertThat(notifsDe(adminB, null)).isEmpty();
		// ya no puede aceptar nada: no ve invitaciones y la de B sigue dando 409 sin cambiar el club
		mias(otro).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
		aceptar(otro, deB).andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("Ya perteneces a un club"));
		assertThat(estadoDe(deB)).isEqualTo("PENDIENTE");
		assertThat(usuarios.findById(otro.id()).orElseThrow().getClub().getId()).isEqualTo(club.getId());
	}

	@Test
	void mias_estaVaciaMientrasLaPersonaYaPerteneceAUnClub_aunqueTengaPendientes() throws Exception {
		invitar(admin, club.getId(), "mantb@vibora.com", "MONITOR").andExpect(status().isAccepted());
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());

		mias(mantB).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0)); // personal de B
		mias(adminB).andExpect(jsonPath("$.length()").value(0)); // administrador
		mias(otro).andExpect(jsonPath("$.length()").value(1)); // jugador sin club: sigue viendola
	}

	@Test
	void aceptar_idorYNoDestinatario_404_sinDetalle() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "otro@vibora.com");

		for (Persona p : List.of(jugador, monitor, adminB, admin)) {
			aceptar(p, id).andExpect(status().isNotFound());
			rechazar(p, id).andExpect(status().isNotFound());
		}
		aceptar(otro, 999_999L).andExpect(status().isNotFound());
		rechazar(otro, 999_999L).andExpect(status().isNotFound());
		mvc.perform(post("/api/invitaciones/" + id + "/aceptar")).andExpect(status().isUnauthorized());
		assertThat(estadoDe(id)).isEqualTo("PENDIENTE");
		assertThat(usuarios.findById(jugador.id()).orElseThrow().getClub()).isNull();
	}

	@Test
	void aceptar_caducada409_yEnElLimiteExacto() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "otro@vibora.com");
		avanzar(Duration.ofDays(14).minusSeconds(1));
		mias(otro).andExpect(jsonPath("$.length()").value(1));
		avanzar(Duration.ofSeconds(1));

		aceptar(otro, id).andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("La invitación ha caducado"));
		rechazar(otro, id).andExpect(status().isConflict());
		assertThat(usuarios.findById(otro.id()).orElseThrow().getRol()).isEqualTo(Rol.JUGADOR);
	}

	@Test
	void aceptar_quienYaTieneClub409_yNoCambiaNada() throws Exception {
		invitar(admin, club.getId(), "mantb@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "mantb@vibora.com");

		aceptar(mantB, id).andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("Ya perteneces a un club"));

		assertThat(usuarios.findById(mantB.id()).orElseThrow().getClub().getId()).isEqualTo(clubB.getId());
		assertThat(estadoDe(id)).isEqualTo("PENDIENTE");
	}

	@Test
	void aceptarDosVeces409_yUnaRechazadaNoSePuedeAceptar() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "otro@vibora.com");
		aceptar(otro, id).andExpect(status().isOk());
		aceptar(otro, id).andExpect(status().isConflict());

		invitar(adminB, clubB.getId(), "jugador@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long idB = invitacionDe(clubB.getId(), "jugador@vibora.com");
		rechazar(jugador, idB).andExpect(status().isNoContent());
		aceptar(jugador, idB).andExpect(status().isConflict());
		rechazar(jugador, idB).andExpect(status().isConflict());
	}

	@Test
	void rechazar_marcaRechazada_avisaALosAdministradores_ySePuedeVolverAInvitar() throws Exception {
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		long id = invitacionDe(club.getId(), "otro@vibora.com");

		rechazar(otro, id).andExpect(status().isNoContent());

		assertThat(estadoDe(id)).isEqualTo("RECHAZADA");
		assertThat(jdbc.queryForObject("select usuario_id from invitacion_personal where id = ?", Long.class, id)).isEqualTo(otro.id());
		assertThat(usuarios.findById(otro.id()).orElseThrow().getRol()).isEqualTo(Rol.JUGADOR);
		assertThat(notifsDe(admin, TipoNotificacion.INVITACION_RECHAZADA)).singleElement()
				.satisfies(n -> assertThat(n.getMensaje()).contains("Olga Otra").contains("Club A"));
		mias(otro).andExpect(jsonPath("$.length()").value(0));
		invitar(admin, club.getId(), "otro@vibora.com", "MONITOR").andExpect(status().isAccepted());
		assertThat(filas("estado = 'PENDIENTE'")).isEqualTo(1);
	}

	// (el aviso al registrarse se crea tras el commit del registro: se prueba con commits reales en RegistroAvisoInvitacionTests)

	// ---- el alta nueva funciona de extremo a extremo ----

	@Test
	void ciclo_invitarAceptarYSalirYVolverAEntrar() throws Exception {
		Persona nueva = anadirPersonal(admin, club, otro, "MANTENIMIENTO");
		assertThat(nueva.usuario().getRol()).isEqualTo(Rol.MANTENIMIENTO);
		mvc.perform(post("/api/personal/salir").header("Authorization", nueva.token())).andExpect(status().isNoContent());
		Persona otraVez = anadirPersonal(adminB, clubB, nueva, "MONITOR");
		assertThat(otraVez.usuario().getClub().getId()).isEqualTo(clubB.getId());
	}
}
