import { InjectionToken } from '@angular/core';
import type { ChartConfiguration } from 'chart.js';

/** Lo único que el panel necesita de un gráfico vivo. */
export interface GraficoVivo {
  /** Sustituye los datos y las opciones y repinta: un canvas solo admite UN gráfico, así que no se vuelve a crear. */
  actualizar(config: ChartConfiguration<'bar'>): void;
  destroy(): void;
}

/**
 * Frontera con Chart.js: jsdom no tiene canvas, así que los tests de componentes sustituyen este cargador por un doble
 * y no prueban Chart.js. El real carga la librería con un `import()` dinámico: vive solo en el chunk del panel.
 */
export interface CargadorChart {
  crear(canvas: HTMLCanvasElement, config: ChartConfiguration<'bar'>): Promise<GraficoVivo>;
}

export const CARGADOR_CHART = new InjectionToken<CargadorChart>('CARGADOR_CHART', {
  providedIn: 'root',
  factory: () => ({
    crear: async (canvas, config) => {
      const { Chart } = await import('./chart-registro');
      const chart = new Chart(canvas, config);
      return {
        actualizar: (nueva) => {
          chart.data = nueva.data;
          chart.options = nueva.options ?? {};
          chart.update();
        },
        destroy: () => chart.destroy(),
      };
    },
  }),
});
