import { Routes } from '@angular/router';
import { authGuard, redirigirRaiz } from './core/auth/auth.guard';

/*
 * ORDEN IMPORTANTE: el layout con redirección de '' va primero. Una ruta de path '' con loadChildren
 * "se come" la URL vacía aunque ningún hijo coincida, y '/' acabaría pintando el layout con un
 * router-outlet vacío. Para /login y /registro el primer grupo no encuentra hijo y el router
 * retrocede al segundo.
 */
export const routes: Routes = [
  {
    path: '',
    // el layout es el "marco" de las rutas hijas; carga diferida porque arrastra toolbar/sidenav/list de Material
    loadComponent: () => import('./core/layout/main-layout/main-layout').then((m) => m.MainLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: redirigirRaiz },
      {
        path: '',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/reservas/reservas.routes').then((m) => m.RESERVAS_ROUTES),
      },
      {
        path: 'partidos',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/partidos/partidos.routes').then((m) => m.PARTIDOS_ROUTES),
      },
      {
        path: 'deudas',
        canActivate: [authGuard],
        loadChildren: () => import('./features/deudas/deudas.routes').then((m) => m.DEUDAS_ROUTES),
      },
      {
        path: 'facturas',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/facturas/facturas.routes').then((m) => m.FACTURAS_ROUTES),
      },
      {
        path: 'incidencias',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/incidencias/incidencias.routes').then((m) => m.INCIDENCIAS_ROUTES),
      },
      {
        path: 'invitaciones',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/invitaciones/invitaciones.routes').then((m) => m.INVITACIONES_ROUTES),
      },
      {
        path: 'panel',
        canActivate: [authGuard],
        loadChildren: () => import('./features/panel/panel.routes').then((m) => m.PANEL_ROUTES),
      },
      {
        path: 'club',
        canActivate: [authGuard],
        loadChildren: () => import('./features/club/club.routes').then((m) => m.CLUB_ROUTES),
      },
    ],
  },
  {
    // login y registro: marco limpio, sin menú lateral
    path: '',
    // carga diferida: arrastra el selector de tema (botón e icono de Material), que no debe engordar el bundle inicial
    loadComponent: () => import('./core/layout/auth-layout/auth-layout').then((m) => m.AuthLayout),
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  { path: '**', redirectTo: 'agenda' },
];
