package com.vibora.auth;

import com.vibora.RelojMutable;
import com.vibora.common.exception.LimiteExcedidoException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Limitador en memoria: umbrales, ventanas con reloj mutable, reinicio, independencia de claves, tope y concurrencia. */
class LimitadorAuthTests {

	private static final Instant T0 = Instant.parse("2030-01-01T00:00:00Z");

	RelojMutable reloj;
	LimitadorAuth limitador;

	private static SeguridadProperties props(int maxEmail, int maxIp, int maxRegistro, int maxEntradas) {
		return new SeguridadProperties(maxEmail, maxIp, Duration.ofMinutes(15), maxRegistro, Duration.ofHours(1), maxEntradas, 60, Duration.ofMinutes(15));
	}

	@BeforeEach
	void preparar() {
		reloj = new RelojMutable(T0, ZoneOffset.UTC);
		limitador = new LimitadorAuth(props(5, 30, 10, 1000), reloj);
	}

	private void intentos(String ip, String email, int n) {
		for (int i = 0; i < n; i++) {
			limitador.admitirLogin(ip, email);
		}
	}

	@Test
	void elSextoIntentoDelMismoParIpEmailSeRechazaConSuRetryAfter() {
		intentos("1.1.1.1", "a@x.com", 5);

		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "a@x.com"))
				.isInstanceOfSatisfying(LimiteExcedidoException.class, ex -> {
					assertThat(ex.getRetryAfterSegundos()).isEqualTo(15 * 60);
					assertThat(ex.getMessage()).isEqualTo("Demasiados intentos. Inténtalo de nuevo en 15 minutos");
				});
	}

	@Test
	void elEmailSeNormalizaYElRetryAfterBajaConElTiempo() {
		intentos("1.1.1.1", "A@X.com", 3);
		intentos("1.1.1.1", "  a@x.COM ", 2);
		reloj.fijar(T0.plusSeconds(14 * 60 + 30));

		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "a@x.com"))
				.isInstanceOfSatisfying(LimiteExcedidoException.class, ex -> {
					assertThat(ex.getRetryAfterSegundos()).isEqualTo(30);
					assertThat(ex.getMessage()).isEqualTo("Demasiados intentos. Inténtalo de nuevo en 1 minuto");
				});
	}

	@Test
	void laVentanaCaducaYElContadorEmpiezaDeCero() {
		intentos("1.1.1.1", "a@x.com", 5);
		reloj.fijar(T0.plus(Duration.ofMinutes(15))); // en el instante exacto de fin de ventana ya no cuenta

		intentos("1.1.1.1", "a@x.com", 5);
		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "a@x.com")).isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void otroEmailDeLaMismaIpNoSeBloqueaHastaElUmbralDeLaIp() {
		intentos("1.1.1.1", "a@x.com", 5);

		// 5 intentos ya consumidos por la IP; otros 25 con emails distintos llegan a 30
		for (int i = 0; i < 25; i++) {
			limitador.admitirLogin("1.1.1.1", "otro" + i + "@x.com");
		}
		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "nuevo@x.com")).isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void otraIpNoSeAfectaPorLosFallosDeUnaIpAjena_unAtacanteNoBloqueaAUnaVictimaDesdeOtraIp() {
		intentos("6.6.6.6", "victima@x.com", 5);
		assertThatThrownBy(() -> limitador.admitirLogin("6.6.6.6", "victima@x.com")).isInstanceOf(LimiteExcedidoException.class);

		limitador.admitirLogin("2.2.2.2", "victima@x.com"); // la victima desde su IP entra sin problema
	}

	@Test
	void emailInexistenteYExistenteSeComportanIgual() {
		// el limitador no consulta ninguna cuenta: solo ve (ip, email)
		intentos("1.1.1.1", "existe@x.com", 5);
		intentos("1.1.1.1", "noexiste@x.com", 5);
		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "existe@x.com"))
				.isInstanceOf(LimiteExcedidoException.class).hasMessageContaining("Demasiados intentos");
		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "noexiste@x.com"))
				.isInstanceOf(LimiteExcedidoException.class).hasMessageContaining("Demasiados intentos");
	}

	@Test
	void unLoginCorrectoReiniciaElContadorDelPar() {
		intentos("1.1.1.1", "a@x.com", 4);
		var admision = limitador.admitirLogin("1.1.1.1", "a@x.com");
		limitador.loginCorrecto("1.1.1.1", "a@x.com", admision);

		intentos("1.1.1.1", "a@x.com", 5); // otra tanda completa
		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "a@x.com")).isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void unLoginCorrectoNoCuentaParaElUmbralDeLaIp() {
		for (int i = 0; i < 40; i++) { // 40 logins correctos de la misma IP
			var admision = limitador.admitirLogin("1.1.1.1", "ok" + i + "@x.com");
			limitador.loginCorrecto("1.1.1.1", "ok" + i + "@x.com", admision);
		}
		limitador.admitirLogin("1.1.1.1", "otro@x.com");
	}

	@Test
	void unIntentoRechazadoPorElParNoGastaCuotaDeLaIp() {
		intentos("1.1.1.1", "a@x.com", 5);
		for (int i = 0; i < 100; i++) {
			assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "a@x.com")).isInstanceOf(LimiteExcedidoException.class);
		}
		limitador.admitirLogin("1.1.1.1", "b@x.com"); // la IP solo ha gastado 5 de 30
	}

	@Test
	void registro_diezPorHoraPorIp_yLaVentanaCaduca() {
		for (int i = 0; i < 10; i++) {
			limitador.admitirRegistro("1.1.1.1");
		}
		assertThatThrownBy(() -> limitador.admitirRegistro("1.1.1.1")).isInstanceOfSatisfying(LimiteExcedidoException.class,
				ex -> {
					assertThat(ex.getRetryAfterSegundos()).isEqualTo(3600);
					assertThat(ex.getMessage()).isEqualTo("Demasiados intentos. Inténtalo de nuevo en 60 minutos");
				});
		limitador.admitirRegistro("3.3.3.3"); // otra IP
		reloj.fijar(T0.plus(Duration.ofHours(1)));
		limitador.admitirRegistro("1.1.1.1");
	}

	@Test
	void limpiarCaducadosBorraSoloLoCaducado() {
		intentos("1.1.1.1", "a@x.com", 1);
		reloj.fijar(T0.plus(Duration.ofMinutes(10)));
		intentos("2.2.2.2", "b@x.com", 1);
		limitador.admitirRegistro("1.1.1.1");
		int antes = limitador.tamano();
		assertThat(antes).isEqualTo(5); // 2 por IP + 2 por par + 1 registro

		reloj.fijar(T0.plus(Duration.ofMinutes(16))); // caduca lo de 1.1.1.1 (login), no lo de 2.2.2.2 ni el registro
		int borradas = limitador.limpiarCaducados();

		assertThat(borradas).isEqualTo(2);
		assertThat(limitador.tamano()).isEqualTo(3);
	}

	@Test
	void elTamanoEstaAcotado_seDescartaLoCaducadoYSiNoLoMasAntiguo() {
		limitador = new LimitadorAuth(props(5, 1000, 10, 10), reloj);
		for (int i = 0; i < 500; i++) {
			limitador.admitirLogin("9.9.9." + (i % 250), "u" + i + "@x.com");
			reloj.fijar(T0.plusSeconds(i)); // cada clave nace en un instante distinto
		}
		// tres contadores (par, ip y registro) con tope 10 cada uno
		assertThat(limitador.tamano()).isLessThanOrEqualTo(20);
		// lo mas reciente sigue contando
		limitador.admitirLogin("9.9.9.1", "u499@x.com");
	}

	// ---- IPv6 por /64 e IPv4 mapeada ----

	@Test
	void ipv6_todasLasDireccionesDeUnMismo64CuentanComoUnaSola_otro64NoSeAfecta() {
		intentos("2001:db8:1:2::1", "a@x.com", 5);

		assertThatThrownBy(() -> limitador.admitirLogin("2001:db8:1:2:ffff:abcd:0:9", "a@x.com"))
				.isInstanceOf(LimiteExcedidoException.class);
		limitador.admitirLogin("2001:db8:1:3::1", "a@x.com"); // otro /64: otra persona
	}

	@Test
	void ipv6_elContadorPorIpTambienSeAgrupaPorElSesentaYCuatro() {
		limitador = new LimitadorAuth(props(5, 3, 10, 1000), reloj);
		limitador.admitirLogin("2001:db8:1:2::1", "a@x.com");
		limitador.admitirLogin("2001:db8:1:2::2", "b@x.com");
		limitador.admitirLogin("2001:db8:1:2::3", "c@x.com");

		assertThatThrownBy(() -> limitador.admitirLogin("2001:db8:1:2::4", "d@x.com")).isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void ipv6_laNotacionNoImporta_abreviadaYExpandidaSonLaMismaDireccion() {
		intentos("2001:db8::1", "a@x.com", 5);
		assertThatThrownBy(() -> limitador.admitirLogin("2001:0db8:0000:0000:0000:0000:0000:0002", "a@x.com"))
				.isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void ipv4MapeadaEnIpv6SeNormalizaALaIpv4() {
		intentos("::ffff:1.1.1.1", "a@x.com", 5);
		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "a@x.com")).isInstanceOf(LimiteExcedidoException.class);

		for (int i = 0; i < 10; i++) {
			limitador.admitirRegistro(i % 2 == 0 ? "::ffff:5.5.5.5" : "5.5.5.5");
		}
		assertThatThrownBy(() -> limitador.admitirRegistro("5.5.5.5")).isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void unaCadenaQueNoEsUnaIpNoRompeNada() {
		intentos("desconocida", "a@x.com", 5);
		assertThatThrownBy(() -> limitador.admitirLogin("desconocida", "a@x.com")).isInstanceOf(LimiteExcedidoException.class);
		limitador.admitirLogin("otra-cosa", "a@x.com");
	}

	// ---- tope de tamano: expulsion por lotes ----

	private LimitadorAuth conTopeDeCien() {
		return new LimitadorAuth(props(5, 1000, 10, 100), reloj);
	}

	@Test
	void alLlenarse_siNadaHaCaducadoSeExpulsaUnLoteDeLosMasAntiguos_noSoloUno() {
		limitador = conTopeDeCien();
		for (int i = 0; i < 10; i++) {
			limitador.admitirRegistro("10.0.0.0"); // la IP mas antigua, ya en su maximo
		}
		for (int i = 1; i < 100; i++) {
			reloj.fijar(T0.plusSeconds(i));
			limitador.admitirRegistro("10.0.0." + i);
		}
		assertThat(limitador.tamano()).isEqualTo(100);

		reloj.fijar(T0.plusSeconds(100));
		limitador.admitirRegistro("10.0.1.0"); // el 101: se expulsan 10 (el 10 %), no 1

		assertThat(limitador.tamano()).isEqualTo(100 - 10 + 1);
		limitador.admitirRegistro("10.0.0.0"); // la mas antigua fue expulsada: su contador volvio a cero
		for (int i = 0; i < 9; i++) {
			limitador.admitirRegistro("10.0.0.99"); // la mas reciente se conservo (cuenta 1) y admite 9 mas
		}
		assertThatThrownBy(() -> limitador.admitirRegistro("10.0.0.99")).isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void alLlenarse_loCaducadoSeDescartaPrimero_yNoSeExpulsaNadaVivo() {
		limitador = conTopeDeCien();
		for (int i = 0; i < 100; i++) {
			limitador.admitirRegistro("10.0.0." + i);
		}
		reloj.fijar(T0.plus(Duration.ofHours(1))); // todo caduca (ventana de registro: 1 h)

		limitador.admitirRegistro("10.0.1.0");

		assertThat(limitador.tamano()).isEqualTo(1);
	}

	@Test
	void elTamanoNuncaSuperaElTopeAunqueEntrenMilIps() {
		limitador = conTopeDeCien();
		for (int i = 0; i < 1000; i++) {
			reloj.fijar(T0.plusMillis(i));
			limitador.admitirRegistro("10.1." + (i / 250) + "." + (i % 250));
			assertThat(limitador.tamano()).isLessThanOrEqualTo(100);
		}
	}

	// ---- loginCorrecto con una ventana que cambio entre la admision y el exito ----

	@Test
	void unExitoTardio_nuncaDecrementaNiBorraUnaVentanaNuevaDelPar() {
		var vieja = limitador.admitirLogin("1.1.1.1", "a@x.com"); // ventana W1
		reloj.fijar(T0.plus(Duration.ofMinutes(16))); // W1 caduca
		intentos("1.1.1.1", "a@x.com", 1); // ventana W2 (cuenta 1)

		limitador.loginCorrecto("1.1.1.1", "a@x.com", vieja); // el BCrypt de la peticion vieja termino ahora

		intentos("1.1.1.1", "a@x.com", 4); // W2 sigue en 1 -> caben 4 mas
		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "a@x.com")).isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void unExitoTardio_noDecrementaElContadorDeLaIpDeLaVentanaNueva() {
		limitador = new LimitadorAuth(props(5, 2, 10, 1000), reloj);
		var vieja = limitador.admitirLogin("1.1.1.1", "a@x.com");
		reloj.fijar(T0.plus(Duration.ofMinutes(16)));
		limitador.admitirLogin("1.1.1.1", "b@x.com"); // IP: ventana nueva con cuenta 1

		limitador.loginCorrecto("1.1.1.1", "a@x.com", vieja);

		limitador.admitirLogin("1.1.1.1", "c@x.com"); // cuenta 2
		assertThatThrownBy(() -> limitador.admitirLogin("1.1.1.1", "d@x.com")).isInstanceOf(LimiteExcedidoException.class);
	}

	@Test
	void concurrencia_exactamenteElMaximoSeAdmiteYElRestoSeRechaza() throws Exception {
		int hilos = 40;
		ExecutorService pool = Executors.newFixedThreadPool(hilos);
		CountDownLatch salida = new CountDownLatch(1);
		AtomicInteger admitidos = new AtomicInteger();
		AtomicInteger rechazados = new AtomicInteger();
		List<java.util.concurrent.Future<?>> futuros = new ArrayList<>();
		for (int i = 0; i < hilos; i++) {
			futuros.add(pool.submit(() -> {
				salida.await();
				try {
					limitador.admitirLogin("1.1.1.1", "a@x.com");
					admitidos.incrementAndGet();
				} catch (LimiteExcedidoException ex) {
					rechazados.incrementAndGet();
				}
				return null;
			}));
		}
		salida.countDown();
		for (var f : futuros) {
			f.get();
		}
		pool.shutdown();

		assertThat(admitidos.get()).isEqualTo(5);
		assertThat(rechazados.get()).isEqualTo(hilos - 5);
	}
}
