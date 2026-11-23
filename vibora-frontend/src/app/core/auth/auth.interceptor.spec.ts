import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { crearJwt, segundosDesdeAhora } from '../../testing/test-utils';
import { TimeoutError } from 'rxjs';
import { AuthService, CLAVE_SESION, SesionCerradaError } from './auth.service';
import { authInterceptor } from './auth.interceptor';

const REFRESCAR = '/api/auth/refrescar';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let router: Router;
  let navegar: ReturnType<typeof vi.spyOn>;
  let token: string | null;

  function preparar(conToken: boolean, urlActual = '/mis-reservas'): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    token = conToken ? crearJwt(segundosDesdeAhora(3600)) : null;
    if (conToken) {
      localStorage.setItem(CLAVE_SESION, '1');
      TestBed.inject(AuthService).token.set(token);
    }
    vi.spyOn(router, 'url', 'get').mockReturnValue(urlActual);
    navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  }

  const noAutorizado = { status: 401, statusText: 'Unauthorized' };
  const nuevoToken = (): string => crearJwt(segundosDesdeAhora(7200));
  const respuestaRefresco = (t: string) => ({ token: t, tipo: 'Bearer', expiraEn: 'x' });
  const asentar = (): Promise<void> => new Promise((resolver) => setTimeout(resolver, 0));

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('añade Authorization: Bearer a las peticiones /api/', () => {
    preparar(true);

    http.get('/api/clubes').subscribe();

    const req = controller.expectOne('/api/clubes');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
  });

  it('no añade la cabecera a URLs que no son /api/', () => {
    preparar(true);

    http.get('/assets/datos.json').subscribe();
    http.get('https://externo.example.com/api/algo').subscribe();

    expect(controller.expectOne('/assets/datos.json').request.headers.has('Authorization')).toBe(
      false,
    );
    expect(
      controller
        .expectOne('https://externo.example.com/api/algo')
        .request.headers.has('Authorization'),
    ).toBe(false);
  });

  it('no añade la cabecera si no hay sesión', () => {
    preparar(false);

    http.get('/api/clubes').subscribe();

    expect(controller.expectOne('/api/clubes').request.headers.has('Authorization')).toBe(false);
  });

  it('refrescar y cerrar-sesion van solo con la cookie, sin Authorization', () => {
    preparar(true);

    http.post(REFRESCAR, {}).subscribe();
    http.post('/api/auth/cerrar-sesion', {}).subscribe();

    expect(controller.expectOne(REFRESCAR).request.headers.has('Authorization')).toBe(false);
    expect(
      controller.expectOne('/api/auth/cerrar-sesion').request.headers.has('Authorization'),
    ).toBe(false);
  });

  describe('401 en una llamada autenticada', () => {
    it('refresca UNA vez y reintenta la petición original UNA vez con el token nuevo', async () => {
      preparar(true);
      const auth = TestBed.inject(AuthService);
      const nuevo = nuevoToken();
      let cuerpo: unknown;

      http.get('/api/reservas/mias').subscribe((r) => (cuerpo = r));
      controller.expectOne('/api/reservas/mias').flush({}, noAutorizado);
      await asentar();
      controller.expectOne(REFRESCAR).flush(respuestaRefresco(nuevo));
      await asentar();
      const reintento = controller.expectOne('/api/reservas/mias');
      reintento.flush({ ok: true });

      expect(reintento.request.headers.get('Authorization')).toBe(`Bearer ${nuevo}`);
      expect(cuerpo).toEqual({ ok: true });
      expect(auth.token()).toBe(nuevo);
      expect(navegar).not.toHaveBeenCalled();
      controller.expectNone(REFRESCAR);
    });

    it('varios 401 concurrentes comparten un único refresco y todos se reintentan', async () => {
      preparar(true);
      const nuevo = nuevoToken();
      const respuestas: unknown[] = [];

      http.get('/api/a').subscribe((r) => respuestas.push(r));
      http.get('/api/b').subscribe((r) => respuestas.push(r));
      controller.expectOne('/api/a').flush({}, noAutorizado);
      controller.expectOne('/api/b').flush({}, noAutorizado);
      await asentar();
      controller.expectOne(REFRESCAR).flush(respuestaRefresco(nuevo)); // expectOne falla si hay dos
      await asentar();
      controller.expectOne('/api/a').flush('a');
      controller.expectOne('/api/b').flush('b');

      expect(respuestas).toEqual(['a', 'b']);
    });

    it('un 401 de una petición enviada con un token que ya se renovó solo reintenta, sin refrescar otra vez', async () => {
      preparar(true);
      const auth = TestBed.inject(AuthService);
      http.get('/api/vieja').subscribe();
      const enVuelo = controller.expectOne('/api/vieja');
      auth.token.set(nuevoToken()); // otro refresco terminó mientras esta petición viajaba

      enVuelo.flush({}, noAutorizado);
      await asentar();

      controller.expectNone(REFRESCAR);
      controller.expectOne('/api/vieja').flush('ok');
    });

    it('si el reintento también da 401 NO vuelve a refrescar ni a reintentar (sin bucle)', async () => {
      preparar(true);
      let fallo: unknown;

      http.get('/api/clubes').subscribe({ error: (e: unknown) => (fallo = e) });
      controller.expectOne('/api/clubes').flush({}, noAutorizado);
      await asentar();
      controller.expectOne(REFRESCAR).flush(respuestaRefresco(nuevoToken()));
      await asentar();
      controller.expectOne('/api/clubes').flush({}, noAutorizado); // el reintento
      await asentar();

      controller.expectNone(REFRESCAR);
      controller.expectNone('/api/clubes');
      expect(fallo).toMatchObject({ status: 401 });
    });

    it('si el refresco da 401 cierra la sesión local y va a /login con redirectTo', async () => {
      preparar(true, '/mis-reservas');
      const auth = TestBed.inject(AuthService);
      let fallo: unknown;

      http.get('/api/reservas/mias').subscribe({ error: (e: unknown) => (fallo = e) });
      controller.expectOne('/api/reservas/mias').flush({}, noAutorizado);
      await asentar();
      controller.expectOne(REFRESCAR).flush({}, noAutorizado);
      await asentar();

      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
      expect(navegar).toHaveBeenCalledWith(['/login'], {
        queryParams: { redirectTo: '/mis-reservas' },
      });
      expect(fallo).toMatchObject({ status: 401 }); // el error sigue llegando a quien hizo la llamada
      controller.expectNone('/api/auth/cerrar-sesion'); // la sesión ya estaba muerta en el servidor
    });

    it('si el refresco da 429 NO cierra la sesión: el error llega al llamante', async () => {
      preparar(true);
      const auth = TestBed.inject(AuthService);
      let fallo: unknown;

      http.get('/api/clubes').subscribe({ error: (e: unknown) => (fallo = e) });
      controller.expectOne('/api/clubes').flush({}, noAutorizado);
      await asentar();
      controller
        .expectOne(REFRESCAR)
        .flush({}, { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '5' } });
      await asentar();

      expect(auth.estaAutenticado()).toBe(true);
      expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
      expect(navegar).not.toHaveBeenCalled();
      expect(fallo).toMatchObject({ status: 429 });
    });

    it('si ya estamos en /login no navega otra vez (no pisa el redirectTo existente)', async () => {
      preparar(true, '/login?redirectTo=%2Fagenda');

      http.get('/api/clubes').subscribe({ error: () => undefined });
      controller.expectOne('/api/clubes').flush({}, noAutorizado);
      await asentar();
      controller.expectOne(REFRESCAR).flush({}, noAutorizado);
      await asentar();

      expect(navegar).not.toHaveBeenCalled();
    });

    it('cerrar-sesion-todas NO es una ruta solo-cookie: lleva Bearer y sí refresca ante un 401', async () => {
      preparar(true);
      const nuevo = nuevoToken();
      let cuerpo: unknown;

      http.post('/api/auth/cerrar-sesion-todas', {}).subscribe((r) => (cuerpo = r));
      const primera = controller.expectOne('/api/auth/cerrar-sesion-todas');
      expect(primera.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
      primera.flush({}, noAutorizado);
      await asentar();
      controller.expectOne(REFRESCAR).flush(respuestaRefresco(nuevo));
      await asentar();
      const reintento = controller.expectOne('/api/auth/cerrar-sesion-todas');
      reintento.flush({ ok: true });

      expect(reintento.request.headers.get('Authorization')).toBe(`Bearer ${nuevo}`);
      expect(cuerpo).toEqual({ ok: true });
    });

    it('si el refresco falla porque la sesión se cerró, el llamante recibe el 401 ORIGINAL', async () => {
      preparar(true);
      const auth = TestBed.inject(AuthService);
      let fallo: unknown;

      http.get('/api/clubes').subscribe({ error: (e: unknown) => (fallo = e) });
      vi.spyOn(auth, 'refrescar').mockRejectedValue(new SesionCerradaError());
      controller.expectOne('/api/clubes').flush({}, noAutorizado);
      await asentar();

      expect(fallo).toBeInstanceOf(HttpErrorResponse);
      expect(fallo).toMatchObject({ status: 401 });
    });

    it('un TimeoutError del refresco se propaga tal cual (no se disfraza de 401)', async () => {
      preparar(true);
      const auth = TestBed.inject(AuthService);
      let fallo: unknown;

      http.get('/api/clubes').subscribe({ error: (e: unknown) => (fallo = e) });
      vi.spyOn(auth, 'refrescar').mockRejectedValue(new TimeoutError());
      controller.expectOne('/api/clubes').flush({}, noAutorizado);
      await asentar();

      expect(fallo).toBeInstanceOf(TimeoutError);
    });

    it('un 401 de una petición enviada en otra época (logout + login) propaga el 401 original sin reintentar con el token de la sesión nueva', async () => {
      preparar(true);
      const auth = TestBed.inject(AuthService);
      let fallo: unknown;
      http.get('/api/vieja').subscribe({ error: (e: unknown) => (fallo = e) });
      const enVuelo = controller.expectOne('/api/vieja');
      auth.logout(); // cierra la época de la petición
      auth.token.set(nuevoToken()); // y otra sesión distinta abre token nuevo

      enVuelo.flush({}, noAutorizado);
      await asentar();

      controller.expectNone(REFRESCAR);
      controller.expectNone('/api/vieja'); // sin repetición con el token de la otra sesión
      expect(fallo).toMatchObject({ status: 401 });
    });
  });

  it.each(['/api/auth/login', '/api/auth/registro', '/api/auth/cerrar-sesion', REFRESCAR])(
    'un 401 de %s no intenta refrescar ni redirige (sin bucle)',
    async (url) => {
      preparar(true);
      const auth = TestBed.inject(AuthService);

      http.post(url, {}).subscribe({ error: () => undefined });
      controller.expectOne(url).flush({ error: 'x' }, noAutorizado);
      await asentar();

      controller.expectNone(REFRESCAR);
      expect(navegar).not.toHaveBeenCalled();
      expect(auth.estaAutenticado()).toBe(true);
    },
  );

  it('no intenta refrescar ante un 401 si no había sesión', async () => {
    preparar(false);

    http.get('/api/clubes').subscribe({ error: () => undefined });
    controller.expectOne('/api/clubes').flush({}, noAutorizado);
    await asentar();

    controller.expectNone(REFRESCAR);
    expect(navegar).not.toHaveBeenCalled();
  });

  it.each([400, 403, 404, 409, 500])('no toca la sesión ante un %i', async (status) => {
    preparar(true);
    const auth = TestBed.inject(AuthService);

    http.get('/api/clubes').subscribe({ error: () => undefined });
    controller.expectOne('/api/clubes').flush({}, { status, statusText: 'Error' });
    await asentar();

    controller.expectNone(REFRESCAR);
    expect(navegar).not.toHaveBeenCalled();
    expect(auth.estaAutenticado()).toBe(true);
  });
});
