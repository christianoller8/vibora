import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationStart, Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Usuario } from '../../shared/models/usuario.model';
import {
  USUARIO_ADMIN,
  USUARIO_JUGADOR,
  crearJwt,
  segundosDesdeAhora,
} from '../../testing/test-utils';
import { adminClubGuard } from './auth.guard';
import { AuthService, CLAVE_TOKEN } from './auth.service';

describe('AuthService', () => {
  let http: HttpTestingController;

  function crearServicio(): AuthService {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('arranca sin sesión si no hay token guardado', () => {
    const auth = crearServicio();
    expect(auth.token()).toBeNull();
    expect(auth.estaAutenticado()).toBe(false);
    expect(auth.usuario()).toBeNull();
    expect(auth.rol()).toBeNull();
  });

  describe('login', () => {
    it('guarda el token, carga el usuario desde /me y expone el rol', async () => {
      const auth = crearServicio();
      const token = crearJwt(segundosDesdeAhora(3600));

      const resultado = firstValueFrom(auth.login('ana@vibora.es', 'secreto123'));
      const login = http.expectOne('/api/auth/login');
      expect(login.request.method).toBe('POST');
      expect(login.request.body).toEqual({ email: 'ana@vibora.es', password: 'secreto123' });
      login.flush({ token, tipo: 'Bearer', expiraEn: '2099-01-01T00:00:00Z' });

      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);

      expect(await resultado).toEqual(USUARIO_JUGADOR);
      expect(auth.token()).toBe(token);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBe(token);
      expect(auth.usuario()).toEqual(USUARIO_JUGADOR);
      expect(auth.estaAutenticado()).toBe(true);
      expect(auth.rol()).toBe('JUGADOR');
    });

    it('propaga el error 401 y no deja sesión', async () => {
      const auth = crearServicio();

      const resultado = firstValueFrom(auth.login('ana@vibora.es', 'mala'));
      http
        .expectOne('/api/auth/login')
        .flush({ error: 'Credenciales incorrectas' }, { status: 401, statusText: 'Unauthorized' });

      await expect(resultado).rejects.toMatchObject({ status: 401 });
      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBeNull();
    });

    it('limpia la sesión si /me falla justo después del login', async () => {
      const auth = crearServicio();
      const token = crearJwt(segundosDesdeAhora(3600));

      const resultado = firstValueFrom(auth.login('ana@vibora.es', 'secreto123'));
      http.expectOne('/api/auth/login').flush({ token, tipo: 'Bearer', expiraEn: 'x' });
      http.expectOne('/api/auth/me').flush({}, { status: 500, statusText: 'Server Error' });

      await expect(resultado).rejects.toMatchObject({ status: 500 });
      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBeNull();
    });
  });

  describe('club del usuario', () => {
    async function conUsuario(usuario: Usuario): Promise<AuthService> {
      localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(3600)));
      const auth = crearServicio();
      const carga = firstValueFrom(auth.cargarUsuario());
      http.expectOne('/api/auth/me').flush(usuario);
      await carga;
      return auth;
    }

    it('sin sesión no hay club ni permisos de administrador', () => {
      const auth = crearServicio();

      expect(auth.clubId()).toBeNull();
      expect(auth.clubNombre()).toBeNull();
      expect(auth.esAdminClub()).toBe(false);
      expect(auth.puedeCrearClub()).toBe(false);
    });

    it('un administrador expone el id y el nombre de su club', async () => {
      const auth = await conUsuario(USUARIO_ADMIN);

      expect(auth.clubId()).toBe(5);
      expect(auth.clubNombre()).toBe('Club Víbora Demo');
      expect(auth.esAdminClub()).toBe(true);
      expect(auth.puedeCrearClub()).toBe(false);
    });

    it('un jugador sin club puede crear el suyo y no es administrador', async () => {
      const auth = await conUsuario(USUARIO_JUGADOR);

      expect(auth.clubId()).toBeNull();
      expect(auth.clubNombre()).toBeNull();
      expect(auth.esAdminClub()).toBe(false);
      expect(auth.puedeCrearClub()).toBe(true);
    });

    it('un monitor de un club no es administrador ni puede crear otro club', async () => {
      const auth = await conUsuario({ ...USUARIO_ADMIN, rol: 'MONITOR' });

      expect(auth.clubId()).toBe(5);
      expect(auth.esAdminClub()).toBe(false);
      expect(auth.puedeCrearClub()).toBe(false);
    });

    it('al cerrar sesión desaparece el club', async () => {
      const auth = await conUsuario(USUARIO_ADMIN);

      auth.logout();

      expect(auth.clubId()).toBeNull();
      expect(auth.esAdminClub()).toBe(false);
    });
  });

  describe('registro', () => {
    it('envía los datos, devuelve el usuario y NO abre sesión', async () => {
      const auth = crearServicio();
      const datos = {
        email: 'ana@vibora.es',
        password: 'secreto123',
        nombre: 'Ana',
        apellidos: 'García López',
      };

      const resultado = firstValueFrom(auth.registro(datos));
      const req = http.expectOne('/api/auth/registro');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(datos);
      req.flush(USUARIO_JUGADOR, { status: 201, statusText: 'Created' });

      expect(await resultado).toEqual(USUARIO_JUGADOR);
      expect(auth.estaAutenticado()).toBe(false);
    });

    it('propaga el 409 de email duplicado', async () => {
      const auth = crearServicio();

      const resultado = firstValueFrom(
        auth.registro({ email: 'a@b.es', password: '12345678', apellidos: 'X' }),
      );
      http
        .expectOne('/api/auth/registro')
        .flush({ error: 'El email ya está registrado' }, { status: 409, statusText: 'Conflict' });

      await expect(resultado).rejects.toMatchObject({
        status: 409,
        error: { error: 'El email ya está registrado' },
      });
    });
  });

  describe('logout', () => {
    it('borra token, usuario y almacenamiento', async () => {
      localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(3600)));
      const auth = crearServicio();
      const carga = firstValueFrom(auth.cargarUsuario());
      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);
      await carga;

      auth.logout();

      expect(auth.token()).toBeNull();
      expect(auth.usuario()).toBeNull();
      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBeNull();
    });
  });

  describe('arranque (cargarUsuario)', () => {
    it('no hace ninguna petición si no hay token', async () => {
      const auth = crearServicio();

      expect(await firstValueFrom(auth.cargarUsuario())).toBeNull();
      http.expectNone('/api/auth/me');
    });

    it('descarta un token caducado sin llamar al backend', async () => {
      localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(-60)));
      const auth = crearServicio();

      expect(auth.token()).toBeNull();
      expect(localStorage.getItem(CLAVE_TOKEN)).toBeNull();
      expect(await firstValueFrom(auth.cargarUsuario())).toBeNull();
      http.expectNone('/api/auth/me');
    });

    it('descarta un token ilegible', () => {
      localStorage.setItem(CLAVE_TOKEN, 'basura');
      const auth = crearServicio();

      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBeNull();
    });

    it('restaura el usuario con /me cuando el token es válido', async () => {
      localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(3600)));
      const auth = crearServicio();

      const carga = firstValueFrom(auth.cargarUsuario());
      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);

      expect(await carga).toEqual(USUARIO_JUGADOR);
      expect(auth.usuario()).toEqual(USUARIO_JUGADOR);
      expect(auth.estaAutenticado()).toBe(true);
    });

    it('cierra la sesión (sin romper el arranque) si /me responde 401', async () => {
      localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(3600)));
      const auth = crearServicio();

      const carga = firstValueFrom(auth.cargarUsuario());
      http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });

      expect(await carga).toBeNull();
      expect(auth.estaAutenticado()).toBe(false);
      expect(auth.sesionIncierta()).toBe(false);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBeNull();
    });

    it('cierra la sesión si /me responde 403', async () => {
      localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(3600)));
      const auth = crearServicio();

      const carga = firstValueFrom(auth.cargarUsuario());
      http.expectOne('/api/auth/me').flush({}, { status: 403, statusText: 'Forbidden' });

      expect(await carga).toBeNull();
      expect(auth.estaAutenticado()).toBe(false);
      expect(auth.sesionIncierta()).toBe(false);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBeNull();
    });
  });

  describe('arranque con el backend inalcanzable o caído (sesión incierta)', () => {
    const TOKEN = () => crearJwt(segundosDesdeAhora(3600));

    function crearConRouter(): { auth: AuthService; router: Router } {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: '**', children: [] }]),
          provideHttpClient(),
          provideHttpClientTesting(),
        ],
      });
      http = TestBed.inject(HttpTestingController);
      return { auth: TestBed.inject(AuthService), router: TestBed.inject(Router) };
    }

    /** Arranca con token válido y deja que /me falle con `fallo`. */
    async function arrancarFallando(
      fallo: (peticion: TestRequest) => void,
    ): Promise<{ auth: AuthService; router: Router; token: string }> {
      const token = TOKEN();
      localStorage.setItem(CLAVE_TOKEN, token);
      const { auth, router } = crearConRouter();
      const carga = firstValueFrom(auth.cargarUsuario());
      fallo(http.expectOne('/api/auth/me'));
      expect(await carga).toBeNull(); // el arranque nunca falla ni se queda colgado
      return { auth, router, token };
    }

    const caida = (p: TestRequest): void => p.error(new ProgressEvent('error'));
    const estado =
      (status: number) =>
      (p: TestRequest): void =>
        p.flush({}, { status, statusText: 'Error' });

    afterEach(() => {
      vi.restoreAllMocks(); // primero los espías (envuelven los temporizadores falsos), luego los reales
      vi.useRealTimers();
    });

    it.each([
      ['sin red (status 0)', caida],
      ['500', estado(500)],
      ['503', estado(503)],
    ])('con %s mantiene el token, no hay usuario y marca la sesión como incierta', async (_n, fallo) => {
      const { auth, token } = await arrancarFallando(fallo);

      expect(auth.token()).toBe(token);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBe(token);
      expect(auth.usuario()).toBeNull();
      expect(auth.estaAutenticado()).toBe(true);
      expect(auth.sesionIncierta()).toBe(true);
      expect(auth.esAdminClub()).toBe(false);
    });

    it('si /me no contesta a tiempo (timeout) también conserva el token y marca la incertidumbre', async () => {
      vi.useFakeTimers();
      localStorage.setItem(CLAVE_TOKEN, TOKEN());
      const { auth } = crearConRouter();

      const carga = firstValueFrom(auth.cargarUsuario());
      http.expectOne('/api/auth/me'); // nadie responde
      await vi.advanceTimersByTimeAsync(10_000);

      expect(await carga).toBeNull();
      expect(auth.estaAutenticado()).toBe(true);
      expect(auth.usuario()).toBeNull();
      expect(auth.sesionIncierta()).toBe(true);
    });

    it('reintenta al navegar y, si /me responde, carga el usuario y baja la marca', async () => {
      const { auth, router } = await arrancarFallando(estado(503));

      await router.navigateByUrl('/agenda');
      http.expectOne('/api/auth/me').flush(USUARIO_ADMIN);

      expect(auth.usuario()).toEqual(USUARIO_ADMIN);
      expect(auth.sesionIncierta()).toBe(false);
      expect(auth.esAdminClub()).toBe(true);
    });

    it('reintenta cuando el navegador vuelve a estar online', async () => {
      const { auth } = await arrancarFallando(caida);

      window.dispatchEvent(new Event('online'));
      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);

      expect(auth.usuario()).toEqual(USUARIO_JUGADOR);
      expect(auth.sesionIncierta()).toBe(false);
    });

    it('reintenta solo con retardo creciente (2 s, 4 s, ... tope de 30 s)', async () => {
      vi.useFakeTimers();
      localStorage.setItem(CLAVE_TOKEN, TOKEN());
      const { auth } = crearConRouter();
      const carga = firstValueFrom(auth.cargarUsuario());
      estado(503)(http.expectOne('/api/auth/me'));
      await carga;

      for (const espera of [2000, 4000, 8000, 16_000, 30_000, 30_000]) {
        await vi.advanceTimersByTimeAsync(espera - 1);
        http.expectNone('/api/auth/me'); // aún no toca
        await vi.advanceTimersByTimeAsync(1);
        estado(503)(http.expectOne('/api/auth/me')); // toca, y vuelve a fallar
      }
      expect(auth.sesionIncierta()).toBe(true);
    });

    it('un reintento con 401 cierra la sesión y deja de reintentar', async () => {
      vi.useFakeTimers();
      localStorage.setItem(CLAVE_TOKEN, TOKEN());
      const { auth } = crearConRouter();
      const carga = firstValueFrom(auth.cargarUsuario());
      estado(503)(http.expectOne('/api/auth/me'));
      await carga;

      await vi.advanceTimersByTimeAsync(2000);
      estado(401)(http.expectOne('/api/auth/me'));
      await vi.advanceTimersByTimeAsync(60_000);

      http.expectNone('/api/auth/me');
      expect(auth.estaAutenticado()).toBe(false);
      expect(auth.sesionIncierta()).toBe(false);
      expect(localStorage.getItem(CLAVE_TOKEN)).toBeNull();
    });

    it('al cerrar sesión se cancelan los reintentos', async () => {
      vi.useFakeTimers();
      localStorage.setItem(CLAVE_TOKEN, TOKEN());
      const { auth } = crearConRouter();
      const carga = firstValueFrom(auth.cargarUsuario());
      estado(503)(http.expectOne('/api/auth/me'));
      await carga;

      auth.logout();
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event('online'));

      http.expectNone('/api/auth/me');
      expect(auth.sesionIncierta()).toBe(false);
    });

    it('no lanza dos peticiones /me a la vez aunque coincidan varios disparadores', async () => {
      const { auth, router } = await arrancarFallando(estado(503));

      window.dispatchEvent(new Event('online'));
      await router.navigateByUrl('/agenda');

      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);
      expect(auth.usuario()).toEqual(USUARIO_JUGADOR);
    });

    it('sin sesión incierta, reintentarCarga no pide /me', async () => {
      localStorage.setItem(CLAVE_TOKEN, TOKEN());
      const { auth, router } = crearConRouter();
      auth.usuario.set(USUARIO_JUGADOR);

      auth.reintentarCarga();
      window.dispatchEvent(new Event('online'));
      await router.navigateByUrl('/agenda');

      http.expectNone('/api/auth/me');
    });

    describe('respuesta tardía de un /me de otra sesión', () => {
      /** Arranca con 503 y lanza un reintento (evento online) que se queda en vuelo. */
      async function conReintentoEnVuelo(): Promise<{ auth: AuthService; reintento: TestRequest }> {
        localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(3600)));
        const { auth } = crearConRouter();
        const carga = firstValueFrom(auth.cargarUsuario());
        estado(503)(http.expectOne('/api/auth/me'));
        await carga;
        window.dispatchEvent(new Event('online'));
        return { auth, reintento: http.expectOne('/api/auth/me') };
      }

      it('si se cierra sesión con el reintento en vuelo, su respuesta no escribe el usuario', async () => {
        const { auth, reintento } = await conReintentoEnVuelo();

        auth.logout();
        reintento.flush(USUARIO_ADMIN);

        expect(auth.usuario()).toBeNull();
        expect(auth.token()).toBeNull();
        expect(auth.estaAutenticado()).toBe(false);
      });

      it('si se cierra sesión y el reintento en vuelo falla, no se registran listeners ni temporizadores', async () => {
        vi.useFakeTimers();
        const { auth, reintento } = await conReintentoEnVuelo();
        auth.logout();
        const alta = vi.spyOn(window, 'addEventListener');
        const temporizador = vi.spyOn(globalThis, 'setTimeout');

        reintento.error(new ProgressEvent('error'));

        expect(auth.sesionIncierta()).toBe(false);
        expect(alta).not.toHaveBeenCalled();
        // el reintento con retardo creciente empieza en 2 s: no debe programarse ninguno
        expect(temporizador.mock.calls.filter(([, ms]) => (ms ?? 0) >= 1000)).toHaveLength(0);
      });

      it('si otro usuario entra durante el reintento, la respuesta antigua no pisa sus datos', async () => {
        const { auth, reintento } = await conReintentoEnVuelo();

        auth.logout();
        const acceso = firstValueFrom(auth.login('otra@vibora.es', 'secreto123'));
        http.expectOne('/api/auth/login').flush({
          token: crearJwt(segundosDesdeAhora(7200)),
          tipo: 'Bearer',
          expiraEn: 'x',
        });
        const meDeLogin = http.expectOne('/api/auth/me'); // el reintento viejo sigue abierto, pero ya está tomado arriba
        reintento.flush(USUARIO_ADMIN); // llega tarde, con los datos del usuario anterior
        expect(auth.usuario()).toBeNull();

        meDeLogin.flush(USUARIO_JUGADOR);
        await acceso;
        expect(auth.usuario()).toEqual(USUARIO_JUGADOR);
        expect(auth.esAdminClub()).toBe(false);
      });
    });

    describe('enlace profundo durante la sesión incierta', () => {
      const guardados = [
        { path: 'agenda', children: [] },
        { path: 'club', canActivate: [adminClubGuard], children: [] },
      ];

      async function arrancarEnClub(): Promise<{ auth: AuthService; router: Router }> {
        localStorage.setItem(CLAVE_TOKEN, TOKEN());
        TestBed.configureTestingModule({
          providers: [provideRouter(guardados), provideHttpClient(), provideHttpClientTesting()],
        });
        http = TestBed.inject(HttpTestingController);
        const auth = TestBed.inject(AuthService);
        const router = TestBed.inject(Router);
        const carga = firstValueFrom(auth.cargarUsuario());
        estado(503)(http.expectOne('/api/auth/me'));
        await carga;
        await router.navigateByUrl('/club'); // el guard no sabe el rol: manda a /agenda y recuerda /club
        return { auth, router };
      }

      it('el guard manda a /agenda y recuerda el destino', async () => {
        const { auth, router } = await arrancarEnClub();

        expect(router.url).toBe('/agenda');
        expect(auth.destinoPendiente).toBe('/club');
        http.match('/api/auth/me'); // el reintento por navegación queda pendiente
      });

      it('al recuperar la sesión como administrador vuelve a /club (una sola vez)', async () => {
        const { auth, router } = await arrancarEnClub();
        let navegaciones = 0;
        router.events.subscribe((e) => e instanceof NavigationStart && navegaciones++);

        http.expectOne('/api/auth/me').flush(USUARIO_ADMIN);
        await vi.waitFor(() => expect(router.url).toBe('/club'));
        await new Promise((r) => setTimeout(r)); // margen para detectar bucles

        expect(navegaciones).toBe(1);
        expect(auth.destinoPendiente).toBeNull();
        http.expectNone('/api/auth/me');
      });

      it('si el usuario NO cumple (jugador) se queda en /agenda y se olvida el destino', async () => {
        const { auth, router } = await arrancarEnClub();
        let navegaciones = 0;
        router.events.subscribe((e) => e instanceof NavigationStart && navegaciones++);

        http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);
        await new Promise((r) => setTimeout(r));

        expect(router.url).toBe('/agenda');
        expect(navegaciones).toBe(0);
        expect(auth.destinoPendiente).toBeNull();
      });

      it('si el usuario ya navegó a otra parte, no se le arrastra al destino viejo', async () => {
        const { router } = await arrancarEnClub();
        await router.navigateByUrl('/agenda?dia=1');
        router.resetConfig([...guardados, { path: 'otra', children: [] }]);
        await router.navigateByUrl('/otra');

        http.match('/api/auth/me')[0].flush(USUARIO_ADMIN);
        await new Promise((r) => setTimeout(r));

        expect(router.url).toBe('/otra');
      });

      it('al cerrar sesión se olvida el destino y no se restaura al volver a cargar otro usuario', async () => {
        const { auth, router } = await arrancarEnClub();
        http.match('/api/auth/me');

        auth.logout();
        expect(auth.destinoPendiente).toBeNull();
        auth.token.set(crearJwt(segundosDesdeAhora(7200)));
        const carga = firstValueFrom(auth.cargarUsuario());
        http.expectOne('/api/auth/me').flush(USUARIO_ADMIN);
        await carga;
        await new Promise((r) => setTimeout(r));

        expect(router.url).toBe('/agenda');
      });
    });

    describe('limpieza al destruir el servicio', () => {
      it('quita el listener online y el temporizador de reintento', async () => {
        vi.useFakeTimers();
        await arrancarFallando(estado(503));
        const baja = vi.spyOn(window, 'removeEventListener');
        const cancelar = vi.spyOn(globalThis, 'clearTimeout');

        TestBed.resetTestingModule();

        expect(baja).toHaveBeenCalledWith('online', expect.any(Function));
        expect(cancelar).toHaveBeenCalled(); // el reintento programado a 2 s se cancela
      });
    });
  });

  describe('higiene entre tests', () => {
    afterEach(() => {
      TestBed.resetTestingModule();
      vi.restoreAllMocks();
    });

    it('un servicio con sesión incierta no deja listeners online tras destruirse', async () => {
      const alta = vi.spyOn(window, 'addEventListener');
      const baja = vi.spyOn(window, 'removeEventListener');
      localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(3600)));
      TestBed.configureTestingModule({
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      http = TestBed.inject(HttpTestingController);
      const auth = TestBed.inject(AuthService);
      const carga = firstValueFrom(auth.cargarUsuario());
      http.expectOne('/api/auth/me').flush({}, { status: 503, statusText: 'Error' });
      await carga;
      expect(auth.sesionIncierta()).toBe(true);

      TestBed.resetTestingModule();

      const online = (llamadas: { mock: { calls: unknown[][] } }): number =>
        llamadas.mock.calls.filter(([tipo]) => tipo === 'online').length;
      expect(online(alta)).toBe(1);
      expect(online(baja)).toBe(1);
    });
  });
});
