import { rutaInicial } from '../../core/auth/inicio';
import { Rol } from '../../shared/models/usuario.model';

export const DESTINO_POR_DEFECTO = '/agenda';

/**
 * Valida el `redirectTo` de la query string: solo rutas internas. Evita un open redirect del estilo
 * `/login?redirectTo=https://sitio-malo.com` o `//sitio-malo.com`.
 */
export function destinoSeguro(redirectTo: string | null): string {
  const esInterna =
    redirectTo !== null &&
    redirectTo.startsWith('/') &&
    !redirectTo.startsWith('//') &&
    !redirectTo.startsWith('/\\');
  return esInterna ? redirectTo : DESTINO_POR_DEFECTO;
}

/**
 * A dónde ir tras iniciar sesión. Un enlace profundo (`/club`, `/mis-reservas`...) se respeta tal cual; la agenda es
 * el destino por defecto (también lo que pone el router al venir de `/`), no una petición concreta, así que ahí
 * cada rol aterriza en su pantalla inicial.
 */
export function destinoTrasLogin(redirectTo: string | null, rol: Rol): string {
  const destino = destinoSeguro(redirectTo);
  return destino === DESTINO_POR_DEFECTO ? rutaInicial(rol) : destino;
}
