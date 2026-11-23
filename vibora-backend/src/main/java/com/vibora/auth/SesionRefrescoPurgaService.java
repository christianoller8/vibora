package com.vibora.auth;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

/**
 * Purga de sesiones de refresco: borra las filas cuya FAMILIA caduco (tope absoluto) o que se revocaron hace MAS de un dia
 * (estrictamente: justo en el limite se conservan; ese dia de margen deja ver la revocacion si alguien reutiliza un token).
 * No se mira la caducidad propia de la fila: un token rotado se conserva hasta el tope de su familia, porque mientras la
 * familia pueda refrescarse, reutilizarlo tiene que revocarla en vez de parecer un token desconocido. Por lotes de
 * {@code vibora.sesion.lote} filas, cada uno en su propia transaccion corta.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SesionRefrescoPurgaService {

	private static final Duration MARGEN = Duration.ofDays(1);

	private final SesionRefrescoRepository sesiones;
	private final SesionProperties propiedades;
	private final Clock reloj;

	/** Cada dia a las 04:00 (zona del club); el cron se puede cambiar con vibora.sesion.purga-cron. */
	@Scheduled(cron = "${vibora.sesion.purga-cron:0 0 4 * * *}", zone = "${vibora.zona-horaria}")
	public void purgaProgramada() {
		purgar();
	}

	/** Borra lo vencido segun el reloj inyectado y devuelve cuantas filas borro. */
	public int purgar() {
		Instant limite = reloj.instant().minus(MARGEN);
		int lote = Math.max(1, propiedades.lote());
		int total = 0;
		int borradas;
		do {
			borradas = sesiones.borrarVencidasAnterioresA(limite, lote);
			total += borradas;
		} while (borradas == lote);
		log.info("Purga de sesiones de refresco: {} filas borradas", total);
		return total;
	}
}
