import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, Injector, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import {
  Observable,
  catchError,
  defer,
  filter,
  finalize,
  firstValueFrom,
  from,
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
import { expiraEnMs } from './jwt.util';

/** Clave que usaban las versiones anteriores para guardar el token: hoy solo se borra, nunca se lee ni se escribe. */
export const CLAVE_TOKEN_LEGADO = 'vibora.token';
/** Pista NO secreta ("este navegador tuvo sesión"): decide si al arrancar se intenta restaurarla con la cookie. */
export const CLAVE_SESION = 'vibora.sesion';
/** Nombre del lock (Web Locks API) que serializa los refrescos entre pestañas. */
const NOMBRE_LOCK = 'vibora-refresco';
/** El refresco proactivo se adelanta tanto a la caducidad del token, para no cortar el WebSocket. */
const ANTELACION_REFRESCO_MS = 60_000;
/** Suelo de la espera del refresco proactivo: un token casi caducado no puede provocar un bucle de refrescos. */
const ESPERA_MINIMA_REFRESCO_MS = 5000;

/**
 * Tope de espera de las llamadas que retienen el lock (refrescar y cerrar-sesion): un backend colgado no puede
 * bloquear el arranque ni retener el lock para siempre. Es largo a propósito: la rotación es estricta, y abortar una
 * petición que el servidor ya procesó deja al navegador con la cookie vieja; el siguiente refresco la reutilizaría y
 * revocaría toda la sesión. Por eso solo debe saltar ante un backend realmente colgado, no ante uno lento.
 */
const TIMEOUT_REFRESCO_MS = 30_000;
/** Backoff del refresco tras un fallo que no es 401: 30 s, 60 s... con tope de 5 min. */
const ESPERA_REINTENTO_REFRESCO_MS = 30_000;
const ESPERA_MAX_REINTENTO_REFRESCO_MS = 300_000;
/** Tope absoluto (15 min) de cualquier espera antes de llamar a setTimeout. */
const TOPE_ABSOLUTO_ESPERA_MS = 900_000;
/** El reintento nunca se programa más tarde que la caducidad del token menos este margen. */
const MARGEN_CADUCIDAD_MS = 10_000;

/** Cuánto esperar a /me al arrancar antes de dar el backend por inalcanzable (el arranque no puede colgarse). */
const TIMEOUT_ME_MS = 8000;
/** Reintento automático de /me: 2 s, 4 s, 8 s... con tope de 30 s. */
const ESPERA_BASE_MS = 2000;
const ESPERA_MAX_MS = 30_000;

/** El refresco no se hizo o se descartó porque la sesión se cerró (logout/login) mientras esperaba o viajaba. */
export class SesionCerradaError extends Error {
  constructor(mensaje = 'La sesión se cerró antes de completar el refresco') {
    super(mensaje);
    this.name = 'SesionCerradaError';
  }
}

/*
 * El access token vive SOLO en memoria (la señal `token`): un XSS ya no puede leerlo de localStorage ni
 * llevárselo para usarlo después. Lo que sobrevive a una recarga es la cookie httpOnly del refresh token
 * (que JavaScript no puede leer) y una pista no secreta en localStorage para saber si merece la pena
 * intentar restaurar la sesión al arrancar.
 */
function hayPistaDeSesion(): boolean {
  try {
    return localStorage.getItem(CLAVE_SESION) !== null;
  } catch {
    return false; // almacenamiento no disponible (modo privado estricto, etc.)
  }
}

function guardarPista(hay: boolean): void {
  try {
    if (hay) {
      localStorage.setItem(CLAVE_SESION, '1');
    } else {
      localStorage.removeItem(CLAVE_SESION);
    }
  } catch {
    // sin almacenamiento: la sesión dura lo que dure la pestaña
  }
}

function borrarTokenLegado(): void {
  try {
    localStorage.removeItem(CLAVE_TOKEN_LEGADO);
  } catch {
    // nada que borrar si no hay almacenamiento
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
  /** Refresco en vuelo en esta pestaña: todas las llamadas simultáneas comparten esta promesa (single-flight). */
  private refrescoEnCurso: Promise<string> | null = null;
  private refrescoProgramado: ReturnType<typeof setTimeout> | null = null;
  /** Sube con cada cierre de sesión: el resultado de un refresco de una época anterior se descarta. */
  private epoca = 0;
  /** Reintentos consecutivos del refresco tras un fallo que no es 401 (para el backoff). */
  private intentosRefresco = 0;
  /** "No refrescar antes de T": fijado por el camino del temporizador al programar un reintento (429 o backoff). */
  private noRefrescarAntesDe = 0;
  /** Último fallo del refresco, con el que se rechazan al instante las llamadas hechas dentro de la ventana. */
  private ultimoErrorRefresco: unknown = null;
  /** El refresco dio 401 y limpió la sesión: queda UN expirarSesion() pendiente de llevar al login. */
  private expiradaPorServidor = false;
  /** Destino al que un guard negó el paso solo porque el usuario aún no estaba cargado (sesión incierta). */
  private destino: { url: string; cumple: () => boolean } | null = null;
  /** Época de la sesión (sube con cada cierre y cada login): el interceptor la usa para no reutilizar un 401 ajeno. */
  get epocaSesion(): number {
    return this.epoca;
  }
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
      this.cancelarRefrescoProgramado();
    });
    borrarTokenLegado(); // las versiones anteriores lo guardaban en claro en localStorage
  }

  login(email: string, password: string): Observable<Usuario> {
    const peticion: LoginRequest = { email, password };
    // Pasa por el mismo lock que refrescar y cerrar-sesion: se serializa tras un refresco en vuelo y tras un
    // cerrar-sesion en cola (que así revoca solo la cookie VIEJA) y un Set-Cookie tardío de un refresco no pisa la del login
    return defer(() => {
      // Un login fallido NO toca la sesión existente: solo se limpia si este login ya aplicó su propio token
      let aplicado = false;
      return from(
        this.conLock(async () => {
          const respuesta = await firstValueFrom(
            this.http
              .post<TokenResponse>('/api/auth/login', peticion)
              .pipe(timeout({ first: TIMEOUT_REFRESCO_MS })),
          );
          // Un login abre una época nueva: un refresco encolado o en vuelo de antes no debe aplicarse encima.
          // Se hace dentro del lock, nada más resolver el POST, para que no quede hueco con el refresco siguiente
          this.epoca++;
          this.refrescoEnCurso = null;
          return respuesta;
        }),
      ).pipe(
        tap((respuesta) => {
          aplicado = true;
          this.aplicarToken(respuesta.token);
        }),
        switchMap(() => this.http.get<Usuario>('/api/auth/me')),
        tap((usuario) => {
          this.destino = null; // una sesión nueva no hereda destinos de la anterior
          this.usuario.set(usuario);
          this.sesionIncierta.set(false);
          this.dejarDeReintentar();
        }),
        catchError((err: unknown) => {
          if (aplicado) {
            this.limpiarSesion();
          }
          return throwError(() => err);
        }),
      );
    });
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

  /**
   * Cierra la sesión: avisa al backend para que revoque el refresh token de este navegador y limpia el estado
   * local SIEMPRE, aunque la llamada falle (sin red, 500): el usuario ya ha decidido salir.
   */
  logout(): void {
    this.limpiarSesion(); // el estado local se limpia al instante: la interfaz no espera al servidor
    // La llamada al servidor entra en la misma cola que los refrescos: así espera a uno en vuelo y presenta la
    // cookie más reciente (si el refresco rotó la cookie, enviar la vieja revocaría toda la familia)
    // Con timeout: un servidor colgado no puede retener el lock y bloquear los refrescos y logins siguientes
    this.conLock(() =>
      firstValueFrom(
        this.http.post('/api/auth/cerrar-sesion', {}).pipe(timeout({ first: TIMEOUT_REFRESCO_MS })),
      ),
    ).catch(() => undefined);
  }

  /**
   * La sesión terminó por decisión del servidor (el refresh token ya no vale): se limpia el estado local SIN
   * llamar a cerrar-sesion (ya no hay nada que revocar) y se lleva al login conservando a dónde iba el usuario.
   * Es idempotente: sin sesión que expirar, o ya en /login, no navega (no pisa el redirectTo existente).
   */
  expirarSesion(): void {
    const habiaSesion =
      this.token() !== null || this.usuario() !== null || this.expiradaPorServidor;
    this.expiradaPorServidor = false;
    if (!habiaSesion) {
      return;
    }
    if (this.token() !== null || this.usuario() !== null) {
      this.limpiarSesion();
    }
    const router = this.injector.get(Router);
    const destino = router.url;
    if (destino.startsWith('/login')) {
      return;
    }
    const queryParams = destino === '/' ? {} : { redirectTo: destino };
    void router.navigate(['/login'], { queryParams });
  }

  /**
   * ÚNICO camino de refresco. Dentro de la pestaña es single-flight (las llamadas simultáneas comparten la misma
   * petición); entre pestañas se serializa con un lock de Web Locks, porque el backend trata dos refrescos
   * concurrentes con la misma cookie como robo de token y revoca toda la familia. Al obtener el lock SIEMPRE se
   * llama al endpoint: la cookie es compartida, así que la pestaña que espera envía la cookie ya rotada.
   *
   * 401 → sesión terminada (se limpia el estado). 429 u otro fallo → se propaga SIN tocar la sesión ("reintenta más tarde").
   */
  refrescar(): Promise<string> {
    return this.refrescarInterno(false);
  }

  private refrescarInterno(desdeTemporizador: boolean): Promise<string> {
    if (this.refrescoEnCurso !== null) {
      return this.refrescoEnCurso;
    }
    // Ventana de un 429 / backoff pendiente: ni el interceptor ni el WebSocket envían nada, solo el temporizador
    if (!desdeTemporizador && Date.now() < this.noRefrescarAntesDe) {
      return Promise.reject(this.ultimoErrorRefresco);
    }
    const epoca = this.epoca;
    const refresco: Promise<string> = this.conLock(() => {
      // Pudo esperar mucho en la cola: si mientras tanto hubo logout o login, ya no hay nada que refrescar
      if (this.destruido || epoca !== this.epoca) {
        return Promise.reject(new SesionCerradaError('La sesión se cerró antes de refrescar'));
      }
      return firstValueFrom(
        this.http
          .post<TokenResponse>('/api/auth/refrescar', {})
          .pipe(timeout({ first: TIMEOUT_REFRESCO_MS })), // un backend colgado no puede bloquear el arranque ni el lock
      );
    })
      .then(
        (respuesta) => {
          if (this.destruido || epoca !== this.epoca) {
            throw new SesionCerradaError('La sesión se cerró mientras se refrescaba'); // no se reabre una sesión cerrada
          }
          this.aplicarToken(respuesta.token);
          return respuesta.token;
        },
        (err: unknown) => {
          if (epoca !== this.epoca) {
            // La respuesta es de una sesión que ya se cerró: no debe cerrar la actual ni parecer un 401 vigente
            throw new SesionCerradaError('La sesión se cerró mientras se refrescaba');
          }
          if (err instanceof HttpErrorResponse && err.status === 401) {
            this.limpiarSesion();
            this.expiradaPorServidor = true; // permite a quien reciba el 401 llamar a expirarSesion() una vez
          } else if (this.token() !== null && !this.destruido) {
            this.reintentarRefresco(err); // 429, red o timeout: la sesión sigue, se reintenta sola
          }
          throw err;
        },
      )
      .finally(() => {
        if (this.refrescoEnCurso === refresco) {
          this.refrescoEnCurso = null;
        }
      });
    this.refrescoEnCurso = refresco;
    return refresco;
  }

  private async conLock<T>(tarea: () => Promise<T>): Promise<T> {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    // Sin Web Locks (navegador antiguo) solo queda el single-flight de la pestaña
    if (!locks) {
      return tarea();
    }
    let iniciada = false;
    try {
      // La señal acota solo la ESPERA del lock (una vez concedido, abortar ya no tiene efecto): otra pestaña colgada
      // no puede dejar el arranque esperando para siempre
      const signal = AbortSignal.timeout(TIMEOUT_REFRESCO_MS);
      return (await locks.request(NOMBRE_LOCK, { signal }, () => {
        iniciada = true;
        return tarea();
      })) as T;
    } catch (err) {
      if (iniciada) {
        throw err; // falló la tarea, no el lock
      }
      if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        throw err; // la espera del lock se agotó: se trata como un fallo de red (sin logout ni borrar la pista)
      }
      return tarea(); // el propio request rechazó (p. ej. SecurityError): se sigue sin lock
    }
  }

  private aplicarToken(token: string): void {
    this.token.set(token);
    this.expiradaPorServidor = false;
    this.intentosRefresco = 0;
    this.noRefrescarAntesDe = 0;
    this.ultimoErrorRefresco = null;
    guardarPista(true);
    this.programarRefresco(token);
  }

  /** Refresca ~60 s antes de que caduque el token (leído del claim `exp` sin verificarlo: lo verifica el servidor). */
  private programarRefresco(token: string): void {
    const expira = expiraEnMs(token);
    if (expira === null) {
      this.cancelarRefrescoProgramado();
      return;
    }
    this.armarRefresco(Math.max(expira - ANTELACION_REFRESCO_MS - Date.now(), ESPERA_MINIMA_REFRESCO_MS));
  }

  private armarRefresco(espera: number): void {
    this.cancelarRefrescoProgramado();
    this.refrescoProgramado = setTimeout(() => {
      this.refrescoProgramado = null;
      this.refrescarInterno(true).catch((err: unknown) => {
        // Un 401 que llega aquí es siempre de la sesión vigente: refrescar() descarta los de sesiones cerradas.
        // Los demás fallos (429, red) ya los reintenta refrescar() por su cuenta.
        if (err instanceof HttpErrorResponse && err.status === 401) {
          this.expirarSesion();
        }
      });
    }, espera);
  }

  /**
   * Tras un fallo que no es 401 reprograma el refresco: respeta `Retry-After` en un 429 o, si no, un backoff de
   * 30 s que se duplica hasta 5 min; nunca más tarde de la caducidad del token (menos un margen). Al renovarse el
   * token, quien lo observa (p. ej. el WebSocket) reconecta solo.
   */
  private reintentarRefresco(err: unknown): void {
    const retryAfter = err instanceof HttpErrorResponse ? Number(err.headers?.get('Retry-After')) : NaN;
    // Tope también para Retry-After: un valor enorme desbordaría setTimeout (y dejaría la sesión sin reintento)
    let espera = Math.min(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : ESPERA_REINTENTO_REFRESCO_MS * 2 ** this.intentosRefresco,
      ESPERA_MAX_REINTENTO_REFRESCO_MS,
      TOPE_ABSOLUTO_ESPERA_MS,
    );
    this.intentosRefresco++; // cuenta cada petición realmente enviada que falla; el rechazo inmediato de la ventana no llega aquí
    const token = this.token();
    const expira = token === null ? null : expiraEnMs(token);
    if (expira !== null) {
      const restante = expira - MARGEN_CADUCIDAD_MS - Date.now();
      // El tope solo rige mientras el token sigue siendo válido: con uno ya caducado no hay nada que proteger y
      // recortar a 5 s provocaría un bucle de refrescos ignorando Retry-After y el backoff
      if (restante > 0) {
        espera = Math.min(espera, restante);
      }
    }
    espera = Math.max(espera, ESPERA_MINIMA_REFRESCO_MS);
    this.noRefrescarAntesDe = Date.now() + espera;
    this.ultimoErrorRefresco = err;
    this.armarRefresco(espera);
  }

  private cancelarRefrescoProgramado(): void {
    if (this.refrescoProgramado !== null) {
      clearTimeout(this.refrescoProgramado);
      this.refrescoProgramado = null;
    }
  }

  /**
   * Para el arranque: recupera el usuario; nunca falla ni se cuelga (devuelve null).
   * Sin token en memoria pero con la pista de sesión, primero restaura la sesión con la cookie (refrescar).
   * Un 401 deja anónimo y borra la pista; un 429 o un fallo de red dejan anónimo SIN borrarla (el refresh token
   * puede seguir siendo válido: se reintenta en la próxima carga o al iniciar sesión).
   * Solo un 401/403 de /me cierra la sesión. Si el backend no responde (sin red, 5xx, timeout) el token se
   * conserva, `sesionIncierta` pasa a true y se reintenta sola (al navegar, al volver la red y con retardo creciente).
   */
  cargarUsuario(): Observable<Usuario | null> {
    if (this.token() !== null) {
      return this.consultarMe();
    }
    if (!hayPistaDeSesion()) {
      return of(null);
    }
    return from(this.refrescar()).pipe(
      switchMap(() => this.consultarMe()),
      catchError(() => of(null)),
    );
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
    // (se compara la época, no el token: un refresco que renueva el token de la MISMA sesión no invalida la respuesta)
    const epoca = this.epoca;
    const vigente = (): boolean => !this.destruido && this.epoca === epoca && this.token() !== null;
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
    this.cancelarRefrescoProgramado();
    this.epoca++;
    this.refrescoEnCurso = null;
    this.intentosRefresco = 0;
    this.noRefrescarAntesDe = 0;
    this.ultimoErrorRefresco = null;
    guardarPista(false);
  }
}
