import { Routes } from '@angular/router';

/** Cuelga de `/invitaciones` (con authGuard). Las invitaciones son de cualquier usuario autenticado; el backend decide. */
export const INVITACIONES_ROUTES: Routes = [
  {
    path: '',
    title: 'Invitaciones · Víbora',
    loadComponent: () =>
      import('./mis-invitaciones/mis-invitaciones').then((m) => m.MisInvitaciones),
  },
];
