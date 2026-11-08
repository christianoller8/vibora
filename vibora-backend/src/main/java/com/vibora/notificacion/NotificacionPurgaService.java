package com.vibora.notificacion;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.function.ToIntBiFunction;

/**
 * Purga de notificaciones antiguas. Se borran las LEIDAS con mas de {@code retencion-dias} y las NO leidas con mas de
 * {@code retencion-no-leidas-dias}; estrictamente mas antiguas que el limite (justo en el limite se conservan). Por
 * lotes, cada uno en su propia transaccion (sentencia corta, sin bloqueos largos sobre una tabla de escritura constante).
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class NotificacionPurgaService {

	private final NotificacionRepository notificaciones;
	private final NotificacionRetencionProperties propiedades;
	private final Clock reloj;

	/** Cada dia a las 03:30 (zona del club); el cron se puede cambiar con vibora.notificaciones.purga-cron. */
	@Scheduled(cron = "${vibora.notificaciones.purga-cron:0 30 3 * * *}", zone = "${vibora.zona-horaria}")
	public void purgaProgramada() {
		purgar();
	}

	/** Borra lo vencido segun el reloj inyectado y devuelve cuantas notificaciones borro (0 si la purga esta desactivada). */
	public int purgar() {
		if (!propiedades.purgaActiva()) {
			log.debug("Purga de notificaciones desactivada (vibora.notificaciones.purga-activa=false)");
			return 0;
		}
		Instant ahora = reloj.instant();
		int leidas = borrarPorLotes(ahora.minus(Duration.ofDays(propiedades.retencionDias())),
				notificaciones::borrarLeidasAnterioresA);
		int noLeidas = borrarPorLotes(ahora.minus(Duration.ofDays(propiedades.retencionNoLeidasDias())),
				notificaciones::borrarNoLeidasAnterioresA);
		log.info("Purga de notificaciones: {} leídas y {} sin leer borradas", leidas, noLeidas);
		return leidas + noLeidas;
	}

	/** Repite lotes hasta que uno sale incompleto (ya no queda nada por debajo del limite). */
	private int borrarPorLotes(Instant limite, ToIntBiFunction<Instant, Integer> borrarLote) {
		int lote = Math.max(1, propiedades.lote());
		int total = 0;
		int borradas;
		do {
			borradas = borrarLote.applyAsInt(limite, lote);
			total += borradas;
		} while (borradas == lote);
		return total;
	}
}
