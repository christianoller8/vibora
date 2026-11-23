import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, untracked } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Notificacion } from '../../shared/models/notificacion.model';
import { AuthService } from '../auth/auth.service';
import { ClienteTiempoReal, FABRICA_CLIENTE_TIEMPO_REAL } from './cliente-tiempo-real';
import { destinoNotificacion } from './notificacion-destino';
import { NotificacionesStore } from './notificaciones.store';

const DESTINO_NOTIFICACIONES = '/user/queue/notificaciones';
/** Mensaje del frame ERROR cuando el backend rechaza el JWT del CONNECT. */
const ERROR_NO_AUTENTICADO = 'No autenticado';

/**
 * Mantiene la conexión en tiempo real mientras haya sesión: conecta al iniciar sesión, desconecta al cerrarla
 * y entrega cada notificación empujada al store (más un aviso con acción "Ver").
 *
 * El token de acceso se renueva solo (refresco proactivo o por un 401 REST): cada vez que cambia la señal
 * `auth.token()` se cierra la conexión y se abre otra con el token nuevo en el CONNECT.
 *
 * Si el servidor rechaza el token ("No autenticado", p. ej. porque cerró el socket al caducar) se refresca UNA vez:
 * el token nuevo reconecta solo. Si el refresco da 401 la sesión terminó (al login); con 429 o sin red no se cierra
 * nada. Si el token recién refrescado también es rechazado se da la sesión por terminada en vez de entrar en bucle.
 */
@Injectable({ providedIn: 'root' })
export class TiempoRealService {
  private readonly auth = inject(AuthService);
  private readonly store = inject(NotificacionesStore);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly fabrica = inject(FABRICA_CLIENTE_TIEMPO_REAL);
  private readonly location = inject(DOCUMENT).location;

  private cliente: ClienteTiempoReal | null = null;
  /** Identifica la conexión vigente: los eventos de una anterior se ignoran. */
  private generacion = 0;
  /** Token obtenido al refrescar por un rechazo del servidor: si también es rechazado, no se vuelve a refrescar. */
  private tokenTrasRechazo: string | null = null;
  /** Hay un refresco pedido por un rechazo: el próximo token que llegue es "el recién refrescado". */
  private refrescandoPorRechazo = false;

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => {
        this.desconectar();
        if (token === null) {
          this.tokenTrasRechazo = null;
          this.refrescandoPorRechazo = false;
        } else {
          if (this.refrescandoPorRechazo) {
            // Se marca aquí, al llegar el token, y no en el .then de refrescar(): así no depende del orden de microtareas
            this.refrescandoPorRechazo = false;
            this.tokenTrasRechazo = token;
          }
          this.conectar(token);
        }
      });
    });
  }

  private conectar(token: string): void {
    const generacion = ++this.generacion;
    const vigente = (): boolean => generacion === this.generacion;
    const protocolo = this.location.protocol === 'https:' ? 'wss' : 'ws';

    this.fabrica({
      url: `${protocolo}://${this.location.host}/ws`,
      cabeceras: { Authorization: `Bearer ${token}` },
      destino: DESTINO_NOTIFICACIONES,
      alConectar: () => {
        if (vigente()) {
          this.tokenTrasRechazo = null; // CONNECT correcto: un rechazo posterior es uno nuevo, no un segundo rechazo seguido
          // mientras estuvimos desconectados pudo llegar algo que no se empujó
          this.store.recargar();
        }
      },
      alMensaje: (cuerpo) => {
        if (vigente()) {
          this.alRecibir(cuerpo);
        }
      },
      alErrorStomp: (mensaje) => {
        if (vigente() && mensaje.includes(ERROR_NO_AUTENTICADO)) {
          this.tokenRechazado(token);
        }
      },
    }).then(
      (cliente) => {
        if (!vigente()) {
          void cliente.desactivar(); // la sesión cambió mientras se cargaba la librería
          return;
        }
        this.cliente = cliente;
        cliente.activar();
      },
      () => {
        // la librería no se pudo cargar (sin red): la campana sigue funcionando por REST
      },
    );
  }

  private desconectar(): void {
    this.generacion++;
    const cliente = this.cliente;
    this.cliente = null;
    if (cliente) {
      void cliente.desactivar();
    }
  }

  private alRecibir(cuerpo: string): void {
    const notificacion = leerNotificacion(cuerpo);
    if (!notificacion) {
      return;
    }
    this.store.recibir(notificacion);
    this.snack
      .open(notificacion.mensaje, 'Ver', { duration: 8000 })
      .onAction()
      .subscribe(() => {
        this.store.marcarLeida(notificacion.id);
        const destino = destinoNotificacion(notificacion.tipo);
        if (destino) {
          void this.router.navigateByUrl(destino);
        }
      });
  }

  private tokenRechazado(rechazado: string): void {
    this.desconectar(); // la librería no debe reintentar con un token que ya no vale
    if (rechazado === this.tokenTrasRechazo) {
      // El token recién refrescado tampoco vale: se cierra la sesión revocándola en el servidor (logout) y se lleva
      // al login conservando a dónde iba el usuario
      const destino = this.router.url;
      this.auth.logout();
      if (!destino.startsWith('/login')) {
        void this.router.navigate(['/login'], {
          queryParams: destino === '/' ? {} : { redirectTo: destino },
        });
      }
      return;
    }
    this.refrescandoPorRechazo = true; // ANTES de esperar: al cambiar el token, el efecto del constructor lo marca y reconecta
    this.auth.refrescar().then(
      (nuevo) => {
        // Un token idéntico al rechazado no cambia la señal y el efecto no reconecta: se hace explícitamente
        if (nuevo === rechazado && this.auth.token() === nuevo) {
          this.refrescandoPorRechazo = false;
          this.tokenTrasRechazo = nuevo;
          this.conectar(nuevo);
        }
      },
      (err: unknown) => {
        this.refrescandoPorRechazo = false;
        if (err instanceof HttpErrorResponse && err.status === 401) {
          this.auth.expirarSesion();
        }
        // 429, sin red o sesión cerrada: AuthService reprograma el refresco (o un login nuevo cambia el token);
        // cuando el token cambie, el efecto reconecta, así que el socket no queda sin camino de vuelta
      },
    );
  }
}

/** Valida lo justo del JSON recibido: lo que no tenga forma de notificación se descarta. */
function leerNotificacion(cuerpo: string): Notificacion | null {
  let datos: unknown;
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    return null;
  }
  if (datos === null || typeof datos !== 'object') {
    return null;
  }
  const candidata = datos as Partial<Notificacion>;
  if (
    typeof candidata.id !== 'number' ||
    typeof candidata.tipo !== 'string' ||
    typeof candidata.mensaje !== 'string'
  ) {
    return null;
  }
  return candidata as Notificacion;
}
