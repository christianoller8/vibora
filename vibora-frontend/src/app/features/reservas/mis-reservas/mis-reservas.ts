import { Component, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY, Observable, Subject, catchError, debounceTime, filter, switchMap } from 'rxjs';
import { recargarAlRecuperarSesion } from '../../../core/auth/recarga-sesion';
import { mensajeDeError } from '../../../core/http/error.util';
import { NotificacionesStore } from '../../../core/notificaciones/notificaciones.store';
import {
  formatearFechaHora,
  formatearFechaLarga,
  formatearPrecio,
  formatearRangoHoras,
} from '../../../core/util/fecha';
import {
  ConfirmDialog,
  ConfirmDialogData,
  ConfirmDialogLinea,
} from '../../../shared/components/confirm-dialog/confirm-dialog';
import { TipoNotificacion } from '../../../shared/models/notificacion.model';
import { EstadoReserva, Reserva } from '../../../shared/models/reserva.model';
import { PartidoService } from '../../partidos/partido.service';
import {
  FacturaReservaDialog,
  FacturaReservaDialogData,
} from '../factura-reserva-dialog/factura-reserva-dialog';
import { ReservaService } from '../reserva.service';

const JUGADORES_POR_PARTIDO = 4;
/** setTimeout no admite esperas mayores de 2^31-1 ms. */
const MAX_ESPERA_MS = 2 ** 31 - 1;

/** Notificaciones que cambian lo que esta página muestra (jugadores apuntados, reservas canceladas). */
const TIPOS_QUE_AFECTAN: ReadonlySet<TipoNotificacion> = new Set<TipoNotificacion>([
  'JUGADOR_SE_APUNTO',
  'JUGADOR_SALIO',
  'PARTIDO_COMPLETO',
  'RESERVA_CANCELADA',
]);

/** Ventana para agrupar varios push seguidos en un único refresco. */
const RETARDO_REFRESCO_MS = 300;

function sinElemento(ids: ReadonlySet<number>, id: number): ReadonlySet<number> {
  const copia = new Set(ids);
  copia.delete(id);
  return copia;
}

const ETIQUETA_ESTADO: Record<EstadoReserva, string> = {
  CONFIRMADA: 'Confirmada',
  CANCELADA: 'Cancelada',
};

@Component({
  selector: 'app-mis-reservas',
  imports: [MatButtonModule, MatProgressSpinnerModule, MatSlideToggleModule],
  templateUrl: './mis-reservas.html',
  styleUrl: './mis-reservas.scss',
})
export class MisReservas {
  private readonly reservaService = inject(ReservaService);
  private readonly partidoService = inject(PartidoService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly notificaciones = inject(NotificacionesStore);

  protected readonly reservas = signal<Reserva[]>([]);
  /** Reloj de la página (ms): las comprobaciones de plazo dependen de él y por eso se repintan al avanzar. */
  private readonly ahora = signal(Date.now());
  protected readonly cargando = signal(true);
  protected readonly cancelando = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Reservas con un cambio de "partido abierto" en vuelo (su interruptor se bloquea). */
  protected readonly cambiando = signal<ReadonlySet<number>>(new Set());

  protected readonly jugadoresPorPartido = JUGADORES_POR_PARTIDO;
  protected readonly formatearFecha = formatearFechaLarga;
  protected readonly formatearRango = formatearRangoHoras;
  protected readonly formatearPrecio = formatearPrecio;

  /** Emite `true` si la carga debe mostrar el spinner o `false` si es un refresco silencioso. */
  private readonly cargar$ = new Subject<boolean>();

  constructor() {
    this.cargar$
      .pipe(
        switchMap((conSpinner) => this.consultar(conSpinner)),
        takeUntilDestroyed(),
      )
      .subscribe((reservas) => {
        this.reservas.set(reservas);
        this.cargando.set(false);
      });

    // Si alguien se apunta o sale, se completa un partido o se cancela una reserva, lo mostrado deja de ser
    // cierto: refresco silencioso agrupando ráfagas en una sola petición.
    this.notificaciones.recibidas$
      .pipe(
        filter((n) => TIPOS_QUE_AFECTAN.has(n.tipo)),
        debounceTime(RETARDO_REFRESCO_MS),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.cargar$.next(false));

    recargarAlRecuperarSesion(
      () => this.error() !== null,
      () => this.reintentar(),
    );

    // Reloj de la página: se despierta justo cuando pasa el siguiente instante relevante (fin del plazo de
    // cancelación o inicio de una reserva) para que los botones se actualicen sin recargar.
    effect((alLimpiar) => {
      const ahora = this.ahora();
      const proximo = this.reservas()
        .flatMap((r) => [r.cancelableHasta, r.inicio])
        .map((instante) => (instante ? Date.parse(instante) : NaN))
        .filter((ms) => ms >= ahora)
        .reduce((min, ms) => Math.min(min, ms), Infinity);
      if (proximo === Infinity) {
        return;
      }
      // +1 ms porque "hasta" es inclusivo; el tope evita el desbordamiento de setTimeout (~24,8 días)
      const espera = Math.min(proximo - Date.now() + 1, MAX_ESPERA_MS);
      const temporizador = setTimeout(() => this.ahora.set(Date.now()), Math.max(espera, 0));
      alLimpiar(() => clearTimeout(temporizador));
    });

    this.cargar$.next(true);
  }

  protected etiquetaEstado(reserva: Reserva): string {
    return ETIQUETA_ESTADO[reserva.estado];
  }

  /** Solo se puede cancelar una reserva confirmada que todavía no ha empezado. */
  protected puedeCancelar(reserva: Reserva): boolean {
    return reserva.estado === 'CONFIRMADA' && new Date(reserva.inicio).getTime() > this.ahora();
  }

  /**
   * Plazo del propietario: "hasta" es inclusivo. Sin `cancelableHasta` (null o ausente) no se conoce plazo y
   * se deja cancelar como siempre; el backend sigue siendo quien manda.
   */
  protected enPlazo(reserva: Reserva): boolean {
    return !reserva.cancelableHasta || Date.parse(reserva.cancelableHasta) >= this.ahora();
  }

  protected textoPlazo(reserva: Reserva): string {
    return `Solo se puede cancelar hasta el ${formatearFechaHora(reserva.cancelableHasta!)}`;
  }

  /** Abrir o cerrar el partido solo tiene sentido en una reserva confirmada que aún no ha empezado. */
  protected puedeAbrir(reserva: Reserva): boolean {
    return this.puedeCancelar(reserva);
  }

  /**
   * Optimista: el interruptor cambia al instante y, si el backend lo rechaza (p. ej. cerrar con otros jugadores
   * ya apuntados), se vuelve al valor anterior y se muestra el motivo.
   */
  protected alternarAbierta(reserva: Reserva, evento: MatSlideToggleChange): void {
    if (this.cambiando().has(reserva.id)) {
      return;
    }
    const abierta = evento.checked;
    const anterior = reserva.abierta;
    this.reemplazar(reserva.id, (r) => ({ ...r, abierta }));
    this.cambiando.update((ids) => new Set(ids).add(reserva.id));

    this.partidoService.setAbierta(reserva.id, abierta).subscribe({
      next: (actualizada) => {
        this.cambiando.update((ids) => sinElemento(ids, reserva.id));
        this.reemplazar(reserva.id, () => actualizada);
      },
      error: (err: unknown) => {
        this.cambiando.update((ids) => sinElemento(ids, reserva.id));
        this.reemplazar(reserva.id, (r) => ({ ...r, abierta: anterior }));
        // el interruptor ya cambió por dentro: si el estado vuelve al valor previo antes de repintar,
        // el binding [checked] no se enteraría, así que se restaura explícitamente
        evento.source.checked = anterior;
        this.snack.open(
          mensajeDeError(err, 'No se pudo cambiar el estado del partido. Inténtalo de nuevo.'),
          'Cerrar',
          { duration: 6000 },
        );
      },
    });
  }

  private reemplazar(id: number, cambio: (reserva: Reserva) => Reserva): void {
    this.reservas.update((lista) => lista.map((r) => (r.id === id ? cambio(r) : r)));
  }

  protected cancelar(reserva: Reserva): void {
    if (this.cancelando() || !this.enPlazo(reserva)) {
      return;
    }
    const lineas: ConfirmDialogLinea[] = [
      { etiqueta: 'Club', valor: reserva.clubNombre },
      { etiqueta: 'Pista', valor: reserva.pistaNombre },
      { etiqueta: 'Fecha', valor: formatearFechaLarga(reserva.inicio) },
      { etiqueta: 'Hora', valor: formatearRangoHoras(reserva.inicio, reserva.fin) },
    ];
    if (reserva.cancelableHasta) {
      lineas.push({
        etiqueta: 'Cancelable hasta',
        valor: formatearFechaHora(reserva.cancelableHasta),
      });
    }
    const datos: ConfirmDialogData = {
      titulo: 'Cancelar reserva',
      mensaje: '¿Seguro que quieres cancelar esta reserva?',
      lineas,
      textoConfirmar: 'Cancelar reserva',
      textoCancelar: 'Mantener',
    };

    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data: datos })
      .afterClosed()
      .subscribe((confirmado) => {
        if (confirmado) {
          this.ejecutarCancelacion(reserva);
        }
      });
  }

  private ejecutarCancelacion(reserva: Reserva): void {
    this.cancelando.set(true);
    this.reservaService.cancelar(reserva.id).subscribe({
      next: () => {
        this.cancelando.set(false);
        this.snack.open('Reserva cancelada.', 'Cerrar', { duration: 5000 });
        this.cargar$.next(true);
      },
      error: (err: unknown) => {
        this.cancelando.set(false);
        this.snack.open(
          mensajeDeError(err, 'No se pudo cancelar la reserva. Inténtalo de nuevo.'),
          'Cerrar',
          { duration: 6000 },
        );
      },
    });
  }

  /**
   * Todas las reservas de esta lista son del usuario como organizador (`/api/reservas/mias`), que es quien puede pedir y
   * descargar la factura. Las facturas de la reserva se piden al abrir el diálogo, no al cargar la página.
   */
  protected abrirFactura(reserva: Reserva): void {
    this.dialog.open<FacturaReservaDialog, FacturaReservaDialogData>(FacturaReservaDialog, {
      data: { reserva },
    });
  }

  protected reintentar(): void {
    this.cargar$.next(true);
  }

  private consultar(conSpinner: boolean): Observable<Reserva[]> {
    if (conSpinner) {
      this.cargando.set(true);
    }
    this.error.set(null);
    return this.reservaService.mias().pipe(
      catchError((err: unknown) => {
        this.error.set(mensajeDeError(err, 'No se pudieron cargar tus reservas.'));
        this.cargando.set(false);
        return EMPTY;
      }),
    );
  }
}
