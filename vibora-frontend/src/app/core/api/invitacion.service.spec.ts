import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { InvitacionService } from './invitacion.service';

describe('InvitacionService', () => {
  let servicio: InvitacionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servicio = TestBed.inject(InvitacionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('invita con POST /api/clubes/{id}/invitaciones y {email, rol}; devuelve el mensaje (202)', async () => {
    const resultado = firstValueFrom(
      servicio.crear(5, { email: 'pepe@club.es', rol: 'MANTENIMIENTO' }),
    );
    const req = http.expectOne('/api/clubes/5/invitaciones');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'pepe@club.es', rol: 'MANTENIMIENTO' });
    req.flush({ mensaje: 'Si el correo es válido...' }, { status: 202, statusText: 'Accepted' });
    expect((await resultado).mensaje).toBe('Si el correo es válido...');
  });

  it('lista sin filtro con GET y sin parámetros', async () => {
    const resultado = firstValueFrom(servicio.listar(5));
    const req = http.expectOne('/api/clubes/5/invitaciones');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
    expect(await resultado).toEqual([]);
  });

  it('lista con filtro por estado: ?estado=PENDIENTE', async () => {
    const resultado = firstValueFrom(servicio.listar(5, 'PENDIENTE'));
    const req = http.expectOne('/api/clubes/5/invitaciones?estado=PENDIENTE');
    expect(req.request.params.get('estado')).toBe('PENDIENTE');
    req.flush([]);
    await resultado;
  });

  it('cancela con DELETE /api/clubes/{id}/invitaciones/{id} (204)', async () => {
    const resultado = firstValueFrom(servicio.cancelar(5, 9));
    const req = http.expectOne('/api/clubes/5/invitaciones/9');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await resultado).toBeNull();
  });

  it('mis invitaciones: GET /api/invitaciones/mias', async () => {
    const resultado = firstValueFrom(servicio.mias());
    const req = http.expectOne('/api/invitaciones/mias');
    expect(req.request.method).toBe('GET');
    req.flush([]);
    expect(await resultado).toEqual([]);
  });

  it('acepta con POST /api/invitaciones/{id}/aceptar y devuelve el resultado', async () => {
    const resultado = firstValueFrom(servicio.aceptar(9));
    const req = http.expectOne('/api/invitaciones/9/aceptar');
    expect(req.request.method).toBe('POST');
    req.flush({ requiereNuevoLogin: true, clubNombre: 'Club Víbora', rol: 'MONITOR' });
    expect(await resultado).toEqual({
      requiereNuevoLogin: true,
      clubNombre: 'Club Víbora',
      rol: 'MONITOR',
    });
  });

  it('rechaza con POST /api/invitaciones/{id}/rechazar (204)', async () => {
    const resultado = firstValueFrom(servicio.rechazar(9));
    const req = http.expectOne('/api/invitaciones/9/rechazar');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await resultado).toBeNull();
  });
});
