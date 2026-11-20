import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TEMA, TemaService } from '../../../core/tema/tema.service';

/** Botón de icono que alterna entre el tema oscuro y el claro. Lo usan la barra superior y las pantallas de acceso. */
@Component({
  selector: 'app-selector-tema',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <button
      mat-icon-button
      type="button"
      data-accion="cambiar-tema"
      [attr.aria-label]="etiqueta()"
      [attr.title]="etiqueta()"
      (click)="tema.alternar()"
    >
      <mat-icon aria-hidden="true">{{ icono() }}</mat-icon>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class SelectorTema {
  protected readonly tema = inject(TemaService);
  private readonly oscuro = computed(() => this.tema.tema() === TEMA.OSCURO);

  /** La etiqueta dice a qué tema se va a cambiar, no en cuál se está. */
  protected readonly etiqueta = computed(() =>
    this.oscuro() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
  );
  protected readonly icono = computed(() => (this.oscuro() ? 'light_mode' : 'dark_mode'));
}
