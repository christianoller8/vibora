import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FranjasMetricas } from '../../../shared/models/metricas.model';
import { MapaFranjas } from './mapa-franjas';

const FRANJAS: FranjasMetricas = {
  desde: '2026-11-01',
  hasta: '2026-11-30',
  limit: 5,
  masRentables: [
    {
      diaSemana: 'MONDAY',
      hora: '18:00',
      reservas: 5,
      ingresos: 75,
      ranurasOfrecidas: 8,
      ocupacion: 0.625,
    },
  ],
  matriz: [
    {
      diaSemana: 'MONDAY',
      hora: '18:00',
      reservas: 5,
      ingresos: 75,
      ranurasOfrecidas: 8,
      ocupacion: 0.625,
    },
    {
      diaSemana: 'SATURDAY',
      hora: '10:00',
      reservas: 1,
      ingresos: 12.5,
      ranurasOfrecidas: 8,
      ocupacion: 0.125,
    },
  ],
};

describe('MapaFranjas', () => {
  let fixture: ComponentFixture<MapaFranjas>;

  async function crear(datos: FranjasMetricas): Promise<void> {
    await TestBed.configureTestingModule({ imports: [MapaFranjas] }).compileComponents();
    fixture = TestBed.createComponent(MapaFranjas);
    fixture.componentRef.setInput('datos', datos);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const celdas = (): HTMLElement[] => Array.from(el().querySelectorAll('[role="cell"]'));

  it('es una tabla accesible con una cabecera por día y una cabecera de fila por hora', async () => {
    await crear(FRANJAS);

    expect(el().querySelector('[role="table"]')?.getAttribute('aria-label')).toContain('Ocupación');
    const dias = Array.from(el().querySelectorAll('[role="columnheader"]')).map((c) =>
      c.getAttribute('aria-label'),
    );
    expect(dias).toEqual([
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ]);
    const horas = Array.from(el().querySelectorAll('[role="rowheader"]')).map((c) =>
      c.textContent?.trim(),
    );
    expect(horas).toEqual(['10:00', '18:00']);
    expect(celdas()).toHaveLength(14); // 2 horas x 7 días
  });

  it('cada celda lleva texto accesible con día, hora, ocupación, reservas e ingresos', async () => {
    await crear(FRANJAS);

    const etiquetas = celdas().map((c) => c.getAttribute('aria-label'));
    expect(etiquetas).toContain('lunes 18:00: 62,5 % de ocupación, 5 reservas, 75,00 €');
    expect(etiquetas).toContain('sábado 10:00: 12,5 % de ocupación, 1 reserva, 12,50 €');
    expect(etiquetas).toContain('martes 10:00: sin ranuras ofrecidas');
  });

  it('el color no es el único canal: la celda con dato lleva su porcentaje escrito', async () => {
    await crear(FRANJAS);

    const lunes18 = celdas().find((c) => c.getAttribute('aria-label')?.startsWith('lunes 18:00'))!;
    expect(lunes18.textContent?.trim()).toBe('63 %');
    expect(lunes18.classList.contains('nivel-3')).toBe(true);
    const sabado10 = celdas().find((c) =>
      c.getAttribute('aria-label')?.startsWith('sábado 10:00'),
    )!;
    expect(sabado10.classList.contains('nivel-0')).toBe(true);
  });

  it('una celda sin ranuras es distinta (clase vacia) y no lleva texto', async () => {
    await crear(FRANJAS);

    const vacia = celdas().find((c) => c.getAttribute('aria-label')?.startsWith('martes 10:00'))!;
    expect(vacia.classList.contains('vacia')).toBe(true);
    expect(vacia.textContent?.trim()).toBe('');
    expect(Array.from(vacia.classList).some((c) => c.startsWith('nivel-'))).toBe(false);
  });

  it('la leyenda enseña los cinco cubos de la escala con su rango', async () => {
    await crear(FRANJAS);

    const items = Array.from(el().querySelectorAll('[data-testid="leyenda-calor"] li'));
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      '0–20 %',
      '20–40 %',
      '40–60 %',
      '60–80 %',
      '80–100 %',
    ]);
    expect(items[4].querySelector('.swatch')?.classList.contains('nivel-4')).toBe(true);
  });

  it('el mapa se desplaza dentro de su propio contenedor (la página no)', async () => {
    await crear(FRANJAS);
    expect(el().querySelector('.desplazable [role="table"]')).not.toBeNull();
  });

  it('lista las franjas más rentables', async () => {
    await crear(FRANJAS);

    const filas = Array.from(el().querySelectorAll('[data-testid="rentables"] tbody tr')).map((f) =>
      Array.from(f.querySelectorAll('th, td')).map((c) => c.textContent?.trim()),
    );
    expect(filas).toEqual([['lunes 18:00', '5', '75,00 €', '62,5 %']]);
  });

  it('sin franjas muestra un mensaje en vez de un mapa vacío', async () => {
    await crear({ ...FRANJAS, matriz: [], masRentables: [] });

    expect(el().querySelector('[data-estado="vacio"]')?.textContent).toContain(
      'No hay franjas con ranuras',
    );
    expect(el().querySelector('[role="table"]')).toBeNull();
    expect(el().querySelector('[data-testid="rentables"]')).toBeNull();
  });
});
