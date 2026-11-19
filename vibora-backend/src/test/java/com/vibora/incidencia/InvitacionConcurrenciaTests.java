package com.vibora.incidencia;

import com.vibora.TestData;
import com.vibora.club.Club;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.auth.AutorizacionClub;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.reset;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Concurrencia REAL de las invitaciones (commits de verdad, una conexion por peticion). Garantias:
 * <ul>
 * <li>aceptar bloquea la fila del usuario y despues la de la invitacion, y decide con todo releido;</li>
 * <li>invitar serializa por club (bloqueo consultivo) y se apoya en el indice unico parcial: una sola viva por correo;</li>
 * <li>los topes se cuentan bajo ese mismo bloqueo: nunca se sobrepasan.</li>
 * </ul>
 */
class InvitacionConcurrenciaTests extends IncidenciaSinTransaccionBase {

	@MockitoSpyBean AutorizacionClub autorizacionEspiada;

	private static long cuantos(List<Integer> estados, int codigo) {
		return estados.stream().filter(s -> s == codigo).count();
	}

	private int invitar(Persona actor, Club c, String email, String rol) throws Exception {
		return mvc.perform(post("/api/clubes/" + c.getId() + "/invitaciones").header("Authorization", actor.token())
				.contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"%s\",\"rol\":\"%s\"}".formatted(email, rol)))
				.andReturn().getResponse().getStatus();
	}

	private int aceptar(Persona p, long id) throws Exception {
		return mvc.perform(post("/api/invitaciones/" + id + "/aceptar").header("Authorization", p.token()))
				.andReturn().getResponse().getStatus();
	}

	private int cancelar(Persona actor, Club c, long id) throws Exception {
		return mvc.perform(delete("/api/clubes/" + c.getId() + "/invitaciones/" + id).header("Authorization", actor.token()))
				.andReturn().getResponse().getStatus();
	}

	private long invitacionDe(Club c, String email) {
		return jdbc.queryForObject("select max(id) from invitacion_personal where club_id = ? and email = ?", Long.class,
				c.getId(), email);
	}

	private String estadoDe(long id) {
		return jdbc.queryForObject("select estado from invitacion_personal where id = ?", String.class, id);
	}

	private int salir(Persona p) throws Exception {
		return mvc.perform(post("/api/personal/salir").header("Authorization", p.token())).andReturn().getResponse().getStatus();
	}

	private int retirar(Persona actor, Persona p) throws Exception {
		return mvc.perform(delete("/api/clubes/" + club.getId() + "/personal/" + p.id()).header("Authorization", actor.token()))
				.andReturn().getResponse().getStatus();
	}

	private int crearClub(Persona p) throws Exception {
		return mvc.perform(post("/api/clubes").header("Authorization", p.token()).contentType(MediaType.APPLICATION_JSON)
				.content("{\"nombre\":\"Club Nuevo\",\"horaApertura\":\"08:00\",\"horaCierre\":\"22:00\"}"))
				.andReturn().getResponse().getStatus();
	}

	/**
	 * Alarga la ventana de la carrera: quien acepta se detiene {@code ms} justo despues de leer al usuario (la lectura
	 * real ya hecha) y antes de decidir y escribir. Devuelve un cierre que se abre cuando alguien ya esta ahi.
	 */
	private CountDownLatch ventanaDeDecision(long ms) {
		CountDownLatch decidiendo = new CountDownLatch(1);
		doAnswer(inv -> {
			Object usuario = inv.callRealMethod();
			boolean enAceptar = Arrays.stream(Thread.currentThread().getStackTrace())
					.anyMatch(f -> f.getClassName().endsWith(".InvitacionService") && f.getMethodName().equals("aceptar"));
			if (enAceptar) {
				decidiendo.countDown();
				Thread.sleep(ms);
			}
			return usuario;
		}).when(autorizacionEspiada).usuarioActual();
		return decidiendo;
	}

	@AfterEach
	void soltarEspia() {
		reset(autorizacionEspiada);
	}

	private Usuario enBd(Persona p) {
		return usuarios.findById(p.id()).orElseThrow();
	}

	private Club crearClubB() {
		Club b = TestData.club();
		b.setNombre("Club B");
		return clubs.saveAndFlush(b);
	}

	@RepeatedTest(3)
	void ochoAceptacionesSimultaneasDeLaMismaInvitacion_exactamenteUnaGana() throws Exception {
		assertThat(invitar(admin, club, "jugador@vibora.com", "MONITOR")).isEqualTo(202);
		long id = invitacionDe(club, "jugador@vibora.com");

		List<Callable<Integer>> tareas = new ArrayList<>();
		for (int i = 0; i < 8; i++) {
			tareas.add(() -> aceptar(jugador, id));
		}
		List<Integer> estados = lanzarALaVez(tareas);

		assertThat(cuantos(estados, 200)).as("200: %s", estados).isEqualTo(1);
		assertThat(cuantos(estados, 409)).as("409: %s", estados).isEqualTo(7);
		Usuario u = enBd(jugador);
		assertThat(u.getRol()).isEqualTo(Rol.MONITOR);
		assertThat(u.getClub().getId()).isEqualTo(club.getId());
		assertThat(estadoDe(id)).isEqualTo("ACEPTADA");
		assertThat(avisos("INVITACION_ACEPTADA")).isEqualTo(2); // un aviso por administrador (admin y admin2), una sola vez
	}

	@RepeatedTest(3)
	void laMismaPersonaAceptaInvitacionesDeDosClubesAlaVez_soloUnaPasa() throws Exception {
		Club b = crearClubB();
		Persona adminB = persona("adminb@vibora.com", Rol.ADMIN_CLUB, b);
		assertThat(invitar(admin, club, "jugador@vibora.com", "MONITOR")).isEqualTo(202);
		assertThat(invitar(adminB, b, "jugador@vibora.com", "MANTENIMIENTO")).isEqualTo(202);
		long deA = invitacionDe(club, "jugador@vibora.com");
		long deB = invitacionDe(b, "jugador@vibora.com");
		ventanaDeDecision(300); // las dos leen "jugador sin club" antes de que ninguna escriba

		List<Integer> estados = lanzarALaVez(List.<Callable<Integer>>of(() -> aceptar(jugador, deA), () -> aceptar(jugador, deB)));

		assertThat(cuantos(estados, 200)).as("200: %s", estados).isEqualTo(1);
		assertThat(cuantos(estados, 409)).as("409: %s", estados).isEqualTo(1);
		Usuario u = enBd(jugador);
		Long ganadorClub = u.getClub().getId();
		assertThat(ganadorClub).isIn(club.getId(), b.getId());
		assertThat(u.getRol()).isEqualTo(ganadorClub.equals(club.getId()) ? Rol.MONITOR : Rol.MANTENIMIENTO);
		// la que pierde NO se toca (no se cancela: el otro club no debe enterarse de nada) y sigue dando 409
		assertThat(List.of(estadoDe(deA), estadoDe(deB))).containsExactlyInAnyOrder("ACEPTADA", "PENDIENTE");
		assertThat(estadoDe(ganadorClub.equals(club.getId()) ? deA : deB)).isEqualTo("ACEPTADA");
	}

	// ---- el bloqueo del usuario en aceptar: Usuario no tiene @Version y Hibernate escribe la fila entera ----

	@RepeatedTest(3)
	void aceptarContraCrearClubDelMismoUsuario_ventanaForzada_unaSolaGana_yNadaQuedaMezclado() throws Exception {
		assertThat(invitar(admin, club, "jugador@vibora.com", "MONITOR")).isEqualTo(202);
		long id = invitacionDe(club, "jugador@vibora.com");
		CountDownLatch decidiendo = ventanaDeDecision(400);

		// crear el club arranca cuando aceptar ya ha leido al usuario y todavia no ha escrito
		List<Integer> estados = lanzarALaVez(List.<Callable<Integer>>of(() -> aceptar(jugador, id), () -> {
			assertThat(decidiendo.await(10, TimeUnit.SECONDS)).isTrue();
			return crearClub(jugador);
		}));

		comprobarAceptarContraCrear(estados, id);
	}

	@RepeatedTest(3)
	void aceptarContraCrearClubDelMismoUsuario_salidaSimultanea_unaSolaGana_yNadaQuedaMezclado() throws Exception {
		assertThat(invitar(admin, club, "jugador@vibora.com", "MONITOR")).isEqualTo(202);
		long id = invitacionDe(club, "jugador@vibora.com");
		ventanaDeDecision(150);

		List<Integer> estados = lanzarALaVez(List.<Callable<Integer>>of(() -> aceptar(jugador, id), () -> crearClub(jugador)));

		comprobarAceptarContraCrear(estados, id);
	}

	private void comprobarAceptarContraCrear(List<Integer> estados, long invitacion) {
		assertThat(estados).as("estados (aceptar, crear club): %s", estados).isIn(List.of(200, 409), List.of(409, 201));
		Usuario u = enBd(jugador);
		if (estados.get(0) == 200) {
			assertThat(u.getRol()).isEqualTo(Rol.MONITOR);
			assertThat(u.getClub().getId()).isEqualTo(club.getId());
			assertThat(estadoDe(invitacion)).isEqualTo("ACEPTADA");
			assertThat(jdbc.queryForObject("select count(*) from club where nombre = 'Club Nuevo'", Long.class)).isZero();
		} else {
			assertThat(u.getRol()).isEqualTo(Rol.ADMIN_CLUB);
			assertThat(jdbc.queryForObject("select nombre from club where id = ?", String.class, u.getClub().getId()))
					.isEqualTo("Club Nuevo");
			assertThat(estadoDe(invitacion)).isEqualTo("PENDIENTE");
		}
		assertThat(jdbc.queryForObject("select count(*) from club c where not exists "
				+ "(select 1 from usuario x where x.club_id = c.id and x.rol = 'ADMIN_CLUB')", Long.class))
				.as("ningun club sin administrador").isZero();
	}

	@RepeatedTest(3)
	void aceptarContraSalirDeLaMismaPersona_estadoFinalCoherente_ySin500() throws Exception {
		Club b = crearClubB();
		Persona adminB = persona("adminb@vibora.com", Rol.ADMIN_CLUB, b);
		assertThat(invitar(adminB, b, "mant1@vibora.com", "MONITOR")).isEqualTo(202); // mant1 es personal del club A
		long id = invitacionDe(b, "mant1@vibora.com");
		ventanaDeDecision(300);

		List<Integer> estados = lanzarALaVez(List.<Callable<Integer>>of(() -> aceptar(mant1, id), () -> salir(mant1)));

		assertThat(estados).as("estados (aceptar, salir): %s", estados).isIn(List.of(200, 204), List.of(409, 204));
		Usuario u = enBd(mant1);
		if (estados.get(0) == 200) { // salio primero y despues acepto
			assertThat(u.getRol()).isEqualTo(Rol.MONITOR);
			assertThat(u.getClub().getId()).isEqualTo(b.getId());
			assertThat(estadoDe(id)).isEqualTo("ACEPTADA");
		} else { // acepto primero (409: aun era personal de A) y despues salio
			assertThat(u.getRol()).isEqualTo(Rol.JUGADOR);
			assertThat(u.getClub()).isNull();
			assertThat(estadoDe(id)).isEqualTo("PENDIENTE");
		}
	}

	@RepeatedTest(3)
	void aceptarContraLaRetiradaDelAdministradorDeLaMismaPersona_estadoFinalCoherente_ySin500() throws Exception {
		assertThat(invitar(admin, club, "jugador@vibora.com", "MONITOR")).isEqualTo(202);
		long id = invitacionDe(club, "jugador@vibora.com");
		ventanaDeDecision(300);

		List<Integer> estados = lanzarALaVez(List.<Callable<Integer>>of(() -> aceptar(jugador, id), () -> retirar(admin2, jugador)));

		assertThat(estados).as("estados (aceptar, retirar): %s", estados).isIn(List.of(200, 204), List.of(200, 404));
		Usuario u = enBd(jugador);
		assertThat(estadoDe(id)).isEqualTo("ACEPTADA");
		if (estados.get(1) == 204) { // aceptada y retirada despues
			assertThat(u.getRol()).isEqualTo(Rol.JUGADOR);
			assertThat(u.getClub()).isNull();
		} else { // la retirada llego antes de que fuera personal: 404 y despues acepto
			assertThat(u.getRol()).isEqualTo(Rol.MONITOR);
			assertThat(u.getClub().getId()).isEqualTo(club.getId());
		}
	}

	@RepeatedTest(3)
	void dosSalidasSimultaneasDeLaMismaPersona_unaSolaHaceEfecto_yAvisaUnaVezACadaAdministrador() throws Exception {
		List<Integer> estados = lanzarALaVez(List.<Callable<Integer>>of(() -> salir(mant1), () -> salir(mant1)));

		assertThat(estados).as("estados: %s", estados).containsExactlyInAnyOrder(204, 409);
		Usuario u = enBd(mant1);
		assertThat(u.getRol()).isEqualTo(Rol.JUGADOR);
		assertThat(u.getClub()).isNull();
		assertThat(avisos("PERSONAL_QUITADO")).isEqualTo(2); // admin y admin2, una sola vez
	}

	@RepeatedTest(3)
	void aceptarContraCancelar_estadoFinalCoherente_nuncaLasDos_ySin500() throws Exception {
		assertThat(invitar(admin, club, "jugador@vibora.com", "MONITOR")).isEqualTo(202);
		long id = invitacionDe(club, "jugador@vibora.com");

		List<Integer> estados = lanzarALaVez(List.<Callable<Integer>>of(() -> aceptar(jugador, id), () -> cancelar(admin, club, id)));

		assertThat(estados).as("estados: %s", estados).allMatch(s -> s == 200 || s == 204 || s == 409);
		String estado = estadoDe(id);
		Usuario u = enBd(jugador);
		if (estado.equals("ACEPTADA")) {
			assertThat(estados).containsExactly(200, 409);
			assertThat(u.getRol()).isEqualTo(Rol.MONITOR);
		} else {
			assertThat(estado).isEqualTo("CANCELADA");
			assertThat(estados).containsExactly(409, 204);
			assertThat(u.getRol()).isEqualTo(Rol.JUGADOR);
			assertThat(u.getClub()).isNull();
		}
	}

	@RepeatedTest(3)
	void diezInvitacionesSimultaneasAlMismoCorreo_unaSolaFilaViva() throws Exception {
		List<Callable<Integer>> tareas = new ArrayList<>();
		for (int i = 0; i < 10; i++) {
			Persona quien = i % 2 == 0 ? admin : admin2;
			tareas.add(() -> invitar(quien, club, "nadie@vibora.com", "MONITOR"));
		}
		List<Integer> estados = lanzarALaVez(tareas);

		assertThat(cuantos(estados, 202)).as("estados: %s", estados).isEqualTo(10);
		assertThat(jdbc.queryForObject("select count(*) from invitacion_personal where email = 'nadie@vibora.com'", Long.class))
				.isEqualTo(1);
	}

	@RepeatedTest(3)
	void invitacionesSimultaneasMasAllaDelTopeDePendientes_nuncaSePasaDe50() throws Exception {
		// 45 pendientes de hace dos dias (no cuentan para el tope de 24 h): quedan 5 plazas
		for (int i = 0; i < 45; i++) {
			jdbc.update("insert into invitacion_personal (club_id, email, rol, invitado_por, creada_en, caduca_en) "
					+ "values (?, ?, 'MONITOR', ?, now() - interval '2 days', now() + interval '12 days')",
					club.getId(), "previa" + i + "@vibora.com", admin.id());
		}
		List<Callable<Integer>> tareas = new ArrayList<>();
		for (int i = 0; i < 12; i++) {
			String email = "nueva" + i + "@vibora.com";
			Persona quien = i % 2 == 0 ? admin : admin2;
			tareas.add(() -> invitar(quien, club, email, "MONITOR"));
		}
		List<Integer> estados = lanzarALaVez(tareas);

		assertThat(cuantos(estados, 202)).as("estados: %s", estados).isEqualTo(5);
		assertThat(cuantos(estados, 429)).as("estados: %s", estados).isEqualTo(7);
		assertThat(jdbc.queryForObject("select count(*) from invitacion_personal where estado = 'PENDIENTE'", Long.class))
				.isEqualTo(50);
	}

	private long avisos(String tipo) {
		return jdbc.queryForObject("select count(*) from notificacion where tipo = ?", Long.class, tipo);
	}
}
