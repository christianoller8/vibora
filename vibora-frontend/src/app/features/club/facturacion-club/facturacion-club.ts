import { Component, input } from '@angular/core';
import { DatosFiscalesClub } from './datos-fiscales-club';
import { FacturasClub } from './facturas-club';

/** Pestaña "Facturación" del administrador: los datos fiscales del club y las facturas que ha emitido. */
@Component({
  selector: 'app-facturacion-club',
  imports: [DatosFiscalesClub, FacturasClub],
  template: `
    <section class="bloque" aria-labelledby="titulo-datos-fiscales">
      <h2 id="titulo-datos-fiscales">Datos fiscales</h2>
      <app-datos-fiscales-club [clubId]="clubId()" />
    </section>
    <section class="bloque" aria-labelledby="titulo-facturas-club">
      <h2 id="titulo-facturas-club">Facturas del club</h2>
      <app-facturas-club [clubId]="clubId()" />
    </section>
  `,
  styles: `
    :host {
      display: block;
      padding-top: 1.5rem;
    }

    .bloque {
      margin-bottom: 2rem;
    }

    h2 {
      margin: 0 0 1rem;
      font: var(--mat-sys-title-large);
    }
  `,
})
export class FacturacionClub {
  readonly clubId = input.required<number>();
}
