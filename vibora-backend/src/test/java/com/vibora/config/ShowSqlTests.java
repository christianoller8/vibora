package com.vibora.config;

import com.vibora.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.Environment;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/** El log no vuelca cada sentencia SQL (con datos de usuarios) salvo que se pida: --spring.jpa.show-sql=true. */
class ShowSqlTests extends ApiTestBase {

	@Autowired Environment entorno;

	@Test
	void showSqlEstaApagadoPorDefecto() {
		assertThat(entorno.getProperty("spring.jpa.show-sql")).isEqualTo("false");
	}
}
