import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EspecGrafico } from '../mapeo';
import { CARGADOR_CHART, CargadorChart } from '../grafico-chart/cargador-chart';
import { TarjetaGrafico } from './tarjeta-grafico';

const UNA_SERIE: EspecGrafico = {
  tipo: 'columnas',
  etiquetas: ['14 nov', '15 nov'],
  etiquetasLargas: ['14 nov 2026', '15 nov 2026'],
  series: [{ clave: 'serie1', nombre: 'Ingresos', valores: [120, 1234.5], formato: 'euros' }],
  descripcion: 'Ingresos por día: total 1.354,50 €',
  tabla: {
    columnas: ['Periodo', 'Ingresos'],
    filas: [
      ['14 nov 2026', '120,00 €'],
      ['15 nov 2026', '1.234,50 €'],
    ],
  },
};

const DOS_SERIES: EspecGrafico = {
  ...UNA_SERIE,
  tipo: 'columnas-apiladas',
  series: [
    { clave: 'serie1', nombre: 'Confirmadas', valores: [5, 3], formato: 'entero' },
    { clave: 'serie2', nombre: 'Canceladas', valores: [1, 0], formato: 'entero' },
  ],
  tabla: {
    columnas: ['Periodo', 'Confirmadas', 'Canceladas'],
    filas: [
      ['14 nov 2026', '5', '1'],
      ['15 nov 2026', '3', '0'],
    ],
  },
};

describe('TarjetaGrafico', () => {
  let fixture: ComponentFixture<TarjetaGrafico>;

  // jsdom no tiene canvas: un cargador que nunca resuelve basta para casi todos estos tests
  const CARGADOR_PENDIENTE: CargadorChart = { crear: () => new Promise(() => undefined) };

  async function crear(
    espec: EspecGrafico | null,
    cargador: CargadorChart = CARGADOR_PENDIENTE,
  ): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [TarjetaGrafico],
      providers: [{ provide: CARGADOR_CHART, useValue: cargador }],
    }).compileComponents();
    fixture = TestBed.createComponent(TarjetaGrafico);
    fixture.componentRef.setInput('titulo', 'Ingresos por periodo');
    fixture.componentRef.setInput('espec', espec);
    fixture.componentRef.setInput('mensajeVacio', 'No hay ingresos en este periodo.');
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const boton = (): HTMLButtonElement =>
    el().querySelector('button[data-accion="alternar-tabla"]')!;
  async function alternar(): Promise<void> {
    boton().click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('lleva un encabezado con el título', async () => {
    await crear(UNA_SERIE);
    expect(el().querySelector('h2')?.textContent).toContain('Ingresos por periodo');
  });

  it('el gráfico va en un role="img" con el resumen en texto como aria-label', async () => {
    await crear(UNA_SERIE);
    const figura = el().querySelector('[role="img"]');
    expect(figura?.getAttribute('aria-label')).toBe('Ingresos por día: total 1.354,50 €');
    expect(figura?.querySelector('app-grafico-chart')).not.toBeNull();
  });

  it('sin datos (null) muestra el mensaje amistoso, sin gráfico, sin tabla y sin botón', async () => {
    await crear(null);
    expect(el().querySelector('[data-estado="vacio"]')?.textContent).toContain(
      'No hay ingresos en este periodo.',
    );
    expect(el().querySelector('app-grafico-chart')).toBeNull();
    expect(el().querySelector('table')).toBeNull();
    expect(boton()).toBeNull();
  });

  describe('si no se puede cargar Chart.js', () => {
    let hayRed = false;
    const SIN_RED: CargadorChart = {
      crear: () => (hayRed ? new Promise(() => undefined) : Promise.reject(new Error('sin red'))),
    };
    beforeEach(() => {
      hayRed = false;
    });
    const aviso = (): HTMLElement | null => el().querySelector('[role="alert"]');

    async function crearSinRed(): Promise<void> {
      await crear(UNA_SERIE, SIN_RED);
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      await fixture.whenStable();
    }

    it('avisa con un role="alert" que remite a la tabla', async () => {
      await crearSinRed();
      expect(aviso()?.textContent).toContain('Ver como tabla');
    });

    it('el aviso NO va dentro del role="img" (sus hijos son presentacionales y no se anunciarían)', async () => {
      await crearSinRed();
      const figura = el().querySelector('[role="img"]');
      expect(aviso()).not.toBeNull();
      expect(figura?.contains(aviso())).toBe(false);
    });

    /**
     * Cuenta las veces que el aviso entra en el DOM. Mirar solo el estado final no sirve: el gráfico nuevo borra el
     * fallo en su primer `pintar`, pero antes el aviso viejo ya habría parpadeado (y un lector de pantalla lo anuncia).
     */
    function vigilarAviso(): () => number {
      let entradas = 0;
      const cuenta = (registros: MutationRecord[]): void => {
        for (const r of registros) {
          r.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement && n.matches('[data-aviso="grafico"]')) entradas++;
          });
        }
      };
      const observador = new MutationObserver(cuenta);
      observador.observe(el(), { childList: true, subtree: true });
      return () => {
        cuenta(observador.takeRecords());
        observador.disconnect();
        return entradas;
      };
    }

    it('al pasar a la tabla el aviso desaparece, y al volver al gráfico no reaparece el aviso viejo', async () => {
      await crearSinRed();

      await alternar();
      expect(aviso()).toBeNull();

      hayRed = true; // vuelve la red: el gráfico nuevo arranca de cero y aún no ha fallado
      const entradas = vigilarAviso();
      await alternar();
      expect(aviso()).toBeNull();
      expect(entradas()).toBe(0);
    });

    it('si el gráfico desaparece (espec null) y vuelve, el aviso viejo no reaparece mientras el nuevo carga', async () => {
      await crearSinRed();
      expect(aviso()).not.toBeNull();

      fixture.componentRef.setInput('espec', null); // el panel anula los datos al fallar una petición
      await fixture.whenStable();
      expect(aviso()).toBeNull();

      hayRed = true; // el nuevo gráfico se queda cargando: su primer `pintar` no termina
      const entradas = vigilarAviso();
      fixture.componentRef.setInput('espec', UNA_SERIE);
      await fixture.whenStable();

      expect(aviso()).toBeNull();
      expect(entradas()).toBe(0);
    });
  });

  describe('Ver como tabla', () => {
    it('empieza mostrando el gráfico, con el botón sin pulsar', async () => {
      await crear(UNA_SERIE);
      expect(boton().textContent).toContain('Ver como tabla');
      expect(boton().getAttribute('aria-pressed')).toBe('false');
      expect(el().querySelector('table')).toBeNull();
    });

    it('al pulsar muestra una tabla con los mismos números y oculta el gráfico', async () => {
      await crear(UNA_SERIE);

      await alternar();

      expect(boton().textContent).toContain('Ver como gráfico');
      expect(boton().getAttribute('aria-pressed')).toBe('true');
      expect(el().querySelector('app-grafico-chart')).toBeNull();
      const cabecera = Array.from(el().querySelectorAll('thead th')).map((c) =>
        c.textContent?.trim(),
      );
      expect(cabecera).toEqual(['Periodo', 'Ingresos']);
      const filas = Array.from(el().querySelectorAll('tbody tr')).map((fila) =>
        Array.from(fila.querySelectorAll('th, td')).map((c) => c.textContent?.trim()),
      );
      expect(filas).toEqual([
        ['14 nov 2026', '120,00 €'],
        ['15 nov 2026', '1.234,50 €'],
      ]);
    });

    it('la tabla tiene título accesible y la etiqueta de cada fila es una cabecera de fila', async () => {
      await crear(UNA_SERIE);
      await alternar();
      expect(el().querySelector('table caption')?.textContent).toContain('Ingresos por periodo');
      expect(el().querySelector('tbody tr th')?.getAttribute('scope')).toBe('row');
    });

    it('volver a pulsar vuelve al gráfico', async () => {
      await crear(UNA_SERIE);
      await alternar();
      await alternar();
      expect(el().querySelector('table')).toBeNull();
      expect(el().querySelector('app-grafico-chart')).not.toBeNull();
    });
  });

  describe('leyenda', () => {
    it('con una sola serie no hay leyenda (el título ya la nombra)', async () => {
      await crear(UNA_SERIE);
      expect(el().querySelector('[data-testid="leyenda"]')).toBeNull();
    });

    it('con dos series hay leyenda con el nombre de cada una, en texto y con su swatch', async () => {
      await crear(DOS_SERIES);
      const items = Array.from(el().querySelectorAll('[data-testid="leyenda"] li'));
      expect(items.map((i) => i.textContent?.trim())).toEqual(['Confirmadas', 'Canceladas']);
      expect(items[0].querySelector('.swatch')?.classList.contains('serie1')).toBe(true);
      expect(items[1].querySelector('.swatch')?.classList.contains('serie2')).toBe(true);
    });
  });
});
