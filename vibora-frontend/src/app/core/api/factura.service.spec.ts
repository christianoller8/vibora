import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { Factura } from '../../shared/models/factura.model';
import { FacturaService } from './factura.service';

const FACTURA = { id: 3, numeroCompleto: 'F2026-0003' } as Factura;

describe('FacturaService', () => {
  let servicio: FacturaService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servicio = TestBed.inject(FacturaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('delClub', () => {
    it('GET /api/clubes/{id}/facturas con solo los filtros que se pasan', async () => {
      const resultado = firstValueFrom(
        servicio.delClub(5, {
          desde: '2026-07-01',
          hasta: '2026-07-31',
          tipo: 'RECTIFICATIVA',
          page: 2,
          limit: 50,
        }),
      );
      const req = http.expectOne((r) => r.url === '/api/clubes/5/facturas');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('desde')).toBe('2026-07-01');
      expect(req.request.params.get('hasta')).toBe('2026-07-31');
      expect(req.request.params.get('tipo')).toBe('RECTIFICATIVA');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('limit')).toBe('50');
      const cuerpo = {
        facturas: [FACTURA],
        totales: { cantidad: 1, base: 1, cuotaIva: 1, total: 2 },
        page: 2,
        limit: 50,
      };
      req.flush(cuerpo);
      expect(await resultado).toEqual(cuerpo);
    });

    it('sin filtros no manda ningún parámetro (ni vacíos)', () => {
      servicio.delClub(5, {}).subscribe();
      const req = http.expectOne('/api/clubes/5/facturas');
      expect(req.request.params.keys()).toEqual([]);
      req.flush({});
    });

    it('un filtro con cadena vacía o sin definir no se envía; la página 0 sí', () => {
      servicio.delClub(5, { desde: '', hasta: undefined, tipo: undefined, page: 0 }).subscribe();
      const req = http.expectOne((r) => r.url === '/api/clubes/5/facturas');
      expect(req.request.params.keys()).toEqual(['page']);
      expect(req.request.params.get('page')).toBe('0');
      req.flush({});
    });
  });

  describe('mias', () => {
    it('GET /api/facturas con page y limit', async () => {
      const resultado = firstValueFrom(servicio.mias(1, 20));
      const req = http.expectOne((r) => r.url === '/api/facturas');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('limit')).toBe('20');
      req.flush([FACTURA]);
      expect(await resultado).toEqual([FACTURA]);
    });

    it('por defecto pide la página 0', () => {
      servicio.mias().subscribe();
      const req = http.expectOne((r) => r.url === '/api/facturas');
      expect(req.request.params.get('page')).toBe('0');
      req.flush([]);
    });
  });

  it('obtener: GET /api/facturas/{id}', async () => {
    const resultado = firstValueFrom(servicio.obtener(3));
    const req = http.expectOne('/api/facturas/3');
    expect(req.request.method).toBe('GET');
    req.flush(FACTURA);
    expect(await resultado).toEqual(FACTURA);
  });

  it('deReserva: GET /api/reservas/{id}/facturas', async () => {
    const resultado = firstValueFrom(servicio.deReserva(7));
    const req = http.expectOne('/api/reservas/7/facturas');
    expect(req.request.method).toBe('GET');
    req.flush([FACTURA]);
    expect(await resultado).toEqual([FACTURA]);
  });

  describe('emitir', () => {
    it('POST /api/reservas/{id}/factura sin cuerpo cuando no hay datos de receptor; 201 = creada', async () => {
      const resultado = firstValueFrom(servicio.emitir(7));
      const req = http.expectOne('/api/reservas/7/factura');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeNull();
      req.flush(FACTURA, { status: 201, statusText: 'Created' });
      expect(await resultado).toEqual({ factura: FACTURA, creada: true });
    });

    it('200 = ya existía (creada es false)', async () => {
      const resultado = firstValueFrom(servicio.emitir(7));
      http.expectOne('/api/reservas/7/factura').flush(FACTURA, { status: 200, statusText: 'OK' });
      expect(await resultado).toEqual({ factura: FACTURA, creada: false });
    });

    it('con receptor manda solo lo rellenado, recortado', () => {
      servicio.emitir(7, { nombre: '  Ana SL ', nif: ' 12345678Z', direccion: '   ' }).subscribe();
      const req = http.expectOne('/api/reservas/7/factura');
      expect(req.request.body).toEqual({ nombre: 'Ana SL', nif: '12345678Z' });
      req.flush(FACTURA, { status: 201, statusText: 'Created' });
    });

    it('un receptor con todo en blanco equivale a no mandar cuerpo', () => {
      servicio.emitir(7, { nombre: ' ', nif: '', direccion: undefined }).subscribe();
      const req = http.expectOne('/api/reservas/7/factura');
      expect(req.request.body).toBeNull();
      req.flush(FACTURA, { status: 201, statusText: 'Created' });
    });

    it('propaga el 409', async () => {
      const resultado = firstValueFrom(servicio.emitir(7));
      http
        .expectOne('/api/reservas/7/factura')
        .flush(
          { error: 'El club no ha configurado sus datos fiscales' },
          { status: 409, statusText: 'Conflict' },
        );
      await expect(resultado).rejects.toMatchObject({ status: 409 });
    });
  });

  it('pdf: GET /api/facturas/{id}/pdf como blob', async () => {
    const resultado = firstValueFrom(servicio.pdf(3));
    const req = http.expectOne('/api/facturas/3/pdf');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    req.flush(blob);
    expect(await resultado).toBe(blob);
  });
});
