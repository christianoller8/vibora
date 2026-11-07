package com.vibora.factura;

import com.vibora.usuario.Rol;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Una transaccion que falla DESPUES de haber tomado un numero lo devuelve: el contador se deshace junto con ella, asi
 * que la siguiente factura usa ese mismo numero y no queda ningun hueco. Se fuerza el fallo con un espia sobre
 * NumeracionFacturas que deja correr la asignacion real (contador incrementado y bloqueado) y lanza justo despues.
 */
class FacturaSinHuecosTests extends FacturaSinTransaccionBase {

	@MockitoSpyBean NumeracionFacturas numeracion;

	/** Veces que se ha llegado de verdad al punto de fallo inyectado (prueba de que el 500 viene de aqui y no de otra parte). */
	private final AtomicInteger fallosInyectados = new AtomicInteger();

	private void fallarTrasTomarNumero() {
		fallosInyectados.set(0);
		Mockito.doAnswer(invocacion -> {
			invocacion.callRealMethod(); // el contador de la BD ya esta incrementado y bloqueado...
			fallosInyectados.incrementAndGet();
			throw new IllegalStateException("fallo forzado tras tomar el numero");
		}).when(numeracion).siguiente(Mockito.anyLong(), Mockito.anyInt());
	}

	private void restaurar() {
		Mockito.reset(numeracion);
	}

	/**
	 * Antes la excepcion sin tratar atravesaba MockMvc; ahora el GlobalExceptionHandler la convierte en un 500 generico.
	 * La transaccion del servicio ya se ha deshecho en ambos casos: lo que se comprueba despues no cambia.
	 */
	private void exigirErrorInterno(MvcResult resultado) throws Exception {
		assertThat(fallosInyectados.get()).as("el fallo forzado tras tomar el numero llego a dispararse").isPositive();
		assertThat(resultado.getResponse().getStatus()).isEqualTo(500);
		assertThat(resultado.getResponse().getContentAsString()).isEqualTo("{\"error\":\"Error interno\"}");
	}

	@Test
	void siFalloTrasTomarUnNumero_laSiguienteFacturaReutilizaElMismoNumero_sinHueco() throws Exception {
		Persona ana = persona("ana@vibora.com", Rol.JUGADOR, null);
		long r1 = reservaDe(ana, 0);
		long r2 = reservaDe(ana, 1);
		long r3 = reservaDe(ana, 2);
		assertThat(facturar(ana, r1).getResponse().getStatus()).isEqualTo(201); // F-0001

		fallarTrasTomarNumero();
		exigirErrorInterno(facturar(ana, r2));
		restaurar();

		assertThat(contador(anioActual())).as("el contador se deshizo con la transaccion").isEqualTo(1);
		assertThat(numeros(anioActual())).containsExactly(1);
		assertThat(jdbc.queryForObject("select count(*) from factura where reserva_id = ?", Long.class, r2)).isZero();

		MvcResult segunda = facturar(ana, r2);
		MvcResult tercera = facturar(ana, r3);
		assertThat(segunda.getResponse().getStatus()).isEqualTo(201);
		assertThat(numeroDe(segunda.getResponse().getContentAsString())).as("el numero que se perdio en el fallo").isEqualTo(2);
		assertThat(numeroDe(tercera.getResponse().getContentAsString())).isEqualTo(3);
		assertThat(numeros(anioActual())).containsExactly(1, 2, 3);
		assertThat(contador(anioActual())).isEqualTo(3);
	}

	@Test
	void siFalloTrasTomarElNumeroDeLaRectificativa_laCancelacionEntera_sedeshace_yAlReintentarSeNumeraSinHueco() throws Exception {
		Persona ana = persona("ana@vibora.com", Rol.JUGADOR, null);
		long reserva = reservaDe(ana, 0);
		assertThat(facturar(ana, reserva).getResponse().getStatus()).isEqualTo(201); // F-0001

		fallarTrasTomarNumero();
		exigirErrorInterno(cancelar(ana, reserva));
		restaurar();

		// todo se deshizo: la reserva sigue confirmada, no hay rectificativa ni aviso, el contador no se movio
		assertThat(jdbc.queryForObject("select estado from reserva where id = ?", String.class, reserva)).isEqualTo("CONFIRMADA");
		assertThat(contarFacturas()).isEqualTo(1);
		assertThat(contador(anioActual())).isEqualTo(1);
		assertThat(jdbc.queryForObject("select count(*) from notificacion where tipo in ('FACTURA_RECTIFICATIVA', 'RESERVA_CANCELADA')",
				Long.class)).isZero();

		assertThat(cancelar(ana, reserva).getResponse().getStatus()).isEqualTo(200);
		assertThat(numeros(anioActual())).containsExactly(1, 2);
		assertThat(jdbc.queryForObject("select tipo from factura where numero = 2", String.class)).isEqualTo("RECTIFICATIVA");
		assertThat(jdbc.queryForObject("select estado from reserva where id = ?", String.class, reserva)).isEqualTo("CANCELADA");
	}

	@Test
	void variosFalloSeguidos_nuncaDejanHuecosNiRepiten() throws Exception {
		Persona ana = persona("ana@vibora.com", Rol.JUGADOR, null);
		List<Long> reservas = List.of(reservaDe(ana, 0), reservaDe(ana, 1), reservaDe(ana, 2), reservaDe(ana, 3));

		for (int i = 0; i < reservas.size(); i++) {
			long reserva = reservas.get(i);
			fallarTrasTomarNumero();
			exigirErrorInterno(facturar(ana, reserva));
			restaurar();
			assertThat(facturar(ana, reserva).getResponse().getStatus()).isEqualTo(201);
		}

		assertThat(numeros(anioActual())).containsExactly(1, 2, 3, 4);
		assertThat(contador(anioActual())).isEqualTo(4);
	}
}
