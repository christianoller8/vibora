import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  model,
  untracked,
  viewChild,
} from '@angular/core';
import type { ChartConfiguration } from 'chart.js';
import { EspecGrafico } from '../mapeo';
import { CARGADOR_CHART, GraficoVivo } from './cargador-chart';
import { construirConfig, leerEstilo } from './config-chart';

/**
 * Un gráfico de barras de Chart.js para una especificación. Hay UN solo gráfico por componente (un canvas no admite
 * dos): se crea con la primera especificación y las siguientes lo actualizan; si cambian mientras aún carga la
 * librería, se aplica la última al terminar. Al destruir el componente se destruye el gráfico vivo.
 */
@Component({
  selector: 'app-grafico-chart',
  template: ` <div class="lienzo"><canvas #lienzo aria-hidden="true"></canvas></div> `,
  styles: `
    :host {
      display: block;
    }
    .lienzo {
      position: relative;
      /* alto fijo que INCLUYE el eje: el lienzo se adapta a él (maintainAspectRatio: false) */
      height: var(--alto-grafico, 280px);
    }
  `,
})
export class GraficoChart {
  readonly espec = input.required<EspecGrafico>();

  private readonly cargador = inject(CARGADOR_CHART);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly lienzo = viewChild<ElementRef<HTMLCanvasElement>>('lienzo');

  /** true si no se pudo cargar Chart.js. Lo pinta quien lo aloja: dentro de un `role="img"` nadie lo anunciaría. */
  readonly fallo = model(false);
  private vivo: GraficoVivo | null = null;
  /** Hay un `crear` en vuelo: no se lanza otro, porque un canvas solo admite UN gráfico. */
  private creando = false;
  private destruido = false;
  /** La configuración más reciente: la que debe mostrar el gráfico cuando acabe de crearse. */
  private ultima: ChartConfiguration<'bar'> | null = null;

  constructor() {
    effect(() => {
      const espec = this.espec();
      const canvas = this.lienzo()?.nativeElement;
      if (canvas !== undefined) {
        untracked(() => void this.pintar(espec, canvas));
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.destruido = true; // lo que esté cargando ya no es de nadie
      this.vivo?.destroy();
      this.vivo = null;
    });
  }

  private async pintar(espec: EspecGrafico, canvas: HTMLCanvasElement): Promise<void> {
    const config = construirConfig(espec, leerEstilo(this.host.nativeElement));
    this.ultima = config;
    this.fallo.set(false);
    if (this.vivo !== null) {
      this.vivo.actualizar(config);
      return;
    }
    if (this.creando) {
      return; // al terminar de crearse se aplicará `ultima`
    }
    this.creando = true;
    try {
      const vivo = await this.cargador.crear(canvas, config);
      if (this.destruido) {
        vivo.destroy(); // llegó tarde: el componente ya no existe
        return;
      }
      this.vivo = vivo;
      const ultima = this.ultima;
      if (ultima !== null && ultima !== config) {
        vivo.actualizar(ultima); // la especificación cambió mientras cargaba
      }
    } catch {
      if (!this.destruido) {
        this.fallo.set(true);
      }
    } finally {
      this.creando = false;
    }
  }
}
