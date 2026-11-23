package com.vibora.auth;

import com.vibora.common.exception.LimiteExcedidoException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Limitador anti-fuerza-bruta del login y del registro. En memoria (por instancia), con el Clock inyectado, sin libreria.
 * <p>
 * Los intentos se cuentan al ADMITIRLOS, antes de hacer el hash de la contraseña (rechazo barato, protege la CPU), y no
 * al ver que fallan: asi el limite es exacto con peticiones simultaneas (con N hilos a la vez se admiten exactamente
 * los N permitidos; el refresco es la excepcion, ver abajo) y no depende de si el email existe (no hay enumeracion de cuentas). Ventana FIJA que empieza en el
 * primer intento; al terminar, el contador vuelve a cero.
 * <ul>
 * <li>login: por (IP, email normalizado) y por IP. La clave incluye la IP a proposito: quien ataca desde otras IPs no
 * puede dejar fuera a la victima. Un login correcto reinicia el par y devuelve el intento a la IP.</li>
 * <li>registro: por IP.</li>
 * <li>refresco: por IP, pero solo cuentan los refrescos FALLIDOS (se comprueba al entrar y se cuenta al fallar, tras la consulta a BD, y solo si traia cookie; con mucha concurrencia puede pasarse un poco del tope).</li>
 * </ul>
 * Un intento rechazado no gasta cuota de la IP. Tamano acotado ({@code maxEntradas} por contador): al llenarse se
 * descartan las ventanas caducadas y, si sigue lleno, un lote de las mas antiguas (sin recorrer nunca todo el mapa).
 * Las IPv6 se agrupan por /64 y la IPv4 mapeada cuenta como IPv4. Todo el estado se protege con un unico monitor:
 * cada operacion es O(1) amortizado y el coste es despreciable frente al BCrypt que evita.
 */
@Component
public class LimitadorAuth {

	private static final class Ventana {
		final Instant inicio;
		int cuenta;

		Ventana(Instant inicio) {
			this.inicio = inicio;
		}
	}

	/** Recibo de una admision de login: en que ventana (par e IP) se contó, para que el éxito solo toque esa ventana. */
	public record Admision(Instant inicioPar, Instant inicioIp) {
	}

	/** Solo digitos hexadecimales, ':' y '.' (con zona opcional): garantiza que InetAddress lo trata como literal, sin DNS. */
	private static final Pattern LITERAL_IPV6 = Pattern.compile("[0-9A-Fa-f:.]+(%[\\w.-]+)?");

	private final SeguridadProperties propiedades;
	private final Clock reloj;
	// LinkedHashMap: el orden de insercion es el orden de inicio de ventana (ver hacerHueco)
	private final Map<String, Ventana> loginPorPar = new LinkedHashMap<>();
	private final Map<String, Ventana> loginPorIp = new LinkedHashMap<>();
	private final Map<String, Ventana> registroPorIp = new LinkedHashMap<>();
	private final Map<String, Ventana> refrescoPorIp = new LinkedHashMap<>();

	public LimitadorAuth(SeguridadProperties propiedades, Clock reloj) {
		this.propiedades = propiedades;
		this.reloj = reloj;
	}

	/** Lanza {@link LimiteExcedidoException} (429) si no se admite; si se admite, cuenta el intento. */
	public synchronized Admision admitirLogin(String ipCliente, String email) {
		String ip = claveIp(ipCliente);
		Instant ahora = reloj.instant();
		Duration ventana = propiedades.loginVentana();
		String clavePar = ip + "|" + email.trim().toLowerCase(Locale.ROOT);
		long espera = Math.max(
				esperaSiLleno(loginPorPar.get(clavePar), propiedades.loginMaxPorEmail(), ventana, ahora),
				esperaSiLleno(loginPorIp.get(ip), propiedades.loginMaxPorIp(), ventana, ahora));
		if (espera > 0) {
			throw excedido(espera);
		}
		contar(loginPorPar, clavePar, ahora, ventana);
		contar(loginPorIp, ip, ahora, ventana);
		return new Admision(loginPorPar.get(clavePar).inicio, loginPorIp.get(ip).inicio);
	}

	/** Login correcto: se reinicia el par (IP, email) y el intento no cuenta para el umbral de la IP. */
	public synchronized void loginCorrecto(String ipCliente, String email, Admision admision) {
		String ip = claveIp(ipCliente);
		// Solo si la ventana sigue siendo la de la admision: si caduco y empezo otra mientras se hacia el hash, el exito
		// de la peticion vieja no puede borrar ni restar intentos de la nueva.
		String clavePar = ip + "|" + email.trim().toLowerCase(Locale.ROOT);
		Ventana delPar = loginPorPar.get(clavePar);
		if (delPar != null && delPar.inicio.equals(admision.inicioPar())) {
			loginPorPar.remove(clavePar);
		}
		Ventana deLaIp = loginPorIp.get(ip);
		if (deLaIp != null && deLaIp.inicio.equals(admision.inicioIp()) && --deLaIp.cuenta <= 0) {
			loginPorIp.remove(ip);
		}
	}

	/**
	 * Refrescos por IP: solo cuentan los FALLIDOS (sin cookie, desconocida, caducada, revocada, pasada de tope o reutilizada).
	 * Esto comprueba, sin contar, que la IP no haya llenado su cuota (429 si lo hizo); {@link #refrescoFallido} la gasta.
	 * Una rotacion correcta no gasta cuota: tras un club entero detras de la misma NAT, cada arranque de la app refresca.
	 */
	public synchronized void comprobarRefresco(String ipCliente) {
		String ip = claveIp(ipCliente);
		long espera = esperaSiLleno(refrescoPorIp.get(ip), propiedades.refrescoMaxPorIp(), propiedades.refrescoVentana(),
				reloj.instant());
		if (espera > 0) {
			throw excedido(espera);
		}
	}

	/** Un refresco fallido: cuenta contra la cuota de la IP. */
	public synchronized void refrescoFallido(String ipCliente) {
		contar(refrescoPorIp, claveIp(ipCliente), reloj.instant(), propiedades.refrescoVentana());
	}

	public synchronized void admitirRegistro(String ipCliente) {
		String ip = claveIp(ipCliente);
		Instant ahora = reloj.instant();
		Duration ventana = propiedades.registroVentana();
		long espera = esperaSiLleno(registroPorIp.get(ip), propiedades.registroMaxPorIp(), ventana, ahora);
		if (espera > 0) {
			throw excedido(espera);
		}
		contar(registroPorIp, ip, ahora, ventana);
	}

	/** Borra las ventanas caducadas; devuelve cuantas. Publico para probarlo directamente. */
	@Scheduled(fixedDelayString = "${vibora.seguridad.limpieza-intervalo:PT5M}",
			initialDelayString = "${vibora.seguridad.limpieza-intervalo:PT5M}")
	public synchronized int limpiarCaducados() {
		Instant ahora = reloj.instant();
		return purgar(loginPorPar, propiedades.loginVentana(), ahora) + purgar(loginPorIp, propiedades.loginVentana(), ahora)
				+ purgar(registroPorIp, propiedades.registroVentana(), ahora)
				+ purgar(refrescoPorIp, propiedades.refrescoVentana(), ahora);
	}

	public synchronized int tamano() {
		return loginPorPar.size() + loginPorIp.size() + registroPorIp.size() + refrescoPorIp.size();
	}

	// ---- internos (siempre bajo el monitor) ----

	/** Segundos que faltan para que se libere la clave si ya alcanzo el maximo (en su ventana vigente); 0 si se admite. */
	private static long esperaSiLleno(Ventana v, int maximo, Duration ventana, Instant ahora) {
		if (v == null) {
			return 0;
		}
		Instant fin = v.inicio.plus(ventana);
		if (!ahora.isBefore(fin)) {
			return 0; // ventana caducada
		}
		if (v.cuenta < maximo) {
			return 0;
		}
		return Math.max(1, (Duration.between(ahora, fin).toMillis() + 999) / 1000);
	}

	private void contar(Map<String, Ventana> mapa, String clave, Instant ahora, Duration ventana) {
		Ventana v = mapa.get(clave);
		if (v != null && ahora.isBefore(v.inicio.plus(ventana))) {
			v.cuenta++;
			return;
		}
		if (v != null) {
			mapa.remove(clave); // ventana caducada: se reinserta al final para conservar el orden por inicio
		} else if (mapa.size() >= propiedades.maxEntradas()) {
			hacerHueco(mapa, ventana, ahora);
		}
		v = new Ventana(ahora);
		v.cuenta = 1;
		mapa.put(clave, v);
	}

	/**
	 * Mapa lleno: primero lo caducado; si sigue lleno, un LOTE (10 %) de las mas antiguas. Los mapas son LinkedHashMap en
	 * orden de insercion = orden de {@code inicio} (una ventana nueva siempre entra al final), asi que lo caducado y lo
	 * mas antiguo estan al principio y nunca se recorre el mapa entero: el coste es proporcional a lo que se borra y,
	 * al expulsar por lotes, amortizado O(1) por insercion (un atacante con IPs nuevas no obliga a un barrido por peticion).
	 */
	private void hacerHueco(Map<String, Ventana> mapa, Duration ventana, Instant ahora) {
		purgar(mapa, ventana, ahora);
		int lote = Math.max(1, propiedades.maxEntradas() / 10);
		if (mapa.size() >= propiedades.maxEntradas()) {
			Iterator<Ventana> it = mapa.values().iterator();
			for (int i = 0; i < lote && it.hasNext(); i++) {
				it.next();
				it.remove();
			}
		}
	}

	/** Quita las caducadas empezando por las mas antiguas y parando en la primera vigente (orden por inicio). */
	private static int purgar(Map<String, Ventana> mapa, Duration ventana, Instant ahora) {
		int borradas = 0;
		Iterator<Ventana> it = mapa.values().iterator();
		while (it.hasNext() && !ahora.isBefore(it.next().inicio.plus(ventana))) {
			it.remove();
			borradas++;
		}
		return borradas;
	}

	/**
	 * Clave de cliente: IPv4 tal cual; IPv4 mapeada en IPv6 ({@code ::ffff:a.b.c.d}) como la IPv4; el resto de IPv6, por
	 * su /64 (una sola persona controla normalmente un /64 entero, y si no se agrupara le bastaria rotar de direccion para
	 * esquivar el limite). Lo que no sea una IP literal se usa como llega (nunca se hace una consulta DNS).
	 */
	static String claveIp(String ip) {
		if (ip == null || ip.indexOf(':') < 0 || !LITERAL_IPV6.matcher(ip).matches()) {
			return ip;
		}
		try {
			InetAddress direccion = InetAddress.getByName(ip); // literal: no resuelve nombres
			if (direccion instanceof Inet6Address v6) {
				byte[] b = v6.getAddress();
				return "%02x%02x:%02x%02x:%02x%02x:%02x%02x::/64".formatted(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]);
			}
			return direccion.getHostAddress(); // Java ya devuelve Inet4Address para ::ffff:a.b.c.d
		} catch (UnknownHostException ex) {
			return ip;
		}
	}

	private static LimiteExcedidoException excedido(long segundos) {
		long minutos = Math.max(1, (segundos + 59) / 60);
		return new LimiteExcedidoException(
				"Demasiados intentos. Inténtalo de nuevo en %d %s".formatted(minutos, minutos == 1 ? "minuto" : "minutos"),
				segundos);
	}
}
