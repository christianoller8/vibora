import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';

/** Antes de pintar nada recupera el usuario si hay token guardado. Nunca rechaza: sin red conserva la sesión. */
export const cargarUsuarioAlArrancar = () => inject(AuthService).cargarUsuario();

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])), // HttpClient + token Bearer en /api/
    provideAnimationsAsync(), // varios componentes de Material (ej. mat-sidenav) fallan sin esto
    provideAppInitializer(cargarUsuarioAlArrancar),
  ],
};
