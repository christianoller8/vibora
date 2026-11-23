import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, from, of, switchMap, throwError } from 'rxjs';
import { AuthService, SesionCerradaError } from './auth.service';

const PREFIJO_API = '/api/';
// Estas rutas van solo con la cookie (el access token puede estar caducado o no existir): sin cabecera Authorization
const RUTAS_SOLO_COOKIE = ['/api/auth/refrescar', '/api/auth/cerrar-sesion'];
// Un 401 aquí significa "credenciales/cookie incorrectas", no "access token caducado": ni refrescar ni redirigir (evita bucles)
const RUTAS_SIN_REFRESCO = ['/api/auth/login', '/api/auth/registro', ...RUTAS_SOLO_COOKIE];

// Coincidencia EXACTA (ignorando query y fragmento): `/api/auth/cerrar-sesion` no debe atrapar `/api/auth/cerrar-sesion-todas`,
// que lleva su Bearer y sí refresca ante un 401
const coincide = (url: string, rutas: string[]): boolean => rutas.includes(url.split(/[?#]/)[0]);

const conToken = (req: HttpRequest<unknown>, token: string): HttpRequest<unknown> =>
  req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(PREFIJO_API)) {
    return next(req); // nunca mandamos el token a otros orígenes
  }
  if (coincide(req.url, RUTAS_SOLO_COOKIE)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const token = auth.token();
  const peticion = token ? conToken(req, token) : req;
  const epocaEnviada = auth.epocaSesion; // en qué sesión salió: un 401 de otra época no es de la sesión actual

  return next(peticion).pipe(
    catchError((err: unknown) => {
      const caducado =
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        token !== null &&
        !coincide(req.url, RUTAS_SIN_REFRESCO);
      return caducado
        ? reintentarTrasRefrescar(auth, req, next, token, epocaEnviada, err)
        : throwError(() => err);
    }),
  );
};

/**
 * El access token caducó: refresca (una sola vez aunque haya varios 401 a la vez) y repite la petición UNA vez con
 * el token nuevo. Si ese reintento también falla, el error sube tal cual: nunca hay un segundo refresco ni bucle.
 */
function reintentarTrasRefrescar(
  auth: AuthService,
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  tokenEnviado: string,
  epocaEnviada: number,
  errorOriginal: HttpErrorResponse,
): Observable<HttpEvent<unknown>> {
  const actual = auth.token();
  if (actual === null || auth.epocaSesion !== epocaEnviada) {
    // La sesión se cerró (o se abrió otra) mientras la petición viajaba: ese 401 no es de la sesión actual y repetirla
    // con el token de otra sesión mezclaría identidades
    return throwError(() => errorOriginal);
  }
  // Misma sesión: si otra petición ya renovó el token mientras esta viajaba, basta con repetirla con el actual
  const nuevoToken$ = actual !== tokenEnviado ? of(actual) : from(auth.refrescar());
  return nuevoToken$.pipe(
    catchError((errRefresco: unknown) => {
      if (errRefresco instanceof HttpErrorResponse && errRefresco.status === 401) {
        auth.expirarSesion(); // el refresh token ya no vale: sesión terminada, al login
        return throwError(() => errorOriginal);
      }
      if (errRefresco instanceof SesionCerradaError) {
        return throwError(() => errorOriginal); // la época se cerró (logout/login): el llamante ve su 401 real
      }
      return throwError(() => errRefresco); // 429, TimeoutError, red u otro fallo: se propaga tal cual, sin cerrar sesión
    }),
    switchMap((nuevo) => next(conToken(req, nuevo))),
  );
}
