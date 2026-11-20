import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export const VARIANTE_LOGO = {
  COMPLETO: 'completo',
  MARCA: 'marca',
} as const;

export type VarianteLogo = (typeof VARIANTE_LOGO)[keyof typeof VARIANTE_LOGO];

/**
 * Logo de Víbora: dos colmillos que forman una "V" (la víbora) y una escama entre ellos, más el nombre como texto real
 * (Manrope, mayúsculas, muy espaciado) en la variante completa. Va en `currentColor`/tokens: lima sobre oscuro, oliva
 * sobre claro. El tamaño lo manda `font-size` del anfitrión.
 *
 * - `decorativo`: oculto a la accesibilidad (úsese cuando el nombre ya se lee en otro sitio de la pantalla).
 * - `animado`: pequeña revelación al montarse (solo CSS, ≤700 ms, desactivada con `prefers-reduced-motion`).
 */
@Component({
  selector: 'app-logo',
  templateUrl: './logo.html',
  styleUrl: './logo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': 'decorativo() ? null : "img"',
    '[attr.aria-label]': 'decorativo() ? null : "Víbora"',
    '[attr.aria-hidden]': 'decorativo() ? "true" : null',
    '[class.animado]': 'animado()',
  },
})
export class Logo {
  readonly variante = input<VarianteLogo>(VARIANTE_LOGO.COMPLETO);
  readonly decorativo = input(false);
  readonly animado = input(false);

  protected readonly VARIANTE = VARIANTE_LOGO;
}
