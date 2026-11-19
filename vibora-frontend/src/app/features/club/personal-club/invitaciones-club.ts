import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { Observable, Subject, catchError, debounceTime, filter, map, of, switchMap } from 'rxjs';
import { InvitacionService } from '../../../core/api/invitacion.service';
import { recargarAlRecuperarSesion } from '../../../core/auth/recarga-sesion';
import { mensajeDeError } from '../../../core/http/error.util';
import { NotificacionesStore } from '../../../core/notificaciones/notificaciones.store';
import { formatearFechaHora } from '../../../core/util/fecha';
import {
  ConfirmDialog,
  ConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog';
import {
  ETIQUETA_ESTADO_INVITACION,
  InvitacionClub,
  claseEstadoInvitacion,
} from '../../../shared/models/invitacion.model';
import { TipoNotificacion } from '../../../shared/models/notificacion.model';
import { ETIQUETA_ROL } from '../../../shared/models/usuario.model';

/** Lo que el administrador ve cambiar sin recargar: la persona aceptó o rechazó. */
const TIPOS_QUE_AFECTAN: ReadonlySet<TipoNotificacion> = new Set<TipoNotificacion>([
  'INVITACION_ACEPTADA',
  'INVITACION_RECHAZADA',
]);

/** Ventana para agrupar varios push seguidos en un único refresco. */
const RETARDO_REFRESCO_MS = 300;

type Filtro = 'todas' | 'pendientes';

type Resultado =
  { conSpinner: boolean; ok: InvitacionClub[] } | { conSpinner: boolean; fallo: unknown };

/** Invitaciones del club con su estado; permite cancelar las pendientes y se actualiza sola al responder la persona. */
@Component({
  selector: 'app-invitaciones-club',
  imports: [
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './invitaciones-club.html',
  styleUrl: './invitaciones-club.scss',
})
export class InvitacionesClub implements OnInit {
  private readonly invitacionService = inject(InvitacionService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly notificaciones = inject(NotificacionesStore);

  readonly clubId = input.required<number>();

  protected readonly invitaciones = signal<InvitacionClub[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly filtro = signal<Filtro>('todas');
  /** Invitación con una cancelación en vuelo. */
  protected readonly cancelando = signal<number | null>(null);

  protected readonly columnas = ['email', 'rol', 'estado', 'creada', 'caduca', 'acciones'];
  protected readonly etiquetaRol = ETIQUETA_ROL;
  protected readonly claseEstado = claseEstadoInvitacion;
  protected readonly formatearFechaHora = formatearFechaHora;

  /** `true` desde que una petición termina bien tras la última carga con spinner (la lista mostrada es real). */
  private cargadoConExito = false;

  /** Emite `true` si la carga debe mostrar el spinner o `false` si es un refresco silencioso. */
  private readonly cargar$ = new Subject<boolean>();

  constructor() {
    this.cargar$
      .pipe(
        switchMap((conSpinner) => this.consultar(conSpinner)),
        takeUntilDestroyed(),
      )
      .subscribe((resultado) => {
        if ('ok' in resultado) {
          this.cargadoConExito = true;
          this.invitaciones.set(resultado.ok);
          this.error.set(null);
        } else if (resultado.conSpinner || !this.cargadoConExito || this.error() !== null) {
          this.error.set(
            mensajeDeError(resultado.fallo, 'No se pudieron cargar las invitaciones.'),
          );
        }
        // un refresco silencioso que falla conserva lo que se veía, pero solo si ya se vio algo de verdad:
        // si relevó a una carga con spinner que nunca llegó a completarse, el fallo se muestra
        this.cargando.set(false);
      });

    // Alguien aceptó o rechazó: lo mostrado deja de ser cierto. Refresco silencioso agrupando ráfagas.
    this.notificaciones.recibidas$
      .pipe(
        filter((n) => TIPOS_QUE_AFECTAN.has(n.tipo)),
        debounceTime(RETARDO_REFRESCO_MS),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.cargar$.next(false));

    recargarAlRecuperarSesion(
      () => this.error() !== null,
      () => this.cargar(),
    );
  }

  /** `clubId` es un input requerido: no se puede leer en el constructor, solo a partir de ngOnInit. */
  ngOnInit(): void {
    this.cargar();
  }

  /** Refresco silencioso (sin spinner): lo usa quien acaba de invitar. */
  recargar(): void {
    this.cargar$.next(false);
  }

  protected cargar(): void {
    // una carga con spinner (primera, filtro nuevo o Reintentar) vuelve a empezar: lo que hubiera ya no vale
    this.cargadoConExito = false;
    this.cargando.set(true);
    this.error.set(null);
    this.cargar$.next(true);
  }

  protected cambiarFiltro(filtro: Filtro): void {
    if (this.filtro() === filtro) {
      return;
    }
    this.filtro.set(filtro);
    this.cargar();
  }

  protected textoRol(invitacion: InvitacionClub): string {
    return this.etiquetaRol[invitacion.rol];
  }

  protected textoEstado(invitacion: InvitacionClub): string {
    return ETIQUETA_ESTADO_INVITACION[invitacion.estado];
  }

  protected puedeCancelar(invitacion: InvitacionClub): boolean {
    return invitacion.estado === 'PENDIENTE';
  }

  protected cancelar(invitacion: InvitacionClub): void {
    if (this.cancelando() !== null) {
      return;
    }
    const datos: ConfirmDialogData = {
      titulo: 'Cancelar invitación',
      mensaje: 'La persona ya no podrá aceptar esta invitación.',
      lineas: [
        { etiqueta: 'Correo', valor: invitacion.email },
        { etiqueta: 'Rol', valor: this.etiquetaRol[invitacion.rol] },
      ],
      textoConfirmar: 'Cancelar invitación',
      textoCancelar: 'Mantener',
    };
    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data: datos })
      .afterClosed()
      .subscribe((confirmado) => {
        if (confirmado) {
          this.ejecutarCancelacion(invitacion);
        }
      });
  }

  private ejecutarCancelacion(invitacion: InvitacionClub): void {
    this.cancelando.set(invitacion.id);
    this.invitacionService.cancelar(this.clubId(), invitacion.id).subscribe({
      next: () => {
        this.cancelando.set(null);
        this.aviso('Invitación cancelada.');
        this.cargar$.next(false);
      },
      error: (err: unknown) => {
        this.cancelando.set(null);
        this.aviso(mensajeDeError(err, 'No se pudo cancelar la invitación. Inténtalo de nuevo.'));
        // 404/409: ya no está pendiente (la aceptó, caducó...): se muestra el estado real
        if (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 409)) {
          this.cargar$.next(false);
        }
      },
    });
  }

  private consultar(conSpinner: boolean): Observable<Resultado> {
    const estado = this.filtro() === 'pendientes' ? 'PENDIENTE' : undefined;
    return this.invitacionService.listar(this.clubId(), estado).pipe(
      map((ok): Resultado => ({ conSpinner, ok })),
      catchError((fallo: unknown) => of<Resultado>({ conSpinner, fallo })),
    );
  }

  private aviso(mensaje: string): void {
    this.snack.open(mensaje, 'Cerrar', { duration: 6000 });
  }
}
