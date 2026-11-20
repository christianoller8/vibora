import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { EspecGrafico } from '../mapeo';
import { CARGADOR_CHART, CargadorChart, GraficoVivo } from './cargador-chart';
import { GraficoChart } from './grafico-chart';

function espec(valores: number[]): EspecGrafico {
  return {
    tipo: 'columnas',
    etiquetas: valores.map((_, i) => `d${i}`),
    etiquetasLargas: valores.map((_, i) => `día ${i}`),
    series: [{ clave: 'serie1', nombre: 'Ingresos', valores, formato: 'euros' }],
    descripcion: 'x',
    tabla: { columnas: [], filas: [] },
  };
}

interface ConfigFalsa {
  data: { datasets: { data: unknown[] }[] };
}

interface VivoFalso {
  destroy: Mock<() => void>;
  actualizar: Mock<(config: unknown) => void>;
}

/**
 * Cargador falso: cada llamada a `crear` queda pendiente hasta que el test la resuelve (o la rechaza). Imita a Chart.js:
 * UN canvas solo admite UN gráfico vivo; construir otro sobre él falla con «Canvas is already in use» hasta que se
 * destruye el primero. El "constructor" corre al resolver, como el `new Chart` que sigue al `import()` del chunk.
 */
function cargadorFalso() {
  const enUso = new Set<HTMLCanvasElement>();
  const llamadas: {
    config: ConfigFalsa;
    resolver: () => VivoFalso | null;
    rechazar: (e: unknown) => void;
  }[] = [];
  const cargador: CargadorChart = {
    crear: (canvas, config) =>
      new Promise<GraficoVivo>((resolve, reject) => {
        llamadas.push({
          config: config as unknown as ConfigFalsa,
          resolver: () => {
            if (enUso.has(canvas)) {
              reject(new Error('Canvas is already in use'));
              return null;
            }
            enUso.add(canvas);
            const vivo: VivoFalso = {
              destroy: vi.fn(() => {
                enUso.delete(canvas);
              }),
              actualizar: vi.fn(),
            };
            resolve(vivo);
            return vivo;
          },
          rechazar: reject,
        });
      }),
  };
  return { cargador, llamadas };
}

describe('GraficoChart', () => {
  let fixture: ComponentFixture<GraficoChart>;
  let falso: ReturnType<typeof cargadorFalso>;

  async function crear(inicial: EspecGrafico): Promise<void> {
    falso = cargadorFalso();
    await TestBed.configureTestingModule({
      imports: [GraficoChart],
      providers: [{ provide: CARGADOR_CHART, useValue: falso.cargador }],
    }).compileComponents();
    fixture = TestBed.createComponent(GraficoChart);
    fixture.componentRef.setInput('espec', inicial);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const asentar = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('pide el gráfico con los datos de la especificación sobre un canvas', async () => {
    await crear(espec([1, 2, 3]));

    expect(el().querySelector('canvas')).not.toBeNull();
    expect(falso.llamadas).toHaveLength(1);
    expect(falso.llamadas[0].config.data.datasets[0].data).toEqual([1, 2, 3]);
  });

  it('al cambiar la especificación actualiza el gráfico vivo con los datos nuevos, sin recrearlo', async () => {
    await crear(espec([1]));
    const vivo = falso.llamadas[0].resolver()!;
    await asentar();

    fixture.componentRef.setInput('espec', espec([9, 9]));
    await fixture.whenStable();

    expect(falso.llamadas).toHaveLength(1);
    expect(vivo.destroy).not.toHaveBeenCalled();
    expect(vivo.actualizar).toHaveBeenCalledTimes(1);
    const config = vivo.actualizar.mock.calls[0][0] as ConfigFalsa;
    expect(config.data.datasets[0].data).toEqual([9, 9]);
  });

  it('si la especificación cambia mientras carga Chart.js no se crea un segundo gráfico sobre el mismo canvas', async () => {
    await crear(espec([1]));
    fixture.componentRef.setInput('espec', espec([2]));
    await fixture.whenStable();

    // todo lo que se haya pedido llega junto: con dos `crear` pendientes, el segundo `new Chart` fallaría
    const vivos = falso.llamadas.map((l) => l.resolver());
    await asentar();

    expect(fixture.componentInstance.fallo()).toBe(false);
    expect(falso.llamadas).toHaveLength(1);
    const vivo = vivos[0]!;
    expect(vivo.destroy).not.toHaveBeenCalled();
    // y el gráfico acaba con los datos de la ÚLTIMA especificación
    const config = vivo.actualizar.mock.calls.at(-1)?.[0] as ConfigFalsa;
    expect(config.data.datasets[0].data).toEqual([2]);
  });

  it('al destruir el componente destruye el gráfico vivo', async () => {
    await crear(espec([1]));
    const vivo = falso.llamadas[0].resolver()!;
    await asentar();

    fixture.destroy();

    expect(vivo.destroy).toHaveBeenCalledTimes(1);
  });

  it('si el componente se destruye antes de que llegue el gráfico, este se destruye al llegar', async () => {
    await crear(espec([1]));

    fixture.destroy();
    const vivo = falso.llamadas[0].resolver()!;
    await asentar();

    expect(vivo.destroy).toHaveBeenCalledTimes(1);
  });

  it('si no se puede cargar Chart.js marca el fallo (lo pinta quien lo aloja, no él), sin lanzar', async () => {
    await crear(espec([1]));
    expect(fixture.componentInstance.fallo()).toBe(false);

    falso.llamadas[0].rechazar(new Error('sin red'));
    await asentar();

    expect(fixture.componentInstance.fallo()).toBe(true);
    expect(el().querySelector('[role="alert"]')).toBeNull();
  });

  it('una especificación nueva borra el fallo anterior y reintenta crear el gráfico', async () => {
    await crear(espec([1]));
    falso.llamadas[0].rechazar(new Error('sin red'));
    await asentar();
    expect(fixture.componentInstance.fallo()).toBe(true);

    fixture.componentRef.setInput('espec', espec([2]));
    await fixture.whenStable();

    expect(fixture.componentInstance.fallo()).toBe(false);
    expect(falso.llamadas).toHaveLength(2);
  });
});
