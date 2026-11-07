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
import { AuthService, CLAVE_TOKEN } from './core/auth/auth.service';
import {
  USUARIO_JUGADOR,
  crearJwt,
  segundosDesdeAhora,
} from './testing/test-utils';

describe('inicializador de la aplicación (carga del usuario)', () => {
  async function arrancar(respuesta: (peticion: TestRequest) => void): Promise<AuthService> {
    localStorage.setItem(CLAVE_TOKEN, crearJwt(segundosDesdeAhora(3600)));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideAppInitializer(cargarUsuarioAlArrancar),
      ],
    });
    const estado = TestBed.inject(ApplicationInitStatus);
    respuesta(TestBed.inject(HttpTestingController).expectOne('/api/auth/me'));
    await expect(estado.donePromise).resolves.toBeUndefined(); // el arranque nunca rechaza ni se cuelga
    return TestBed.inject(AuthService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('arranca con el usuario cargado cuando /me responde', async () => {
    const auth = await arrancar((p) => p.flush(USUARIO_JUGADOR));
    expect(auth.usuario()).toEqual(USUARIO_JUGADOR);
  });

  it('arranca (y cierra la sesión) con un 401', async () => {
    const auth = await arrancar((p) => p.flush({}, { status: 401, statusText: 'Unauthorized' }));
    expect(auth.estaAutenticado()).toBe(false);
  });

  it('arranca (y conserva la sesión, incierta) con un 503', async () => {
    const auth = await arrancar((p) => p.flush({}, { status: 503, statusText: 'Unavailable' }));
    expect(auth.estaAutenticado()).toBe(true);
    expect(auth.sesionIncierta()).toBe(true);
  });

  it('arranca (y conserva la sesión, incierta) sin red', async () => {
    const auth = await arrancar((p) => p.error(new ProgressEvent('error')));
    expect(auth.estaAutenticado()).toBe(true);
    expect(auth.sesionIncierta()).toBe(true);
  });
});
