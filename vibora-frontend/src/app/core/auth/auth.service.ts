import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, Injector, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import {
  Observable,
  catchError,
  filter,
  finalize,
  map,
  of,
  switchMap,
  tap,
  throwError,
  timeout,
} from 'rxjs';
import {
  LoginRequest,
  RegistroRequest,
  TokenResponse,
  Usuario,
} from '../../shared/models/usuario.model';
import { tokenCaducado } from './jwt.util';

export const CLAVE_TOKEN = 'vibora.token';

/** Cuánto esperar a /me al arrancar antes de dar el backend por inalcanzable (el arranque no puede colgarse). */
const TIMEOUT_ME_MS = 8000;
/** Reintento automático de /me: 2 s, 4 s, 8 s... con tope de 30 s. */
const ESPERA_BASE_MS = 2000;
const ESPERA_MAX_MS = 30_000;

/*
 * El token vive en localStorage: sobrevive a recargas, pero cualquier XSS puede leerlo. Una cookie
 * httpOnly lo evitaría, pero exige que el backend la emita y proteger contra CSRF; hoy el backend es
 * un API stateless con Bearer. Se asume el trade-off mientras no haya contenido de terceros en la app
 * (y la CSP / el escapado de Angular reducen el riesgo de XSS).
 */
function leerTokenGuardado(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN);
  } catch {
    return null; // almacenamiento no disponible (modo privado estricto, etc.)
  }
}

function guardarToken(token: string | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(CLAVE_TOKEN);
    } else {
      localStorage.setItem(CLAVE_TOKEN, token);
    }
  } catch {
    // sin almacenamiento: la sesión dura lo que dure la pestaña
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly token = signal<string | null>(null);
  readonly usuario = signal<Usuario | null>(null);
  /** true si hay token pero no se pudo contactar con el backend para cargar el usuario (se reintenta sola). */
  readonly sesionIncierta = signal(false);
  private readonly injector = inject(Injector);
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private quitarDisparadores: (() => void) | null = null;
  private intentos = 0;
  private reintentando = false;
  private destruido = false;
  /** Destino al que un guard negó el paso solo porque el usuario aún no estaba cargado (sesión incierta). */
  private destino: { url: string; cumple: () => boolean } | null = null;
  readonly estaAutenticado = computed(() => this.token() !== null);
  readonly rol = computed(() => this.usuario()?.rol ?? null);
  /** Club del usuario según /me (null si no tiene). */
  readonly clubId = computed(() => this.usuario()?.clubId ?? null);
  readonly clubNombre = computed(() => this.usuario()?.clubNombre ?? null);
  readonly esAdminClub = computed(() => this.rol() === 'ADMIN_CLUB');
  /** Un jugador sin club puede crear el suyo (y pasar a administrarlo). */
  readonly puedeCrearClub = computed(() => this.rol() === 'JUGADOR' && this.clubId() === null);

  constructor() {
    // Un servicio destruido (TestBed, HMR) no debe dejar listeners ni temporizadores vivos
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true; // las respuestas que lleguen después no tocan nada (el injector ya no existe)
      this.dejarDeReintentar();
    });
    const guardado = leerTokenGuardado();
    if (guardado !== null && tokenCaducado(guardado)) {
      guardarToken(null); // caducado: ni siquiera preguntamos al backend
    } else {
      this.token.set(guardado);
    }
  }

  login(email: string, password: string): Observable<Usuario> {
    const peticion: LoginRequest = { email, password };
    return this.http.post<TokenResponse>('/api/auth/login', peticion).pipe(
      tap((respuesta) => {
        this.token.set(respuesta.token);
        guardarToken(respuesta.token);
      }),
      switchMap(() => this.http.get<Usuario>('/api/auth/me')),
      tap((usuario) => {
        this.destino = null; // una sesión nueva no hereda destinos de la anterior
        this.usuario.set(usuario);
        this.sesionIncierta.set(false);
        this.dejarDeReintentar();
      }),
      catchError((err: unknown) => {
        this.limpiarSesion();
        return throwError(() => err);
      }),
    );
  }

  /**
   * Un guard que deniega SOLO porque el usuario aún no se ha podido cargar (sesión incierta) deja aquí el destino
   * pedido: cuando /me responda se navega una vez a él si el usuario cumple la condición. El backend sigue siendo
   * quien autoriza de verdad; esto solo evita perder el enlace profundo.
   */
  recordarDestino(url: string, cumple: () => boolean): void {
    if (this.sesionIncierta() && this.token() !== null && this.usuario() === null) {
      this.destino = { url, cumple };
    }
  }

  /** URL recordada por un guard durante la sesión incierta (null si no hay). */
  get destinoPendiente(): string | null {
    return this.destino?.url ?? null;
  }

  /** Crea la cuenta (siempre JUGADOR). No abre sesión: el llamante hace login a continuación. */
  registro(datos: RegistroRequest): Observable<Usuario> {
    return this.http.post<Usuario>('/api/auth/registro', datos);
  }

  logout(): void {
    this.limpiarSesion();
  }

  /**
   * Para el arranque: si hay token vigente recupera el usuario; nunca falla ni se cuelga (devuelve null).
   * Solo un 401/403 de /me cierra la sesión. Si el backend no responde (sin red, 5xx, timeout) el token se
   * conserva, `sesionIncierta` pasa a true y se reintenta sola (al navegar, al volver la red y con retardo creciente).
   */
  cargarUsuario(): Observable<Usuario | null> {
    if (this.token() === null) {
      return of(null);
    }
    return this.consultarMe();
  }

  /** Reintenta ahora cargar el usuario (si la sesión está incierta y no hay ya una petición en vuelo). */
  reintentarCarga(): void {
    if (!this.sesionIncierta() || this.token() === null || this.reintentando) {
      return;
    }
    this.cancelarTemporizador();
    this.reintentando = true;
    this.consultarMe()
      .pipe(finalize(() => (this.reintentando = false)))
      .subscribe();
  }

  private consultarMe(): Observable<Usuario | null> {
    // Con qué sesión se envió: si al volver el token ya es otro (logout, otro login) la respuesta no es de esta sesión
    const tokenEnviado = this.token();
    const vigente = (): boolean => !this.destruido && this.token() === tokenEnviado;
    return this.http.get<Usuario>('/api/auth/me').pipe(
      timeout({ first: TIMEOUT_ME_MS }),
      tap((usuario) => {
        if (!vigente()) {
          return;
        }
        this.usuario.set(usuario);
        this.sesionIncierta.set(false);
        this.dejarDeReintentar();
        this.restaurarDestino();
      }),
      map((usuario): Usuario | null => (vigente() ? usuario : null)),
      catchError((err: unknown) => {
        if (!vigente()) {
          return of(null); // respuesta de una sesión que ya no existe: ni cierra la de ahora ni programa reintentos
        }
        if (err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403)) {
          this.limpiarSesion(); // el token ya no vale
        } else {
          this.marcarIncierta(); // el backend no contesta: el token puede seguir siendo bueno
        }
        return of(null);
      }),
    );
  }

  /** Navega UNA vez al destino recordado (y lo olvida siempre) si el usuario ya cumple y sigue en la agenda. */
  private restaurarDestino(): void {
    const destino = this.destino;
    this.destino = null;
    if (destino === null || !destino.cumple()) {
      return;
    }
    const router = this.injector.get(Router);
    if (router.url.split(/[?#]/)[0] === '/agenda') {
      void router.navigateByUrl(destino.url);
    }
  }

  private marcarIncierta(): void {
    this.sesionIncierta.set(true);
    if (this.quitarDisparadores === null) {
      const alReintentar = (): void => this.reintentarCarga();
      const navegacion = this.injector
        .get(Router)
        .events.pipe(filter((evento) => evento instanceof NavigationEnd))
        .subscribe(alReintentar);
      window.addEventListener('online', alReintentar);
      this.quitarDisparadores = () => {
        navegacion.unsubscribe();
        window.removeEventListener('online', alReintentar);
      };
    }
    this.cancelarTemporizador();
    const espera = Math.min(ESPERA_BASE_MS * 2 ** this.intentos, ESPERA_MAX_MS);
    this.intentos++;
    this.temporizador = setTimeout(() => this.reintentarCarga(), espera);
  }

  private cancelarTemporizador(): void {
    if (this.temporizador !== null) {
      clearTimeout(this.temporizador);
      this.temporizador = null;
    }
  }

  private dejarDeReintentar(): void {
    this.cancelarTemporizador();
    this.quitarDisparadores?.();
    this.quitarDisparadores = null;
    this.intentos = 0;
  }

  private limpiarSesion(): void {
    this.token.set(null);
    this.usuario.set(null);
    this.destino = null;
    this.sesionIncierta.set(false);
    this.dejarDeReintentar();
    guardarToken(null);
  }
}
