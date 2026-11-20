import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { MetricasService } from '../../../core/api/metricas.service';
import { hoyEnMadrid } from '../../../core/util/fecha';
import { DatosPanel, Granularidad, RangoMetricas } from '../../../shared/models/metricas.model';
import { USUARIO_ADMIN, crearAuthFalso, escribir } from '../../../testing/test-utils';
import { CARGADOR_CHART } from '../grafico-chart/cargador-chart';
import { granularidadPorDefecto, rangoDePreset, sumarDias } from '../rango';
import { Panel } from './panel';

interface Peticion {
  clubId: number;
  rango: RangoMetricas;
  granularidad: Granularidad;
  respuesta: Subject<DatosPanel>;
}

/** Datos de un rango con actividad; `ingresos` distingue una respuesta de otra. */
function datos(ingresos: number, cambios: Partial<DatosPanel> = {}): DatosPanel {
  return {
    resumen: {
      desde: '2026-11-01',
      hasta: '2026-11-30',
      ingresos,
      reservasConfirmadas: 10,
      reservasCanceladas: 2,
      tasaCancelacion: 0.1667,
      ticketMedio: 25,
      ingresosPerdidosPorCancelacion: 50,
      ocupacionGlobal: 0.5,
      facturado: {
        base: 100,
        cuotaIva: 21,
        total: 121,
        numeroFacturas: 3,
        numeroRectificativas: 0,
      },
    },
    ingresos: {
      desde: '2026-11-01',
      hasta: '2026-11-30',
      granularidad: 'DIA',
      serie: [{ periodo: '2026-11-01', ingresos, reservas: 4 }],
    },
    ocupacion: {
      desde: '2026-11-01',
      hasta: '2026-11-30',
      ocupacionGlobal: 0.5,
      ranurasOfrecidas: 20,
      ranurasOcupadas: 10,
      pistas: [
        {
          pistaId: 1,
          pistaNombre: 'Pista 1',
          ranurasOfrecidas: 20,
          ranurasOcupadas: 10,
          ocupacion: 0.5,
          ingresos,
        },
      ],
    },
    franjas: {
      desde: '2026-11-01',
      hasta: '2026-11-30',
      limit: 5,
      masRentables: [],
      matriz: [
        {
          diaSemana: 'MONDAY',
          hora: '18:00',
          reservas: 5,
          ingresos: 75,
          ranurasOfrecidas: 8,
          ocupacion: 0.625,
        },
      ],
    },
    cancelaciones: {
      desde: '2026-11-01',
      hasta: '2026-11-30',
      granularidad: 'DIA',
      serie: [{ periodo: '2026-11-01', canceladas: 2, confirmadas: 10, tasa: 0.1667 }],
      porPista: [{ pistaId: 1, pistaNombre: 'Pista 1', canceladas: 2, ingresosPerdidos: 50 }],
    },
    ...cambios,
  };
}

const SIN_ACTIVIDAD: DatosPanel = (() => {
  const base = datos(0);
  return {
    resumen: {
      ...base.resumen,
      ingresos: 0,
      reservasConfirmadas: 0,
      reservasCanceladas: 0,
      tasaCancelacion: null,
      ticketMedio: null,
      ingresosPerdidosPorCancelacion: 0,
      ocupacionGlobal: null,
      facturado: { base: 0, cuotaIva: 0, total: 0, numeroFacturas: 0, numeroRectificativas: 0 },
    },
    ingresos: { ...base.ingresos, serie: [{ periodo: '2026-11-01', ingresos: 0, reservas: 0 }] },
    ocupacion: {
      ...base.ocupacion,
      ranurasOfrecidas: 0,
      ranurasOcupadas: 0,
      ocupacionGlobal: null,
    },
    franjas: { ...base.franjas, matriz: [] },
    cancelaciones: {
      ...base.cancelaciones,
      serie: [{ periodo: '2026-11-01', canceladas: 0, confirmadas: 0, tasa: null }],
      porPista: [],
    },
  };
})();

describe('Panel', () => {
  let fixture: ComponentFixture<Panel>;
  let peticiones: Peticion[];
  let auth: ReturnType<typeof crearAuthFalso>;
  const hoy = hoyEnMadrid();

  async function crear(usuario = USUARIO_ADMIN): Promise<void> {
    peticiones = [];
    auth = crearAuthFalso(usuario);
    await TestBed.configureTestingModule({
      imports: [Panel],
      providers: [
        { provide: AuthService, useValue: auth },
        {
          provide: MetricasService,
          useValue: {
            todo: (clubId: number, rango: RangoMetricas, granularidad: Granularidad) => {
              const respuesta = new Subject<DatosPanel>();
              peticiones.push({ clubId, rango, granularidad, respuesta });
              return respuesta;
            },
          },
        },
        // jsdom no tiene canvas: el gráfico nunca llega a pintarse
        { provide: CARGADOR_CHART, useValue: { crear: () => new Promise(() => undefined) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Panel);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  async function asentar(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  async function pulsar(selector: string): Promise<void> {
    el().querySelector<HTMLElement>(selector)!.click();
    await asentar();
  }
  const preset = (valor: string) => pulsar(`[data-preset="${valor}"] button`);
  const granularidad = (valor: string) => pulsar(`[data-granularidad="${valor}"] button`);
  async function escribirFecha(nombre: 'desde' | 'hasta', valor: string): Promise<void> {
    escribir(el().querySelector<HTMLInputElement>(`input[name="${nombre}"]`)!, valor);
    await asentar();
  }
  const ultima = (): Peticion => peticiones[peticiones.length - 1];
  const kpi = (clave: string): string | undefined =>
    el().querySelector(`[data-kpi="${clave}"] dd`)?.textContent?.trim();

  describe('petición inicial y estados', () => {
    it('pide los últimos 30 días del club del administrador, por día', async () => {
      await crear();

      expect(peticiones).toHaveLength(1);
      expect(ultima().clubId).toBe(5);
      expect(ultima().rango).toEqual(rangoDePreset('30d', hoy));
      expect(ultima().granularidad).toBe('DIA');
    });

    it('mientras carga por primera vez muestra un indicador de carga accesible', async () => {
      await crear();
      expect(el().querySelector('mat-spinner')?.getAttribute('aria-label')).toBeTruthy();
      expect(el().querySelector('[data-kpi]')).toBeNull();
    });

    it('al llegar los datos pinta las cifras, los tres gráficos y el mapa de franjas', async () => {
      await crear();

      ultima().respuesta.next(datos(1234.5));
      await asentar();

      expect(el().querySelector('mat-spinner')).toBeNull();
      expect(kpi('ingresos')).toBe('1.234,50 €');
      const titulos = Array.from(el().querySelectorAll('app-tarjeta-grafico h2')).map((h) =>
        h.textContent?.trim(),
      );
      expect(titulos).toEqual(['Ingresos por periodo', 'Ocupación por pista', 'Cancelaciones']);
      expect(el().querySelector('app-mapa-franjas [role="table"]')).not.toBeNull();
    });

    it('un rango sin ninguna actividad muestra un mensaje amistoso y ni cifras ni gráficos a cero', async () => {
      await crear();

      ultima().respuesta.next(SIN_ACTIVIDAD);
      await asentar();

      expect(el().querySelector('[data-estado="sin-actividad"]')?.textContent).toContain(
        'No hay reservas ni facturas',
      );
      expect(el().querySelector('[data-estado="sin-actividad"]')?.textContent).toContain(
        '1 nov 2026',
      ); // fechas legibles, no ISO
      expect(el().querySelector('[data-kpi]')).toBeNull();
      expect(el().querySelector('app-tarjeta-grafico')).toBeNull();
      expect(el().querySelector('app-mapa-franjas')).toBeNull();
    });

    it('si solo falta un informe, su tarjeta dice que no hay datos y las demás siguen', async () => {
      await crear();
      const base = datos(10);

      ultima().respuesta.next({
        ...base,
        ocupacion: { ...base.ocupacion, ranurasOfrecidas: 0, ranurasOcupadas: 0 },
      });
      await asentar();

      const tarjetas = Array.from(el().querySelectorAll('app-tarjeta-grafico'));
      expect(tarjetas[1].querySelector('[data-estado="vacio"]')).not.toBeNull();
      expect(tarjetas[0].querySelector('[data-estado="vacio"]')).toBeNull();
    });

    it('lista las cancelaciones por pista con los ingresos perdidos', async () => {
      await crear();
      ultima().respuesta.next(datos(10));
      await asentar();

      const fila = el().querySelector('[data-testid="cancelaciones-pista"] tbody tr');
      expect(fila?.textContent).toContain('Pista 1');
      expect(fila?.textContent).toContain('50,00');
    });
  });

  describe('presets de rango', () => {
    it.each([
      ['7d', 'DIA'],
      ['30d', 'DIA'],
      ['90d', 'SEMANA'],
      ['mes', 'DIA'],
    ] as const)('%s pide su rango con la granularidad %s por defecto', async (valor, gran) => {
      await crear();

      await preset(valor === '30d' ? '7d' : '30d'); // salir del preset inicial para poder volver a pedirlo
      await preset(valor);

      expect(ultima().rango).toEqual(rangoDePreset(valor, hoy));
      expect(ultima().granularidad).toBe(gran);
    });

    describe('con la pestaña abierta pasada la medianoche', () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('un preset se ancla al día de HOY al pulsarlo, no al día en que se abrió el panel', async () => {
        await crear();
        expect(ultima().rango).toEqual(rangoDePreset('30d', '2026-11-14'));

        vi.setSystemTime(new Date('2026-11-15T10:00:00Z')); // pasa la medianoche
        await preset('7d');

        expect(ultima().rango).toEqual(rangoDePreset('7d', '2026-11-15'));
      });

      it('el preset «Este mes» también usa el día de hoy (el mes puede haber cambiado)', async () => {
        await crear();

        vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
        await preset('mes');

        expect(ultima().rango).toEqual({ desde: '2026-12-01', hasta: '2026-12-01' });
      });
    });

    it('el preset activo queda marcado', async () => {
      await crear();
      await preset('90d');
      const marcados = Array.from(
        el().querySelectorAll('[data-preset].mat-button-toggle-checked'),
      ).map((t) => t.getAttribute('data-preset'));
      expect(marcados).toEqual(['90d']);
    });
  });

  describe('granularidad', () => {
    it('se puede cambiar a mano y vuelve a pedir con la elegida', async () => {
      await crear();

      await granularidad('MES');

      expect(ultima().granularidad).toBe('MES');
      expect(ultima().rango).toEqual(rangoDePreset('30d', hoy));
    });

    it('al cambiar el rango se recalcula el valor por defecto (la elección manual no se arrastra)', async () => {
      await crear();
      await granularidad('MES');

      await preset('90d');

      expect(ultima().granularidad).toBe('SEMANA');
    });

    it('elegir la que ya está activa no repite la petición', async () => {
      await crear();
      const antes = peticiones.length;
      await granularidad('DIA');
      expect(peticiones.length).toBe(antes);
    });
  });

  describe('rango personalizado', () => {
    async function personalizado(): Promise<void> {
      await crear();
      await preset('personalizado');
    }

    it('enseña dos campos de fecha con el rango actual y no pide nada nuevo por abrirlos', async () => {
      await crear();
      const antes = peticiones.length;

      await preset('personalizado');

      const rango = rangoDePreset('30d', hoy);
      expect(el().querySelector<HTMLInputElement>('input[name="desde"]')?.value).toBe(rango.desde);
      expect(el().querySelector<HTMLInputElement>('input[name="hasta"]')?.value).toBe(rango.hasta);
      expect(peticiones.length).toBe(antes);
    });

    it('un rango válido se pide con su granularidad por defecto', async () => {
      await personalizado();

      await escribirFecha('desde', '2026-01-01');
      await escribirFecha('hasta', '2026-03-31');

      expect(ultima().rango).toEqual({ desde: '2026-01-01', hasta: '2026-03-31' });
      expect(ultima().granularidad).toBe(granularidadPorDefecto(90));
    });

    it('más de 366 días muestra el aviso y NO hace ninguna petición', async () => {
      await personalizado();
      const antes = peticiones.length;

      await escribirFecha('desde', sumarDias(hoy, -400));

      expect(peticiones.length).toBe(antes);
      expect(el().querySelector('[data-aviso="rango"]')?.textContent).toContain('366');
      expect(el().querySelector('[data-aviso="rango"]')?.getAttribute('role')).toBe('alert');
    });

    it('exactamente 366 días sí se pide', async () => {
      await personalizado();

      await escribirFecha('desde', sumarDias(hoy, -365));

      expect(ultima().rango).toEqual({ desde: sumarDias(hoy, -365), hasta: hoy });
      expect(el().querySelector('[data-aviso="rango"]')).toBeNull();
    });

    it('un año a medio teclear (0002) o fuera de 1970–2100 no dispara ninguna petición', async () => {
      await personalizado();
      const antes = peticiones.length;

      for (const anio of ['0002-01-01', '0020-01-01', '0202-01-01', '2101-01-01', '1969-12-31']) {
        await escribirFecha('desde', anio);
        expect(el().querySelector('[data-aviso="rango"]')?.textContent).toContain('1970 y 2100');
      }

      expect(peticiones.length).toBe(antes);
    });

    it('desde posterior a hasta avisa y no pide', async () => {
      await personalizado();
      const antes = peticiones.length;

      await escribirFecha('desde', sumarDias(hoy, 3));

      expect(peticiones.length).toBe(antes);
      expect(el().querySelector('[data-aviso="rango"]')?.textContent).toContain('posterior');
    });

    it('al corregir el rango el aviso desaparece y se pide', async () => {
      await personalizado();
      await escribirFecha('desde', sumarDias(hoy, -400));
      const antes = peticiones.length;

      await escribirFecha('desde', sumarDias(hoy, -10));

      expect(el().querySelector('[data-aviso="rango"]')).toBeNull();
      expect(peticiones.length).toBe(antes + 1);
    });

    it('un campo vacío no pide y pide las dos fechas', async () => {
      await personalizado();
      const antes = peticiones.length;

      await escribirFecha('hasta', '');

      expect(peticiones.length).toBe(antes);
      expect(el().querySelector('[data-aviso="rango"]')?.textContent).toContain('Elige');
    });

    describe('con datos ya cargados', () => {
      const contenido = (): HTMLElement => el().querySelector<HTMLElement>('.contenido')!;

      async function conDatos(): Promise<void> {
        await personalizado();
        peticiones[0].respuesta.next(datos(1234));
        await asentar();
      }

      it('un rango inválido deja los datos viejos a la vista pero atenuados e inertes, sin pedir nada', async () => {
        await conDatos();
        const antes = peticiones.length;

        await escribirFecha('desde', sumarDias(hoy, -400));

        expect(contenido().classList.contains('obsoleto')).toBe(true);
        expect(contenido().hasAttribute('inert')).toBe(true);
        expect(kpi('ingresos')).toBeDefined(); // no se vacía: al teclear un año dígito a dígito no parpadea
        expect(peticiones.length).toBe(antes);
      });

      it('al volver a un rango válido recupera el contenido: sin atenuar y sin inert', async () => {
        await conDatos();
        await escribirFecha('desde', sumarDias(hoy, -400));

        await escribirFecha('desde', sumarDias(hoy, -10));

        expect(contenido().classList.contains('obsoleto')).toBe(false);
        expect(contenido().hasAttribute('inert')).toBe(false);
      });

      it('con un rango válido desde el principio el contenido no está marcado como obsoleto', async () => {
        await conDatos();
        expect(contenido().classList.contains('obsoleto')).toBe(false);
        expect(contenido().hasAttribute('inert')).toBe(false);
      });
    });
  });

  describe('respuestas lentas y recarga', () => {
    it('una respuesta lenta del rango anterior NUNCA pisa la del rango nuevo', async () => {
      await crear();
      const lenta = peticiones[0];
      await preset('7d');
      const rapida = peticiones[1];

      rapida.respuesta.next(datos(222));
      await asentar();
      lenta.respuesta.next(datos(111)); // llega tarde
      await asentar();

      expect(kpi('ingresos')).toBe('222,00 €');
    });

    it('lo mismo si la lenta llega antes de que termine la nueva, y la nueva gana al llegar', async () => {
      await crear();
      const lenta = peticiones[0];
      await preset('7d');
      const rapida = peticiones[1];

      lenta.respuesta.next(datos(111));
      await asentar();
      expect(kpi('ingresos')).toBeUndefined(); // la antigua se descartó: sigue cargando

      rapida.respuesta.next(datos(222));
      await asentar();
      expect(kpi('ingresos')).toBe('222,00 €');
    });

    it('un error de la petición antigua tampoco pisa los datos nuevos', async () => {
      await crear();
      const lenta = peticiones[0];
      await preset('7d');

      peticiones[1].respuesta.next(datos(222));
      await asentar();
      lenta.respuesta.error(new HttpErrorResponse({ status: 500 }));
      await asentar();

      expect(kpi('ingresos')).toBe('222,00 €');
      expect(el().querySelector('[data-estado="error"]')).toBeNull();
    });

    it('al recargar conserva lo anterior (atenuado y ocupado) en vez de parpadear con un esqueleto', async () => {
      await crear();
      ultima().respuesta.next(datos(111));
      await asentar();

      await preset('7d');

      expect(kpi('ingresos')).toBe('111,00 €');
      expect(el().querySelector('.contenido')?.getAttribute('aria-busy')).toBe('true');
      expect(el().querySelector('mat-progress-bar')).not.toBeNull();

      ultima().respuesta.next(datos(222));
      await asentar();
      expect(el().querySelector('.contenido')?.getAttribute('aria-busy')).toBe('false');
      expect(el().querySelector('mat-progress-bar')).toBeNull();
    });
  });

  describe('errores', () => {
    it('403: dice con claridad que no eres administrador y no ofrece reintentar', async () => {
      await crear();

      ultima().respuesta.error(new HttpErrorResponse({ status: 403 }));
      await asentar();

      const aviso = el().querySelector('[data-estado="error"]');
      expect(aviso?.getAttribute('role')).toBe('alert');
      expect(aviso?.textContent).toContain('No eres administrador');
      expect(el().querySelector('[data-accion="reintentar"]')).toBeNull();
    });

    it('400: muestra el mensaje del backend sobre el rango', async () => {
      await crear();

      ultima().respuesta.error(
        new HttpErrorResponse({
          status: 400,
          error: { error: 'El rango no puede superar los 366 días' },
        }),
      );
      await asentar();

      expect(el().querySelector('[data-estado="error"]')?.textContent).toContain('366 días');
    });

    it('400 sin mensaje: texto genérico sobre el rango', async () => {
      await crear();

      ultima().respuesta.error(new HttpErrorResponse({ status: 400 }));
      await asentar();

      expect(el().querySelector('[data-estado="error"]')?.textContent).toContain('rango');
    });

    it('otro error: mensaje y botón Reintentar, que vuelve a pedir lo mismo', async () => {
      await crear();
      ultima().respuesta.error(new HttpErrorResponse({ status: 500 }));
      await asentar();
      expect(el().querySelector('[data-estado="error"]')?.textContent).toContain(
        'No se pudieron cargar',
      );
      const antes = peticiones.length;

      await pulsar('[data-accion="reintentar"]');

      expect(peticiones.length).toBe(antes + 1);
      expect(ultima().rango).toEqual(peticiones[0].rango);
      ultima().respuesta.next(datos(5));
      await asentar();
      expect(kpi('ingresos')).toBe('5,00 €');
      expect(el().querySelector('[data-estado="error"]')).toBeNull();
    });

    it('tras un error, al reintentar no reaparecen los datos viejos de otro rango mientras carga', async () => {
      await crear();
      ultima().respuesta.next(datos(111));
      await asentar();
      await preset('7d');
      ultima().respuesta.error(new HttpErrorResponse({ status: 500 }));
      await asentar();

      await pulsar('[data-accion="reintentar"]');

      expect(kpi('ingresos')).toBeUndefined();
      expect(el().querySelector('mat-spinner')).not.toBeNull();
    });

    it('un error en pantalla desaparece al teclear un rango inválido: sin Reintentar y con el aviso del rango', async () => {
      await crear();
      ultima().respuesta.error(new HttpErrorResponse({ status: 500 }));
      await asentar();
      expect(el().querySelector('[data-accion="reintentar"]')).not.toBeNull();
      await preset('personalizado');
      const antes = peticiones.length;

      await escribirFecha('desde', sumarDias(hoy, -400));

      expect(el().querySelector('[data-estado="error"]')).toBeNull();
      expect(el().querySelector('[data-accion="reintentar"]')).toBeNull();
      expect(el().querySelector('[data-aviso="rango"]')).not.toBeNull();
      expect(peticiones.length).toBe(antes);

      await escribirFecha('desde', sumarDias(hoy, -10));

      expect(el().querySelector('[data-aviso="rango"]')).toBeNull();
      expect(peticiones.length).toBe(antes + 1);
    });

    it('un error de permiso o de rango también se retira al teclear un rango inválido', async () => {
      await crear();
      ultima().respuesta.error(new HttpErrorResponse({ status: 403 }));
      await asentar();
      await preset('personalizado');

      await escribirFecha('desde', sumarDias(hoy, -400));

      expect(el().querySelector('[data-estado="error"]')).toBeNull();
      expect(el().querySelector('[data-aviso="rango"]')).not.toBeNull();
    });

    it('un error tras haber mostrado datos sustituye a los datos viejos (no se mezclan)', async () => {
      await crear();
      ultima().respuesta.next(datos(111));
      await asentar();
      await preset('7d');

      ultima().respuesta.error(new HttpErrorResponse({ status: 500 }));
      await asentar();

      expect(el().querySelector('[data-kpi]')).toBeNull();
      expect(el().querySelector('[data-estado="error"]')).not.toBeNull();
    });
  });

  describe('sin club', () => {
    it('si el usuario no tiene club no pide nada y lo explica', async () => {
      await crear({ ...USUARIO_ADMIN, clubId: null, clubNombre: null });

      expect(peticiones).toHaveLength(0);
      expect(el().querySelector('[data-estado="sin-club"]')?.textContent).toContain('club');
    });
  });

  it('el encabezado lleva el nombre del club', async () => {
    await crear();
    expect(el().querySelector('h1')?.textContent).toContain('Club Víbora Demo');
  });
});
