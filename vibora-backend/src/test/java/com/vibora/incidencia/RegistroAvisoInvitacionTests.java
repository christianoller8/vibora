package com.vibora.incidencia;

import com.vibora.TestData;
import com.vibora.club.Club;
import com.vibora.notificacion.NotificacionRepository;
import com.vibora.notificacion.TipoNotificacion;
import com.vibora.usuario.Rol;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * El aviso de "tenias invitaciones pendientes" que se crea al registrarse es un extra: si falla, el registro sigue
 * siendo un 201 y el fallo no se confunde con "el email ya esta registrado". Commits reales (sin transaccion de test):
 * el fallo atraviesa los limites transaccionales de verdad, que es lo que marca la transaccion como solo-rollback.
 */
class RegistroAvisoInvitacionTests extends IncidenciaSinTransaccionBase {

	@MockitoSpyBean NotificacionRepository notificacionesEspia;

	@AfterEach
	void soltarEspia() {
		reset(notificacionesEspia);
	}

	private MvcResult registrar(String email) throws Exception {
		return mvc.perform(post("/api/auth/registro").contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"%s\",\"password\":\"contraseña-segura\",\"nombre\":\"Nuevo\",\"apellidos\":\"Nuevo\"}"
						.formatted(email)))
				.andReturn();
	}

	private void invitarAlNuevo() throws Exception {
		assertThat(mvc.perform(post("/api/clubes/" + club.getId() + "/invitaciones")
				.header("Authorization", admin.token()).contentType(MediaType.APPLICATION_JSON)
				.content("{\"email\":\"nuevo@vibora.com\",\"rol\":\"MONITOR\"}")).andReturn().getResponse().getStatus())
				.isEqualTo(202);
	}

	@Test
	void unFalloAlCrearElAviso_noRompeElRegistro() throws Exception {
		invitarAlNuevo();
		doThrow(new IllegalStateException("fallo simulado")).when(notificacionesEspia).save(any());

		MvcResult r = registrar("nuevo@vibora.com");

		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
		assertThat(usuarios.findByEmail("nuevo@vibora.com")).isPresent();
		assertThat(notificaciones.count()).isZero();
	}

	@Test
	void unFalloDeIntegridadAlCrearElAviso_noSeInformaComoEmailDuplicado() throws Exception {
		invitarAlNuevo();
		doThrow(new DataIntegrityViolationException("fallo simulado")).when(notificacionesEspia).save(any());

		MvcResult r = registrar("nuevo@vibora.com");

		assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(201);
		assertThat(r.getResponse().getContentAsString()).doesNotContain("ya está registrado");
		assertThat(usuarios.findByEmail("nuevo@vibora.com")).isPresent();
	}

	@Test
	void sinFallos_elAvisoSigueCreandose_yUnEmailRepetidoSigueSiendo409() throws Exception {
		invitarAlNuevo();

		assertThat(registrar("nuevo@vibora.com").getResponse().getStatus()).isEqualTo(201);
		assertThat(notificaciones.count()).isEqualTo(1);
		MvcResult repetido = registrar("NUEVO@vibora.com");
		assertThat(repetido.getResponse().getStatus()).isEqualTo(409);
		assertThat(repetido.getResponse().getContentAsString()).contains("El email ya está registrado");
		assertThat(notificaciones.count()).isEqualTo(1);
	}

	@Test
	void registrarseConInvitacionesPendientes_creaUnAvisoResumen_sinCambiarLaRespuesta() throws Exception {
		Club b = TestData.club();
		b.setNombre("Club B");
		b = clubs.saveAndFlush(b);
		Persona adminB = persona("adminb@vibora.com", Rol.ADMIN_CLUB, b);
		invitarAlNuevo();
		assertThat(mvc.perform(post("/api/clubes/" + b.getId() + "/invitaciones").header("Authorization", adminB.token())
				.contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"nuevo@vibora.com\",\"rol\":\"MANTENIMIENTO\"}"))
				.andReturn().getResponse().getStatus()).isEqualTo(202);

		MvcResult r = registrar("Nuevo@Vibora.com");

		assertThat(r.getResponse().getStatus()).isEqualTo(201);
		assertThat(r.getResponse().getContentAsString()).doesNotContain("invitaci");
		var nuevo = usuarios.findByEmail("nuevo@vibora.com").orElseThrow();
		var avisos = notificaciones.findAll().stream().filter(n -> n.getUsuario().getId().equals(nuevo.getId())).toList();
		assertThat(avisos).singleElement().satisfies(n -> {
			assertThat(n.getTipo()).isEqualTo(TipoNotificacion.INVITACION_RECIBIDA);
			assertThat(n.getMensaje()).contains("2 invitaciones");
		});
	}

	@Test
	void registrarse_sinInvitacionesOSoloCaducadas_noCreaAviso() throws Exception {
		jdbc.update("insert into invitacion_personal (club_id, email, rol, invitado_por, creada_en, caduca_en) "
				+ "values (?, 'viejo@vibora.com', 'MONITOR', ?, now() - interval '20 days', now() - interval '6 days')",
				club.getId(), admin.id());

		assertThat(registrar("viejo@vibora.com").getResponse().getStatus()).isEqualTo(201);
		assertThat(registrar("sin@vibora.com").getResponse().getStatus()).isEqualTo(201);

		assertThat(notificaciones.count()).isZero();
	}
}
