package com.vibora.auth;

import com.vibora.PostgresTestBase;
import com.vibora.TestData;
import com.vibora.usuario.Rol;
import com.vibora.usuario.Usuario;
import com.vibora.usuario.UsuarioRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * Si la BD falla al comprobar la version de sesion, la API REST NO responde 401 (un corte de BD cerraria la sesion de todo
 * el mundo): el fallo sigue siendo un error de servidor (5xx).
 */
@SpringBootTest(properties = "vibora.jwt.secret=secreto-de-test-con-al-menos-32-bytes-ok!")
@AutoConfigureMockMvc
class VersionSesionFalloBdTests extends PostgresTestBase {

	@Autowired MockMvc mvc;
	@Autowired UsuarioRepository usuarios;
	@Autowired JwtService jwtService;
	@MockitoSpyBean VersionSesionValidador validador;

	private Usuario usuario;

	@AfterEach
	void limpiar() {
		if (usuario != null) {
			usuarios.deleteById(usuario.getId());
		}
	}

	@Test
	void unFalloDeBdAlComprobarLaVersion_noEs401_esUn5xx() throws Exception {
		usuario = usuarios.saveAndFlush(TestData.usuario("bd-" + UUID.randomUUID() + "@vibora.com", Rol.JUGADOR, null));
		String token = jwtService.generar(usuario).token();
		doThrow(new DataAccessResourceFailureException("BD caida")).when(validador).validate(any());

		int estado;
		try {
			estado = mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)).andReturn().getResponse()
					.getStatus();
		} catch (Exception ex) {
			assertThat(ex).hasStackTraceContaining("BD caida"); // MockMvc relanza lo que Tomcat convertiria en 500
			estado = 500;
		}

		assertThat(estado).isGreaterThanOrEqualTo(500);
	}
}
