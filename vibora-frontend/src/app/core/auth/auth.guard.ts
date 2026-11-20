import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { rutaInicial } from './inicio';

/** Solo usuarios con sesión; si no, a /login recordando a dónde querían ir. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.estaAutenticado()
    ? true
    : router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });
};

/**
 * Deniega a la agenda. Si es SOLO porque el usuario aún no se ha podido cargar (sesión incierta, el backend no
 * contestó), recuerda a dónde iba para llevarle allí cuando se cargue y cumpla; el backend sigue siendo la autoridad.
 */
function irALaAgenda(auth: AuthService, router: Router, url: string, cumple: () => boolean) {
  auth.recordarDestino(url, cumple);
  return router.createUrlTree(['/agenda']);
}

/** Solo el administrador de un club; el resto vuelve a la agenda. */
export const adminClubGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.esAdminClub() ? true : irALaAgenda(auth, router, state.url, auth.esAdminClub);
};

/** Solo un jugador que aún no tiene club (puede crear el suyo); el resto vuelve a la agenda. */
export const sinClubGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.puedeCrearClub() ? true : irALaAgenda(auth, router, state.url, auth.puedeCrearClub);
};

/** Para login/registro: quien ya tiene sesión rebota a su pantalla inicial (el administrador, al panel). */
export const invitadoGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.estaAutenticado() ? router.createUrlTree([rutaInicial(auth.rol())]) : true;
};

/**
 * Destino de la ruta vacía (`/`): el administrador va a su panel y el resto a la agenda. Con la sesión incierta
 * (sin usuario cargado) va a la agenda pero recuerda el panel para llevarle allí en cuanto se sepa que es administrador.
 */
export const redirigirRaiz = (): string => {
  const auth = inject(AuthService);
  auth.recordarDestino('/panel', auth.esAdminClub);
  return rutaInicial(auth.rol()).slice(1);
};
