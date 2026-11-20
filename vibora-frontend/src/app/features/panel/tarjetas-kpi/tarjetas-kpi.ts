import { Component, computed, input } from '@angular/core';
import { ResumenMetricas } from '../../../shared/models/metricas.model';
import { tarjetasKpi } from '../mapeo';

/** Las cifras del resumen del club en el rango (solo lo que devuelve el backend, sin comparaciones inventadas). */
@Component({
  selector: 'app-tarjetas-kpi',
  templateUrl: './tarjetas-kpi.html',
  styleUrl: './tarjetas-kpi.scss',
})
export class TarjetasKpi {
  readonly resumen = input.required<ResumenMetricas>();

  protected readonly tarjetas = computed(() => tarjetasKpi(this.resumen()));
}
