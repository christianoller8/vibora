import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DatosPanel } from '../../shared/models/metricas.model';
import { MetricasService } from './metricas.service';

const RANGO = { desde: '2026-11-01', hasta: '2026-11-30' };

describe('MetricasService', () => {
  let servicio: MetricasService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servicio = TestBed.inject(MetricasService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function peticion(ruta: string) {
    return http.expectOne((r) => r.url === `/api/clubes/5/metricas/${ruta}`);
  }

  it('resumen: GET con desde y hasta', () => {
    servicio.resumen(5, RANGO).subscribe();
    const r = peticion('resumen');
    expect(r.request.method).toBe('GET');
    expect(r.request.params.get('desde')).toBe('2026-11-01');
    expect(r.request.params.get('hasta')).toBe('2026-11-30');
    r.flush({});
  });

  it('ingresos y cancelaciones: mandan la granularidad', () => {
    servicio.ingresos(5, RANGO, 'SEMANA').subscribe();
    servicio.cancelaciones(5, RANGO, 'MES').subscribe();
    const ingresos = peticion('ingresos');
    const cancelaciones = peticion('cancelaciones');
    expect(ingresos.request.params.get('granularidad')).toBe('SEMANA');
    expect(cancelaciones.request.params.get('granularidad')).toBe('MES');
    expect(ingresos.request.params.get('desde')).toBe('2026-11-01');
    ingresos.flush({});
    cancelaciones.flush({});
  });

  it('ocupacion: solo el rango', () => {
    servicio.ocupacion(5, RANGO).subscribe();
    const r = peticion('ocupacion');
    expect(r.request.params.keys().sort()).toEqual(['desde', 'hasta']);
    r.flush({});
  });

  it('franjas: manda el límite de las más rentables', () => {
    servicio.franjas(5, RANGO, 5).subscribe();
    const r = peticion('franjas');
    expect(r.request.params.get('limit')).toBe('5');
    r.flush({});
  });

  it('todo: pide los cinco informes a la vez y los junta (franjas con límite 5)', () => {
    let datos: DatosPanel | undefined;
    servicio.todo(5, RANGO, 'DIA').subscribe((d) => (datos = d));

    const resumen = peticion('resumen');
    const ingresos = peticion('ingresos');
    const ocupacion = peticion('ocupacion');
    const franjas = peticion('franjas');
    const cancelaciones = peticion('cancelaciones');
    expect(franjas.request.params.get('limit')).toBe('5');
    expect(ingresos.request.params.get('granularidad')).toBe('DIA');
    expect(datos).toBeUndefined(); // hasta que responden todos no emite nada

    resumen.flush({ id: 'resumen' });
    ingresos.flush({ id: 'ingresos' });
    ocupacion.flush({ id: 'ocupacion' });
    franjas.flush({ id: 'franjas' });
    expect(datos).toBeUndefined();
    cancelaciones.flush({ id: 'cancelaciones' });

    expect(datos).toEqual({
      resumen: { id: 'resumen' },
      ingresos: { id: 'ingresos' },
      ocupacion: { id: 'ocupacion' },
      franjas: { id: 'franjas' },
      cancelaciones: { id: 'cancelaciones' },
    });
  });

  it('todo: si uno falla, falla el conjunto y se cancelan los demás', () => {
    let error: unknown;
    servicio.todo(5, RANGO, 'DIA').subscribe({ error: (e: unknown) => (error = e) });

    peticion('resumen').flush('no', { status: 403, statusText: 'Forbidden' });

    expect((error as { status: number }).status).toBe(403);
    // forkJoin cancela el resto: ninguna petición queda abierta (http.verify en afterEach lo comprueba al descartarlas)
    http.match(() => true).forEach((r) => expect(r.cancelled).toBe(true));
  });
});
