import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ApplicationInitStatus, provideAppInitializer } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { cargarUsuarioAlArrancar } from './app.config';
import { AuthService, CLAVE_SESION } from './core/auth/auth.service';
import { USUARIO_JUGADOR, crearJwt, segundosDesdeAhora } from './testing/test-utils';

const REFRESCAR = '/api/auth/refrescar';
const asentar = (): Promise<void> => new Promise((resolver) => setTimeout(resolver, 0));
const estado = (status: number) => (p: TestRequest) =>
  p.flush({}, { status, statusText: 'Error' });

describe('inicializador de la aplicación (restaurar sesión y cargar el usuario)', () => {
  /** Arranca con (o sin) la pista de sesión; `refresco` contesta a /refrescar y `me` a /me si llega a pedirse. */
  async function arrancar(
    conPista: boolean,
    refresco?: (peticion: TestRequest) => void,
    me?: (peticion: TestRequest) => void,
  ): Promise<{ auth: AuthService; http: HttpTestingController }> {
    if (conPista) {
      localStorage.setItem(CLAVE_SESION, '1');
    }
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAppInitializer(cargarUsuarioAlArrancar),
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const estadoInit = TestBed.inject(ApplicationInitStatus);
    if (refresco) {
      await asentar();
      refresco(http.expectOne(REFRESCAR));
    }
    if (me) {
      await asentar();
      me(http.expectOne('/api/auth/me'));
    }
    await expect(estadoInit.donePromise).resolves.toBeUndefined(); // el arranque nunca rechaza ni se cuelga
    return { auth: TestBed.inject(AuthService), http };
  }

  const refrescoOk = (p: TestRequest): void =>
    p.flush({ token: crearJwt(segundosDesdeAhora(900)), tipo: 'Bearer', expiraEn: 'x' });

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('con la pista refresca la sesión y arranca con el usuario cargado', async () => {
    const { auth } = await arrancar(true, refrescoOk, (p) => p.flush(USUARIO_JUGADOR));
    expect(auth.usuario()).toEqual(USUARIO_JUGADOR);
    expect(auth.estaAutenticado()).toBe(true);
  });

  it('sin la pista no hace ninguna petición y arranca anónimo', async () => {
    const { auth, http } = await arrancar(false);
    await asentar();
    http.expectNone(REFRESCAR);
    http.expectNone('/api/auth/me');
    expect(auth.estaAutenticado()).toBe(false);
  });

  it('arranca anónimo y borra la pista si refrescar da 401', async () => {
    const { auth } = await arrancar(true, estado(401));
    expect(auth.estaAutenticado()).toBe(false);
    expect(localStorage.getItem(CLAVE_SESION)).toBeNull();
  });

  it('arranca anónimo CONSERVANDO la pista si refrescar da 429', async () => {
    const { auth } = await arrancar(true, estado(429));
    expect(auth.estaAutenticado()).toBe(false);
    expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
  });

  it('arranca anónimo CONSERVANDO la pista si no hay red', async () => {
    const { auth } = await arrancar(true, (p) => p.error(new ProgressEvent('error')));
    expect(auth.estaAutenticado()).toBe(false);
    expect(localStorage.getItem(CLAVE_SESION)).toBe('1');
  });

  it('arranca (y conserva la sesión, incierta) si tras refrescar /me da 503', async () => {
    const { auth } = await arrancar(true, refrescoOk, estado(503));
    expect(auth.estaAutenticado()).toBe(true);
    expect(auth.sesionIncierta()).toBe(true);
  });

  it('arranca (y cierra la sesión) si tras refrescar /me da 401', async () => {
    const { auth } = await arrancar(true, refrescoOk, estado(401));
    expect(auth.estaAutenticado()).toBe(false);
  });
});
