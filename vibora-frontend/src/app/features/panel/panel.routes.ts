import { Routes } from '@angular/router';
import { adminClubGuard } from '../../core/auth/auth.guard';

/** Cuelga de `/panel` (con authGuard). Solo el administrador del club; el resto vuelve a la agenda. */
export const PANEL_ROUTES: Routes = [
  {
    path: '',
    title: 'Panel · Víbora',
    canActivate: [adminClubGuard],
    loadComponent: () => import('./panel/panel').then((m) => m.Panel),
  },
];
