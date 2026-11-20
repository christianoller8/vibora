import { EspecGrafico } from '../mapeo';
import { EstiloGrafico, construirConfig, leerEstilo } from './config-chart';

const ESTILO: EstiloGrafico = {
  series: { serie1: '#111111', serie2: '#222222' },
  texto: '#333333',
  rejilla: '#444444',
  eje: '#555555',
  superficie: '#666666',
  sinAnimacion: false,
};

const COLUMNAS: EspecGrafico = {
  tipo: 'columnas',
  etiquetas: ['14 nov', '15 nov'],
  etiquetasLargas: ['14 nov 2026', '15 nov 2026'],
  series: [{ clave: 'serie1', nombre: 'Ingresos', valores: [120, 1234.5], formato: 'euros' }],
  descripcion: 'x',
  tabla: { columnas: [], filas: [] },
};

const APILADAS: EspecGrafico = {
  tipo: 'columnas-apiladas',
  etiquetas: ['14 nov', '15 nov'],
  etiquetasLargas: ['14 nov 2026', '15 nov 2026'],
  series: [
    { clave: 'serie1', nombre: 'Confirmadas', valores: [5, 3], formato: 'entero' },
    { clave: 'serie2', nombre: 'Canceladas', valores: [1, 0], formato: 'entero' },
  ],
  descripcion: 'x',
  tabla: { columnas: [], filas: [] },
};

const BARRAS: EspecGrafico = {
  tipo: 'barras',
  etiquetas: ['Pista 2', 'Pista 1'],
  etiquetasLargas: ['Pista 2', 'Pista 1'],
  series: [{ clave: 'serie1', nombre: 'Ocupación', valores: [0.7, null], formato: 'porcentaje' }],
  descripcion: 'x',
  tabla: { columnas: [], filas: [] },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const escalas = (c: any) => c.options.scales;

describe('construirConfig', () => {
  it('columnas: un dataset por serie con los mismos valores y etiquetas que la especificación', () => {
    const config = construirConfig(COLUMNAS, ESTILO) as any;
    expect(config.type).toBe('bar');
    expect(config.data.labels).toEqual(['14 nov', '15 nov']);
    expect(config.data.datasets).toHaveLength(1);
    expect(config.data.datasets[0].data).toEqual([120, 1234.5]);
    expect(config.data.datasets[0].label).toBe('Ingresos');
    expect(config.options.indexAxis).toBe('x');
  });

  it('el color de cada serie sale de su ranura (no de su posición)', () => {
    const config = construirConfig(APILADAS, ESTILO) as any;
    expect(config.data.datasets[0].backgroundColor).toBe('#111111');
    expect(config.data.datasets[1].backgroundColor).toBe('#222222');
  });

  it('barras: horizontales, con el eje de valores de 0 a 1', () => {
    const config = construirConfig(BARRAS, ESTILO) as any;
    expect(config.options.indexAxis).toBe('y');
    expect(escalas(config).x.min).toBe(0);
    expect(escalas(config).x.max).toBe(1);
    expect(config.data.datasets[0].data).toEqual([0.7, null]);
  });

  it('apiladas: ambos ejes apilados y un hueco de 2 px del color de la superficie entre segmentos', () => {
    const config = construirConfig(APILADAS, ESTILO) as any;
    expect(escalas(config).x.stacked).toBe(true);
    expect(escalas(config).y.stacked).toBe(true);
    expect(config.data.datasets[0].borderColor).toBe('#666666');
    expect(config.data.datasets[0].borderWidth).toBe(2);
  });

  it('columnas sin apilar: marcas finas con el extremo redondeado y el eje a partir de cero', () => {
    const config = construirConfig(COLUMNAS, ESTILO) as any;
    expect(config.data.datasets[0].maxBarThickness).toBeLessThanOrEqual(32);
    expect(config.data.datasets[0].borderRadius).toBe(4);
    expect(escalas(config).y.beginAtZero).toBe(true);
    expect(escalas(config).x.stacked).toBeFalsy();
  });

  it('el eje de valores formatea con el formato de la serie', () => {
    const euros = construirConfig(COLUMNAS, ESTILO) as any;
    expect(escalas(euros).y.ticks.callback(1234.5)).toBe('1.234,50 €');
    const porcentaje = construirConfig(BARRAS, ESTILO) as any;
    expect(escalas(porcentaje).x.ticks.callback(0.7)).toBe('70 %');
  });

  it('los ticks solo se fuerzan a enteros para recuentos (los porcentajes y euros llevan decimales)', () => {
    const entero = construirConfig(APILADAS, ESTILO) as any;
    expect(escalas(entero).y.ticks.precision).toBe(0);
    expect(escalas(construirConfig(BARRAS, ESTILO) as any).x.ticks.precision).toBeUndefined();
    expect(escalas(construirConfig(COLUMNAS, ESTILO) as any).y.ticks.precision).toBeUndefined();
  });

  it('colores del eje, rejilla y texto salen del estilo', () => {
    const config = construirConfig(COLUMNAS, ESTILO) as any;
    expect(escalas(config).y.grid.color).toBe('#444444');
    expect(escalas(config).y.border.color).toBe('#555555');
    expect(escalas(config).y.ticks.color).toBe('#333333');
    expect(escalas(config).x.ticks.color).toBe('#333333');
  });

  it('con movimiento reducido no hay animaciones', () => {
    expect(
      (construirConfig(COLUMNAS, { ...ESTILO, sinAnimacion: true }) as any).options.animation,
    ).toBe(false);
    expect((construirConfig(COLUMNAS, ESTILO) as any).options.animation).not.toBe(false);
  });

  it('la leyenda del propio Chart.js está apagada (la leyenda es HTML accesible) y el tooltip usa las etiquetas largas', () => {
    const config = construirConfig(APILADAS, ESTILO) as any;
    expect(config.options.plugins.legend.display).toBe(false);
    const tooltip = config.options.plugins.tooltip.callbacks;
    expect(tooltip.title([{ dataIndex: 1 }])).toBe('15 nov 2026');
    expect(tooltip.label({ datasetIndex: 0, dataIndex: 0 })).toBe('Confirmadas: 5');
    expect(tooltip.label({ datasetIndex: 1, dataIndex: 0 })).toBe('Canceladas: 1');
  });

  it('el tooltip de un valor sin dato dice "—"', () => {
    const config = construirConfig(BARRAS, ESTILO) as any;
    expect(config.options.plugins.tooltip.callbacks.label({ datasetIndex: 0, dataIndex: 1 })).toBe(
      'Ocupación: —',
    );
  });

  it('el gráfico se adapta al contenedor, que fija el alto (incluye el eje)', () => {
    const config = construirConfig(COLUMNAS, ESTILO) as any;
    expect(config.options.responsive).toBe(true);
    expect(config.options.maintainAspectRatio).toBe(false);
  });
});

describe('leerEstilo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lee los colores de las variables CSS del elemento', () => {
    const el = document.createElement('div');
    const valores: Record<string, string> = {
      '--viz-serie-1': ' #aa0000 ',
      '--viz-serie-2': '#00aa00',
      '--viz-texto': '#0000aa',
      '--viz-rejilla': '#101010',
      '--viz-eje': '#202020',
      '--viz-superficie': '#303030',
    };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (nombre: string) => valores[nombre] ?? '',
    } as CSSStyleDeclaration);

    const estilo = leerEstilo(el);

    expect(estilo.series).toEqual({ serie1: '#aa0000', serie2: '#00aa00' });
    expect(estilo.texto).toBe('#0000aa');
    expect(estilo.rejilla).toBe('#101010');
    expect(estilo.eje).toBe('#202020');
    expect(estilo.superficie).toBe('#303030');
  });

  it('un color que el canvas no entiende (light-dark(), var()) se resuelve con un elemento sonda', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((e: Element) =>
      e.tagName === 'SPAN'
        ? { color: 'rgb(1, 2, 3)' }
        : {
            getPropertyValue: (n: string) =>
              n === '--viz-rejilla' ? 'light-dark(#c4c6d0, #44474e)' : '#abcdef',
          }) as unknown as typeof getComputedStyle);

    const estilo = leerEstilo(el);

    expect(estilo.rejilla).toBe('rgb(1, 2, 3)');
    expect(estilo.texto).toBe('#abcdef'); // un hexadecimal pasa tal cual, sin sonda
    expect(document.querySelector('span')).toBeNull(); // la sonda no se queda en el documento
    el.remove();
  });

  it('si la sonda no puede resolverlo usa el color de reserva', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((e: Element) =>
      e.tagName === 'SPAN'
        ? { color: '' }
        : {
            getPropertyValue: () => 'light-dark(#c4c6d0, #44474e)',
          }) as unknown as typeof getComputedStyle);

    expect(leerEstilo(el).rejilla).toMatch(/^#[0-9a-f]{6}$/i);
    el.remove();
  });

  it('si las variables no existen usa unos colores de reserva legibles (nunca cadenas vacías)', () => {
    const estilo = leerEstilo(document.createElement('div'));
    for (const color of [
      estilo.series.serie1,
      estilo.series.serie2,
      estilo.texto,
      estilo.rejilla,
      estilo.eje,
      estilo.superficie,
    ]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  describe('prefers-reduced-motion', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    const fingir = (reducido: boolean | undefined): void => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value:
          reducido === undefined
            ? undefined
            : (consulta: string) => ({ matches: reducido && consulta.includes('reduce') }),
      });
    };
    afterEach(() => {
      if (original) {
        Object.defineProperty(window, 'matchMedia', original);
      } else {
        Reflect.deleteProperty(window, 'matchMedia');
      }
    });

    it('sinAnimacion sigue a la preferencia del usuario', () => {
      const el = document.createElement('div');
      fingir(true);
      expect(leerEstilo(el).sinAnimacion).toBe(true);
      fingir(false);
      expect(leerEstilo(el).sinAnimacion).toBe(false);
    });

    it('sin matchMedia (jsdom) no hay movimiento reducido y no lanza', () => {
      fingir(undefined);
      expect(leerEstilo(document.createElement('div')).sinAnimacion).toBe(false);
    });
  });
});
