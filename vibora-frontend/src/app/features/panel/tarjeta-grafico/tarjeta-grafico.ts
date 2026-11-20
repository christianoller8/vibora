import { Component, effect, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { GraficoChart } from '../grafico-chart/grafico-chart';
import { EspecGrafico } from '../mapeo';

/**
 * Tarjeta de un gráfico: encabezado, el gráfico (role="img" con un resumen en texto), su leyenda y "Ver como tabla",
 * que muestra los mismos números en una tabla. Sin datos (`espec` null) pinta un mensaje en vez de un gráfico a cero.
 * Lo que se proyecta (`ng-content`) va debajo.
 */
@Component({
  selector: 'app-tarjeta-grafico',
  imports: [MatButtonModule, GraficoChart],
  templateUrl: './tarjeta-grafico.html',
  styleUrl: './tarjeta-grafico.scss',
})
export class TarjetaGrafico {
  readonly titulo = input.required<string>();
  readonly espec = input.required<EspecGrafico | null>();
  readonly mensajeVacio = input.required<string>();

  protected readonly verTabla = signal(false);
  /**
   * El gráfico no pudo cargar Chart.js (lo avisa el hijo; el aviso se pinta aquí, fuera del `role="img"`). El fallo
   * es de UN gráfico: cada vez que se desmonta uno (la tabla, o `espec` null) se reinicia, para que el gráfico nuevo
   * no herede el aviso del anterior mientras carga (aunque lo borre en su primer `pintar`, el aviso ya habría parpadeado).
   */
  protected readonly falloGrafico = signal(false);

  constructor() {
    effect(() => {
      if (this.espec() === null) {
        this.falloGrafico.set(false);
      }
    });
  }

  protected alternarTabla(): void {
    this.verTabla.update((v) => !v);
    this.falloGrafico.set(false);
  }
}
