import { Routes } from '@angular/router';

/** Cuelga de `/facturas` (con authGuard): las facturas del usuario como receptor, sea cual sea su rol. */
export const FACTURAS_ROUTES: Routes = [
  {
    path: '',
    title: 'Mis facturas · Víbora',
    loadComponent: () => import('./mis-facturas/mis-facturas').then((m) => m.MisFacturas),
  },
];
