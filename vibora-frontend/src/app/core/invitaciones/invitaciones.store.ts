import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { InvitacionMia } from '../../shared/models/invitacion.model';
import { InvitacionService } from '../api/invitacion.service';
import { AuthService } from '../auth/auth.service';
import { mensajeDeError } from '../http/error.util';
import { NotificacionesStore } from '../notificaciones/notificaciones.store';

/**
 * Mis invitaciones pendientes (como invitado): alimentan la pantalla `/invitaciones` y la insignia del menú.
 * La verdad vive en el backend; el push `INVITACION_RECIBIDA` solo avisa de que hay que volver a pedirlas.
 * Nunca lanza: con el backend inaccesible conserva lo que hay.
 */
@Injectable({ providedIn: 'root' })
export class InvitacionesStore {
  private readonly auth = inject(AuthService);
  private readonly api = inject(InvitacionService);
  private readonly notificaciones = inject(NotificacionesStore);

  private readonly _items = signal<InvitacionMia[]>([]);
  private readonly _cargando = signal(false);
  private readonly _error = signal<string | null>(null);
  readonly items = this._items.asReadonly();
  readonly cargando = this._cargando.asReadonly();
  readonly error = this._error.asReadonly();
  /** Cuántas invitaciones pendientes tiene (insignia del menú). */
  readonly pendientes = computed(() => this._items().length);

  /** Cambia con cada inicio/cierre de sesión: descarta respuestas HTTP de una sesión anterior. */
  private generacion = 0;

  /** Número de la última petición lanzada: una respuesta más vieja que ella ya no escribe nada. */
  private ultimaPeticion = 0;

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => {
        this.generacion++;
        this._items.set([]);
        this._error.set(null);
        this._cargando.set(false);
        if (token !== null) {
          this.recargar();
        }
      });
    });

    // Cuando el backend vuelve tras una caída, lo que se ve pudo quedarse viejo (o vacío)
    let eraIncierta = this.auth.sesionIncierta();
    effect(() => {
      const esIncierta = this.auth.sesionIncierta();
      if (eraIncierta && !esIncierta) {
        untracked(() => this.recargar(true));
      }
      eraIncierta = esIncierta;
    });

    this.notificaciones.recibidas$
      .pipe(
        filter((n) => n.tipo === 'INVITACION_RECIBIDA'),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => this.recargar(true));
  }

  /**
   * Vuelve a pedir la lista. Con `silencioso` no toca el estado de carga ni de error: si falla, se conserva lo que
   * se veía.
   */
  recargar(silencioso = false): void {
    if (this.auth.token() === null) {
      return;
    }
    const generacion = this.generacion;
    const peticion = ++this.ultimaPeticion;
    // Una petición silenciosa que releva a una carga visible aún en curso hereda su visibilidad: si falla, el
    // error se muestra en vez de dejar una lista vacía que parece cierta.
    const visible = !silencioso || this._cargando();
    if (visible) {
      this._cargando.set(true);
      this._error.set(null);
    }
    // Solo la última petición (de la sesión actual) puede escribir estado o apagar `cargando`
    const vigente = (): boolean =>
      generacion === this.generacion && peticion === this.ultimaPeticion;
    this.api.mias().subscribe({
      next: (items) => {
        if (!vigente()) {
          return;
        }
        this._items.set(items);
        this._error.set(null);
        this._cargando.set(false);
      },
      error: (err: unknown) => {
        if (!vigente()) {
          return;
        }
        if (visible) {
          this._error.set(mensajeDeError(err, 'No se pudieron cargar tus invitaciones.'));
        }
        this._cargando.set(false);
      },
    });
  }

  /** Quita una invitación ya resuelta sin esperar a otra petición. */
  retirar(id: number): void {
    this._items.update((items) => items.filter((i) => i.id !== id));
  }
}
