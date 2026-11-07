import { effect, inject, untracked } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Para las páginas de listado: cuando la sesión pasa de incierta a confirmada (el backend volvió tras una caída),
 * vuelve a cargar SOLO si la página se había quedado en un estado de error. Hay que llamarla en el constructor
 * (contexto de inyección); el efecto se destruye con el componente.
 */
export function recargarAlRecuperarSesion(enError: () => boolean, recargar: () => void): void {
  const auth = inject(AuthService);
  let eraIncierta = auth.sesionIncierta();
  effect(() => {
    const esIncierta = auth.sesionIncierta();
    if (eraIncierta && !esIncierta && untracked(enError)) {
      untracked(recargar);
    }
    eraIncierta = esIncierta;
  });
}
