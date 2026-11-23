import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Usuario } from '../../shared/models/usuario.model';
import {
  USUARIO_ADMIN,
  USUARIO_JUGADOR,
  crearJwt,
  segundosDesdeAhora,
} from '../../testing/test-utils';
import {
  adminClubGuard,
  authGuard,
  invitadoGuard,
  redirigirRaiz,
  sinClubGuard,
} from './auth.guard';
import { AuthService } from './auth.service';

describe('guards de autenticación', () => {
  function ejecutar(guard: CanActivateFn, url: string, conSesion: boolean): boolean | string {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    if (conSesion) {
      TestBed.inject(AuthService).token.set(crearJwt(segundosDesdeAhora(3600)));
    }
    const router = TestBed.inject(Router);
    const resultado = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );
    return resultado instanceof UrlTree ? router.serializeUrl(resultado) : (resultado as boolean);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  describe('authGuard', () => {
    it('deja pasar a un usuario autenticado', () => {
      expect(ejecutar(authGuard, '/mis-reservas', true)).toBe(true);
    });

    it('redirige a /login conservando la URL pedida en redirectTo', () => {
      expect(ejecutar(authGuard, '/mis-reservas', false)).toBe('/login?redirectTo=%2Fmis-reservas');
    });
  });

  describe('guards de club', () => {
    function ejecutarConUsuario(guard: CanActivateFn, usuario: Usuario | null): boolean | string {
      TestBed.configureTestingModule({
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      TestBed.inject(AuthService).usuario.set(usuario);
      const router = TestBed.inject(Router);
      const resultado = TestBed.runInInjectionContext(() =>
        guard({} as ActivatedRouteSnapshot, { url: '/club' } as RouterStateSnapshot),
      );
      return resultado instanceof UrlTree ? router.serializeUrl(resultado) : (resultado as boolean);
    }

    it('adminClubGuard deja pasar al administrador de un club', () => {
      expect(ejecutarConUsuario(adminClubGuard, USUARIO_ADMIN)).toBe(true);
    });

    it('adminClubGuard manda a /agenda a un jugador', () => {
      expect(ejecutarConUsuario(adminClubGuard, USUARIO_JUGADOR)).toBe('/agenda');
    });

    it('adminClubGuard manda a /agenda a un monitor', () => {
      expect(ejecutarConUsuario(adminClubGuard, { ...USUARIO_ADMIN, rol: 'MONITOR' })).toBe(
        '/agenda',
      );
    });

    it('sinClubGuard deja pasar a un jugador sin club', () => {
      expect(ejecutarConUsuario(sinClubGuard, USUARIO_JUGADOR)).toBe(true);
    });

    it('sinClubGuard manda a /agenda a un administrador (ya tiene club)', () => {
      expect(ejecutarConUsuario(sinClubGuard, USUARIO_ADMIN)).toBe('/agenda');
    });
  });

  describe('con token pero sin usuario cargado (sesión incierta)', () => {
    let authIncierta: AuthService;

    function ejecutarIncierta(guard: CanActivateFn): boolean | string {
      TestBed.configureTestingModule({
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      const auth = TestBed.inject(AuthService);
      auth.token.set(crearJwt(segundosDesdeAhora(3600)));
      authIncierta = auth;
      auth.sesionIncierta.set(true);
      expect(auth.usuario()).toBeNull();
      const router = TestBed.inject(Router);
      const resultado = TestBed.runInInjectionContext(() =>
        guard({} as ActivatedRouteSnapshot, { url: '/club' } as RouterStateSnapshot),
      );
      return resultado instanceof UrlTree ? router.serializeUrl(resultado) : (resultado as boolean);
    }

    it('authGuard deja pasar: hay sesión, solo falta cargar el perfil', () => {
      expect(ejecutarIncierta(authGuard)).toBe(true);
    });

    it('adminClubGuard no lanza y manda a /agenda mientras no se sepa el rol', () => {
      expect(ejecutarIncierta(adminClubGuard)).toBe('/agenda');
    });

    it('sinClubGuard no lanza y manda a /agenda mientras no se sepa el rol', () => {
      expect(ejecutarIncierta(sinClubGuard)).toBe('/agenda');
    });

    it('invitadoGuard sigue rebotando a /agenda (el token existe)', () => {
      expect(ejecutarIncierta(invitadoGuard)).toBe('/agenda');
    });

    it('adminClubGuard recuerda la URL pedida para restaurarla cuando se cargue el usuario', () => {
      expect(ejecutarIncierta(adminClubGuard)).toBe('/agenda');
      expect(authIncierta.destinoPendiente).toBe('/club');
    });

    it('sinClubGuard recuerda la URL pedida para restaurarla cuando se cargue el usuario', () => {
      expect(ejecutarIncierta(sinClubGuard)).toBe('/agenda');
      expect(authIncierta.destinoPendiente).toBe('/club');
    });

    it('redirigirRaiz va a la agenda y recuerda /panel hasta que se sepa que es administrador', () => {
      TestBed.configureTestingModule({
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      const auth = TestBed.inject(AuthService);
      auth.token.set(crearJwt(segundosDesdeAhora(3600)));
      auth.sesionIncierta.set(true);

      expect(TestBed.runInInjectionContext(() => redirigirRaiz())).toBe('agenda');
      expect(auth.destinoPendiente).toBe('/panel');
    });

    it('authGuard e invitadoGuard no recuerdan nada', () => {
      ejecutarIncierta(authGuard);
      expect(authIncierta.destinoPendiente).toBeNull();
      TestBed.resetTestingModule();
      ejecutarIncierta(invitadoGuard);
      expect(authIncierta.destinoPendiente).toBeNull();
    });
  });

  describe('denegación con el usuario YA cargado (sesión no incierta)', () => {
    it('no recuerda destino: un jugador que pide /club simplemente va a /agenda', () => {
      TestBed.configureTestingModule({
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      const auth = TestBed.inject(AuthService);
      auth.token.set(crearJwt(segundosDesdeAhora(3600)));
      auth.usuario.set(USUARIO_JUGADOR);

      const resultado = TestBed.runInInjectionContext(() =>
        adminClubGuard({} as ActivatedRouteSnapshot, { url: '/club' } as RouterStateSnapshot),
      );

      expect(resultado instanceof UrlTree).toBe(true);
      expect(auth.destinoPendiente).toBeNull();
    });
  });

  describe('invitadoGuard', () => {
    it('deja pasar a un usuario sin sesión', () => {
      expect(ejecutar(invitadoGuard, '/login', false)).toBe(true);
    });

    it('manda a /agenda a quien ya tiene sesión', () => {
      expect(ejecutar(invitadoGuard, '/login', true)).toBe('/agenda');
    });

    it('manda al administrador del club a /panel', () => {
      TestBed.configureTestingModule({
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      TestBed.inject(AuthService).token.set(crearJwt(segundosDesdeAhora(3600)));
      TestBed.inject(AuthService).usuario.set(USUARIO_ADMIN);
      const router = TestBed.inject(Router);
      const resultado = TestBed.runInInjectionContext(() =>
        invitadoGuard({} as ActivatedRouteSnapshot, { url: '/login' } as RouterStateSnapshot),
      );
      expect(router.serializeUrl(resultado as UrlTree)).toBe('/panel');
    });
  });
});
