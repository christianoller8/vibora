import { Component, computed, input } from '@angular/core';
import { FranjasMetricas } from '../../../shared/models/metricas.model';
import { RANGOS_CALOR, franjasRentables, mapaFranjas } from '../mapeo';

/**
 * Ocupación por día de la semana y hora como mapa de calor: rejilla CSS (no Chart.js), una escala secuencial de un
 * solo tono en cinco cubos, con el porcentaje escrito en cada celda y un texto accesible por celda: el color nunca es
 * el único canal. Debajo, las franjas más rentables.
 */
@Component({
  selector: 'app-mapa-franjas',
  templateUrl: './mapa-franjas.html',
  styleUrl: './mapa-franjas.scss',
})
export class MapaFranjas {
  readonly datos = input.required<FranjasMetricas>();

  protected readonly mapa = computed(() => mapaFranjas(this.datos()));
  protected readonly rentables = computed(() => franjasRentables(this.datos()));
  protected readonly niveles = RANGOS_CALOR.map((rango, nivel) => ({ rango, nivel }));
}
