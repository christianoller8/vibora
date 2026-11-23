import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  USUARIO_JUGADOR,
  crearJwt,
  segundosDesdeAhora,
} from '../../testing/test-utils';
import { authInterceptor } from './auth.interceptor';
import { AuthService, CLAVE_SESION, CLAVE_TOKEN_LEGADO } from './auth.service';

const REFRESCAR = '/api/auth/refrescar';
const CERRAR = '/api/auth/cerrar-sesion';

describe('AuthService: sesión con token en memoria y refresco', () => {
  let http: HttpTestingController;
  let peticionesLock: string[];
  let opcionesLock: LockOptions[];

  function crear(conInterceptor = false): AuthService {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        conInterceptor ? provideHttpClient(withInterceptors([authInterceptor])) : provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  }

  /**
   * navigator.locks falso con una cola FIFO real: cada callback arranca solo cuando la promesa del anterior se
   * resuelve o se rechaza (el lock también se libera si el callback lanza), como hace el navegador.
   */
  function simularLocks(): void {
    peticionesLock = [];
    opcionesLock = [];
    let cola: Promise<unknown> = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn((nombre: string, opcionesOCallback: unknown, callbackOpcional?: () => Promise<unknown>) => {
          const callback = (callbackOpcional ?? opcionesOCallback) as () => Promise<unknown>;
          if (callbackOpcional) {
            opcionesLock.push(opcionesOCallback as LockOptions);
          }
          peticionesLock.push(nombre);
          const turno = cola.then(() => callback());
          cola = turno.then(
            () => undefined,
            () => undefined,
          );
          return turno;
        }),
      },
    });
  }

  const asentar = (): Promise<void> => new Promise((resolver) => setTimeout(resolver, 0));
  const estado = (status: number, cabeceras?: Record<string, string>) => (p: TestRequest) =>
    p.flush({}, { status, statusText: 'Error', headers: cabeceras });
  const respuesta = (token: string) => ({ token, tipo: 'Bearer', expiraEn: 'x' });

  /** Login completo: el POST sale tras obtener el lock (asíncrono), por eso se cede el turno antes de cada flush. */
  async function entrar(auth: AuthService, token: string, tiempoFalso = false): Promise<void> {
    const ceder = (): Promise<unknown> => (tiempoFalso ? vi.advanceTimersByTimeAsync(0) : asentar());
    const acceso = firstValueFrom(auth.login('ana@vibora.es', 'secreto123'));
    await ceder();
    http.expectOne('/api/auth/login').flush(respuesta(token));
    await ceder();
    http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);
    await acceso;
  }

  /** Todo lo que hay en localStorage (claves y valores) en un solo texto. */
  const volcadoAlmacenamiento = (): string => {
    const partes: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i)!;
      partes.push(clave, localStorage.getItem(clave) ?? '');
    }
    return partes.join('|');
  };

  beforeEach(() => {
    localStorage.clear();
    simularLocks();
  });
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (navigator as unknown as Record<string, unknown>)['locks'];
  });

  describe('el token no toca el almacenamiento', () => {
    it('el login deja el token en memoria y solo escribe la pista "vibora.sesion"', async () => {
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));

      await entrar(auth, token);

      expect(auth.token()).toBe(token);
      expect(volcadoAlmacenamiento()).not.toContain(token);
      expect(localStorage.getItem(CLAVE_TOKEN_LEGADO)).toBeNull();
      expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
    });

    it('un refresco tampoco escribe el token en el almacenamiento', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));

      const refresco = auth.refrescar();
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(token));
      await refresco;

      expect(auth.token()).toBe(token);
      expect(volcadoAlmacenamiento()).not.toContain(token);
    });

    it('al arrancar borra la clave legada "vibora.token" y no la usa como sesión', () => {
      localStorage.setItem(CLAVE_TOKEN_LEGADO, crearJwt(segundosDesdeAhora(3600)));

      const auth = crear();

      expect(localStorage.getItem(CLAVE_TOKEN_LEGADO)).toBeNull();
      expect(auth.token()).toBeNull();
    });
  });

  describe('arranque', () => {
    it('con la pista llama a refrescar UNA vez y luego carga el usuario', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));

      const carga = firstValueFrom(auth.cargarUsuario());
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(token));
      await asentar();
      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);

      expect(await carga).toEqual(USUARIO_JUGADOR);
      expect(auth.token()).toBe(token);
      http.expectNone(REFRESCAR);
    });

    it('sin la pista nunca llama a refrescar: arranca anónimo', async () => {
      const auth = crear();

      expect(await firstValueFrom(auth.cargarUsuario())).toBeNull();
      await asentar();

      http.expectNone(REFRESCAR);
      expect(auth.estaAutenticado()).toBe(false);
    });

    it('un 401 al refrescar deja anónimo y borra la pista', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();

      const carga = firstValueFrom(auth.cargarUsuario());
      await asentar();
      estado(401)(http.expectOne(REFRESCAR));

      expect(await carga).toBeNull();
      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
    });

    it.each([
      ['429', (p: TestRequest) => estado(429, { 'Retry-After': '30' })(p)],
      ['sin red', (p: TestRequest) => p.error(new ProgressEvent('error'))],
    ])('con %s arranca anónimo SIN borrar la pista (se reintenta en la próxima carga)', async (_n, fallo) => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();

      const carga = firstValueFrom(auth.cargarUsuario());
      await asentar();
      fallo(http.expectOne(REFRESCAR));

      expect(await carga).toBeNull();
      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
    });
  });

  describe('login fallido', () => {
    it('un POST de login fallido deja intactos la pista y un refresco de arranque en vuelo', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));

      const carga = firstValueFrom(auth.cargarUsuario());
      await asentar();
      const refresco = http.expectOne(REFRESCAR); // el refresco de arranque ya viaja
      const epocaAntes = auth.epocaSesion;

      const acceso = firstValueFrom(auth.login('ana@vibora.es', 'mala')).catch((e: unknown) => e);
      await asentar(); // el login espera el lock tras el refresco
      refresco.flush(respuesta(token));
      await asentar();
      expect(auth.token()).toBe(token);
      estado(401)(http.expectOne('/api/auth/login'));
      await asentar();
      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR); // /me del arranque

      expect(await acceso).toMatchObject({ status: 401 });
      expect(await carga).toEqual(USUARIO_JUGADOR);
      expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
      expect(auth.token()).toBe(token);
      expect(auth.epocaSesion).toBe(epocaAntes); // el POST fallido no abrió época nueva
    });
  });

  describe('espera del lock acotada', () => {
    it('una espera de lock abortada al arrancar deja anónimo y conserva la pista', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: vi.fn(() => Promise.reject(new DOMException('x', 'TimeoutError'))) },
      });
      const auth = crear();

      expect(await firstValueFrom(auth.cargarUsuario())).toBeNull();

      http.expectNone(REFRESCAR); // no se cae al camino sin lock: la espera ya se agotó
      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
    });

    it('la petición del lock lleva una señal de aborto', async () => {
      const auth = crear();

      const refresco = auth.refrescar();
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(crearJwt(segundosDesdeAhora(900))));
      await refresco;

      expect(opcionesLock).toHaveLength(1);
      expect(opcionesLock[0].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('refrescar()', () => {
    it('se ejecuta dentro de navigator.locks.request("vibora-refresco")', async () => {
      const auth = crear();

      const refresco = auth.refrescar();
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(crearJwt(segundosDesdeAhora(900))));
      await refresco;

      expect(peticionesLock).toEqual(['vibora-refresco']);
    });

    it('sin Web Locks funciona igual (single-flight)', async () => {
      delete (navigator as unknown as Record<string, unknown>)['locks'];
      const auth = crear();

      const a = auth.refrescar();
      const b = auth.refrescar(); // concurrente: comparte la petición de la pestaña
      http.expectOne(REFRESCAR).flush(respuesta(crearJwt(segundosDesdeAhora(900)))); // expectOne falla si hay dos

      await expect(a).resolves.toEqual(expect.any(String));
      await expect(b).resolves.toEqual(expect.any(String));
    });

    it('varias llamadas a la vez comparten UNA sola petición', async () => {
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));

      const a = auth.refrescar();
      const b = auth.refrescar();
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(token)); // expectOne falla si hay dos

      expect(await a).toBe(token);
      expect(await b).toBe(token);
      expect(peticionesLock).toHaveLength(1);
    });

    it('terminado un refresco, el siguiente vuelve a llamar al endpoint (nunca reutiliza el resultado)', async () => {
      const auth = crear();

      const a = auth.refrescar();
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(crearJwt(segundosDesdeAhora(900))));
      await a;
      const b = auth.refrescar();
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(crearJwt(segundosDesdeAhora(901))));
      await b;
    });

    it('un 401 limpia la sesión y la pista', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(10)));

      const refresco = auth.refrescar();
      await asentar();
      estado(401)(http.expectOne(REFRESCAR));

      await expect(refresco).rejects.toMatchObject({ status: 401 });
      expect(auth.token()).toBeNull();
      expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
    });

    it('un 429 NO cierra la sesión ni borra la pista', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));
      auth.token.set(token);

      const refresco = auth.refrescar();
      await asentar();
      estado(429, { 'Retry-After': '30' })(http.expectOne(REFRESCAR));

      await expect(refresco).rejects.toMatchObject({ status: 429 });
      expect(auth.token()).toBe(token);
      expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
    });

    it('un logout durante el refresco hace que su resultado no reabra la sesión', async () => {
      const auth = crear();

      const refresco = auth.refrescar();
      await asentar();
      auth.logout();
      http.expectOne(REFRESCAR).flush(respuesta(crearJwt(segundosDesdeAhora(900))));
      await refresco.catch(() => undefined);
      await asentar();
      http.expectOne(CERRAR).flush(null, { status: 204, statusText: 'No Content' });

      expect(auth.token()).toBeNull();
      expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
    });

    it('dos pestañas: la segunda espera a que termine la primera y entonces envía su propia petición', async () => {
      const pestanaA = crear();
      const pestanaB = TestBed.runInInjectionContext(() => new AuthService());
      const tokenA = crearJwt(segundosDesdeAhora(900));
      const tokenB = crearJwt(segundosDesdeAhora(901));

      const a = pestanaA.refrescar();
      const b = pestanaB.refrescar();
      await asentar();
      const primera = http.expectOne(REFRESCAR); // expectOne falla si la segunda ya envió la suya
      primera.flush(respuesta(tokenA));
      await a;
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(tokenB));

      expect(await b).toBe(tokenB);
    });

    it('si el callback del lock falla, el lock se libera y el siguiente refresco avanza', async () => {
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));

      const a = auth.refrescar();
      await asentar();
      estado(500)(http.expectOne(REFRESCAR));
      await expect(a).rejects.toMatchObject({ status: 500 });
      const b = auth.refrescar();
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(token));

      expect(await b).toBe(token);
    });

    it('si navigator.locks.request rechaza (p. ej. SecurityError) refresca igualmente sin lock', async () => {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: vi.fn(() => Promise.reject(new DOMException('x', 'SecurityError'))) },
      });
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));

      const refresco = auth.refrescar();
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(token));

      expect(await refresco).toBe(token);
    });

    it('un refresco en cola tras un lock ocupado y un logout NUNCA llama a refrescar', async () => {
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(900)));
      let liberar!: () => void;
      const ocupado = navigator.locks.request('otra-pestana', () => new Promise<void>((r) => (liberar = r)));

      await asentar(); // el callback del lock ocupado ya arrancó y tiene el lock
      const refresco = auth.refrescar();
      auth.logout();
      liberar();
      await ocupado;
      await refresco.catch(() => undefined);
      await asentar();

      http.expectNone(REFRESCAR);
      http.expectOne(CERRAR).flush(null, { status: 204, statusText: 'No Content' });
    });

    it('cerrar-sesion espera a que termine el refresco en vuelo antes de enviarse', async () => {
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(900)));

      const refresco = auth.refrescar();
      await asentar();
      const enVuelo = http.expectOne(REFRESCAR);
      auth.logout();
      await asentar();
      http.expectNone(CERRAR); // aún no: el refresco en vuelo puede rotar la cookie

      enVuelo.flush(respuesta(crearJwt(segundosDesdeAhora(900))));
      await refresco.catch(() => undefined);
      await asentar();

      http.expectOne(CERRAR).flush(null, { status: 204, statusText: 'No Content' });
      expect(auth.token()).toBeNull();
    });

    it('un refresco que no responde en 30 s se da por fallido: arranca anónimo y conserva la pista', async () => {
      vi.useFakeTimers();
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();

      const carga = firstValueFrom(auth.cargarUsuario());
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne(REFRESCAR); // el backend no contesta nunca
      await vi.advanceTimersByTimeAsync(29_000);
      let resuelta = false;
      void carga.then(() => (resuelta = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(resuelta).toBe(false); // a los 29 s aún se espera (abortar antes dejaría una cookie rotada sin recibir)
      await vi.advanceTimersByTimeAsync(1001);

      expect(await carga).toBeNull();
      expect(auth.estaAutenticado()).toBe(false);
      expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
    });

    it('un cerrar-sesion colgado libera el lock tras el timeout y el refresco en cola avanza', async () => {
      vi.useFakeTimers();
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(900));
      auth.token.set(crearJwt(segundosDesdeAhora(900)));

      auth.logout();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne(CERRAR); // el servidor no contesta nunca
      const refresco = auth.refrescar();
      await vi.advanceTimersByTimeAsync(0);
      http.expectNone(REFRESCAR); // el lock sigue retenido por el cerrar-sesion colgado

      await vi.advanceTimersByTimeAsync(30_001);
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne(REFRESCAR).flush(respuesta(token));

      await expect(refresco).resolves.toBe(token);
    });

    it('login tras logout con un refresco reteniendo el lock: orden refrescar, cerrar-sesion, login', async () => {
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(900)));
      const refresco = auth.refrescar();
      await asentar();
      const enVuelo = http.expectOne(REFRESCAR);

      auth.logout();
      const nuevo = crearJwt(segundosDesdeAhora(1800));
      const acceso = firstValueFrom(auth.login('ana@vibora.es', 'secreto123'));
      await asentar();
      http.expectNone(CERRAR);
      http.expectNone('/api/auth/login');

      enVuelo.flush(respuesta(crearJwt(segundosDesdeAhora(900))));
      await refresco.catch(() => undefined);
      await asentar();
      http.expectNone('/api/auth/login'); // primero va el cerrar-sesion (revoca solo la cookie VIEJA)
      http.expectOne(CERRAR).flush(null, { status: 204, statusText: 'No Content' });
      await asentar();
      http.expectOne('/api/auth/login').flush(respuesta(nuevo));
      await asentar();
      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);
      await acceso;

      expect(auth.token()).toBe(nuevo);
      expect(auth.estaAutenticado()).toBe(true);
    });
  });

  describe('refresco proactivo', () => {
    it('programa un refresco 60 s antes de la caducidad del token', async () => {
      vi.useFakeTimers();
      const auth = crear();
      await entrar(auth, crearJwt(segundosDesdeAhora(900)), true);

      await vi.advanceTimersByTimeAsync(839_000); // 899 s - 60 s = 839 s: aún no toca
      http.expectNone(REFRESCAR);

      await vi.advanceTimersByTimeAsync(2000); // se cruza el instante exp - 60 s
      const peticion = http.expectOne(REFRESCAR);
      expect(auth.token()).not.toBeNull();
      peticion.flush(respuesta(crearJwt(segundosDesdeAhora(900))));
      await vi.advanceTimersByTimeAsync(0);
    });

    it('tras refrescar programa el siguiente con el token nuevo', async () => {
      vi.useFakeTimers();
      const auth = crear();
      await entrar(auth, crearJwt(segundosDesdeAhora(900)), true);
      await vi.advanceTimersByTimeAsync(841_000);
      http.expectOne(REFRESCAR).flush(respuesta(crearJwt(segundosDesdeAhora(900))));
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(841_000);

      http.expectOne(REFRESCAR).flush(respuesta(crearJwt(segundosDesdeAhora(900))));
    });

    it('si el refresco proactivo recibe 401 la sesión termina y lleva a /login', async () => {
      vi.useFakeTimers();
      const auth = crear();
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await entrar(auth, crearJwt(segundosDesdeAhora(900)), true);

      await vi.advanceTimersByTimeAsync(841_000);
      estado(401)(http.expectOne(REFRESCAR));
      await vi.advanceTimersByTimeAsync(0);

      expect(auth.estaAutenticado()).toBe(false);
      expect(navegar).toHaveBeenCalledWith(['/login'], expect.anything());
    });

    it('al cerrar sesión se cancela el refresco programado', async () => {
      vi.useFakeTimers();
      const auth = crear();
      await entrar(auth, crearJwt(segundosDesdeAhora(900)), true);

      auth.logout();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne(CERRAR).flush(null, { status: 204, statusText: 'No Content' });
      await vi.advanceTimersByTimeAsync(900_000);

      http.expectNone(REFRESCAR);
    });

    /** Login + avance hasta que dispara el refresco proactivo (token de 900 s). */
    async function conRefrescoPendiente(
      vida = 900,
    ): Promise<{ auth: AuthService; token: string }> {
      vi.useFakeTimers();
      const auth = crear();
      const token = crearJwt(segundosDesdeAhora(vida));
      await entrar(auth, token, true);
      await vi.advanceTimersByTimeAsync((vida - 59) * 1000);
      return { auth, token };
    }

    it('un 429 del refresco proactivo se reintenta tras Retry-After y, si acierta, cambia el token', async () => {
      const { auth, token } = await conRefrescoPendiente();
      estado(429, { 'Retry-After': '20' })(http.expectOne(REFRESCAR));
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(19_000);
      http.expectNone(REFRESCAR);
      await vi.advanceTimersByTimeAsync(1500);
      const nuevo = crearJwt(segundosDesdeAhora(1800));
      http.expectOne(REFRESCAR).flush(respuesta(nuevo));
      await vi.advanceTimersByTimeAsync(0);

      expect(auth.token()).toBe(nuevo);
      expect(auth.token()).not.toBe(token);
    });

    it('un fallo de red reintenta con backoff de 30 s que se duplica', async () => {
      vi.useFakeTimers();
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(3600))); // mucha vida: el tope de caducidad no interviene
      auth.refrescar().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne(REFRESCAR).error(new ProgressEvent('error'));
      await vi.advanceTimersByTimeAsync(29_000);
      http.expectNone(REFRESCAR);
      await vi.advanceTimersByTimeAsync(2000); // 31 s: primer reintento
      http.expectOne(REFRESCAR).error(new ProgressEvent('error')); // segundo fallo: ahora 60 s

      await vi.advanceTimersByTimeAsync(59_000);
      http.expectNone(REFRESCAR);
      await vi.advanceTimersByTimeAsync(2000);
      http.expectOne(REFRESCAR);
    });

    it('el reintento nunca se programa más tarde de la caducidad del token (menos un margen)', async () => {
      await conRefrescoPendiente(); // quedan ~58 s de token
      estado(429, { 'Retry-After': '600' })(http.expectOne(REFRESCAR));
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(60_000);

      http.expectOne(REFRESCAR);
    });

    it('con el token ya caducado un 429 con Retry-After: 200 reprograma a ~200 s, no a 5 s', async () => {
      vi.useFakeTimers();
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(-5))); // ya caducado
      auth.refrescar().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      estado(429, { 'Retry-After': '200' })(http.expectOne(REFRESCAR));
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(190_000);
      http.expectNone(REFRESCAR);
      await vi.advanceTimersByTimeAsync(11_000);

      http.expectOne(REFRESCAR);
    });

    it('un Retry-After enorme se recorta al tope de 5 min antes de llamar a setTimeout', async () => {
      vi.useFakeTimers();
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(-5)));
      auth.refrescar().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      estado(429, { 'Retry-After': '86400' })(http.expectOne(REFRESCAR));
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(299_000);
      http.expectNone(REFRESCAR);
      await vi.advanceTimersByTimeAsync(2000);

      http.expectOne(REFRESCAR);
    });

    describe('ventana de un 429 o backoff pendiente', () => {
      async function tras429(): Promise<AuthService> {
        vi.useFakeTimers();
        const auth = crear();
        auth.token.set(crearJwt(segundosDesdeAhora(3600)));
        auth.refrescar().catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        estado(429, { 'Retry-After': '60' })(http.expectOne(REFRESCAR));
        await vi.advanceTimersByTimeAsync(0);
        return auth;
      }

      it('dentro de la ventana un 401 REST NO envía refrescar y no cambia el reintento programado', async () => {
        const auth = await tras429();
        const temporizadores = vi.getTimerCount();

        await expect(auth.refrescar()).rejects.toMatchObject({ status: 429 });
        await vi.advanceTimersByTimeAsync(0);

        http.expectNone(REFRESCAR);
        expect(vi.getTimerCount()).toBe(temporizadores);
        await vi.advanceTimersByTimeAsync(59_000);
        http.expectNone(REFRESCAR);
        await vi.advanceTimersByTimeAsync(2000); // el temporizador sí refresca al cumplirse la ventana
        http.expectOne(REFRESCAR);
      });

      it('con el interceptor: el 401 dentro de la ventana no envía refrescar y devuelve el error del 429', async () => {
        vi.useFakeTimers();
        const auth = crear(true);
        const token = crearJwt(segundosDesdeAhora(3600));
        auth.token.set(token);
        auth.refrescar().catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        estado(429, { 'Retry-After': '60' })(http.expectOne(REFRESCAR));
        await vi.advanceTimersByTimeAsync(0);

        const llamada = firstValueFrom(TestBed.inject(HttpClient).get('/api/datos')).catch((e: unknown) => e);
        estado(401)(http.expectOne('/api/datos'));
        const error = await llamada;
        await vi.advanceTimersByTimeAsync(0);

        expect(error).toMatchObject({ status: 429 });
        http.expectNone(REFRESCAR);
      });

      it('pasada la ventana, un refresco desde fuera del temporizador vuelve a enviarse', async () => {
        const auth = await tras429();
        await vi.advanceTimersByTimeAsync(59_000);
        // sigue dentro de la ventana
        await expect(auth.refrescar()).rejects.toMatchObject({ status: 429 });
        http.expectNone(REFRESCAR);

        vi.setSystemTime(Date.now() + 120_000); // la ventana vence sin que dispare el temporizador
        const nuevo = crearJwt(segundosDesdeAhora(1800));
        const refresco = auth.refrescar();
        await vi.advanceTimersByTimeAsync(0);
        http.expectOne(REFRESCAR).flush(respuesta(nuevo));

        expect(await refresco).toBe(nuevo);
      });
    });

    it('con el token ya caducado un fallo de red usa el backoff (30 s, 60 s), nunca 5 s en bucle', async () => {
      vi.useFakeTimers();
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(-5)));
      auth.refrescar().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne(REFRESCAR).error(new ProgressEvent('error'));

      await vi.advanceTimersByTimeAsync(29_000);
      http.expectNone(REFRESCAR);
      await vi.advanceTimersByTimeAsync(2000);
      http.expectOne(REFRESCAR).error(new ProgressEvent('error'));

      await vi.advanceTimersByTimeAsync(59_000);
      http.expectNone(REFRESCAR);
      await vi.advanceTimersByTimeAsync(2000);
      http.expectOne(REFRESCAR);
    });

    it('un 401 en el reintento termina la sesión', async () => {
      const { auth } = await conRefrescoPendiente();
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      estado(500)(http.expectOne(REFRESCAR));
      await vi.advanceTimersByTimeAsync(31_000);
      estado(401)(http.expectOne(REFRESCAR));
      await vi.advanceTimersByTimeAsync(0);

      expect(auth.estaAutenticado()).toBe(false);
      expect(navegar).toHaveBeenCalled();
    });
  });

  describe('/me tras un refresco', () => {
    it('un /me que da 401, refresca y se repite con éxito deja el usuario cargado', async () => {
      const auth = crear(true);
      auth.token.set(crearJwt(segundosDesdeAhora(900)));
      const nuevo = crearJwt(segundosDesdeAhora(1800));

      const carga = firstValueFrom(auth.cargarUsuario());
      http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
      await asentar();
      http.expectOne(REFRESCAR).flush(respuesta(nuevo));
      await asentar();
      http.expectOne('/api/auth/me').flush(USUARIO_JUGADOR);

      expect(await carga).toEqual(USUARIO_JUGADOR);
      expect(auth.usuario()).toEqual(USUARIO_JUGADOR);
      expect(auth.sesionIncierta()).toBe(false);
    });
  });

  describe('expirarSesion', () => {
    it('es idempotente: la segunda llamada concurrente no sobrescribe redirectTo con un valor vacío', () => {
      const auth = crear();
      const router = TestBed.inject(Router);
      let url = '/mis-reservas';
      vi.spyOn(router, 'url', 'get').mockImplementation(() => url);
      const navegar = vi.spyOn(router, 'navigate').mockImplementation(() => {
        url = '/login?redirectTo=%2Fmis-reservas';
        return Promise.resolve(true);
      });
      auth.token.set(crearJwt(segundosDesdeAhora(900)));

      auth.expirarSesion();
      auth.expirarSesion();

      expect(navegar).toHaveBeenCalledTimes(1);
      expect(navegar).toHaveBeenCalledWith(['/login'], { queryParams: { redirectTo: '/mis-reservas' } });
    });

    it('sin sesión que expirar no navega', () => {
      const auth = crear();
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      auth.expirarSesion();

      expect(navegar).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('llama a cerrar-sesion y limpia el estado local', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(900)));
      auth.usuario.set(USUARIO_JUGADOR);

      auth.logout();

      expect(auth.token()).toBeNull(); // el estado local se limpia al instante, sin esperar al servidor
      expect(auth.usuario()).toBeNull();
      expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
      await asentar();
      const peticion = http.expectOne(CERRAR);
      expect(peticion.request.method).toBe('POST');
      peticion.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('si cerrar-sesion falla (red o 500) el estado local queda limpio igualmente', async () => {
      localStorage.setItem(CLAVE_SESION, '1');
      const auth = crear();
      auth.token.set(crearJwt(segundosDesdeAhora(900)));

      auth.logout();
      await asentar();
      http.expectOne(CERRAR).error(new ProgressEvent('error'));

      expect(auth.token()).toBeNull();
      expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
    });
  });
});
