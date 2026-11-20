import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

export const TEMA = {
  OSCURO: 'dark',
  CLARO: 'light',
} as const;

export type Tema = (typeof TEMA)[keyof typeof TEMA];

/** Clave de localStorage con la elección explícita del usuario. La lee también `public/tema-inicial.js`. */
export const CLAVE_TEMA = 'vibora.tema';

function esTema(valor: unknown): valor is Tema {
  return valor === TEMA.OSCURO || valor === TEMA.CLARO;
}

/**
 * Tema de la aplicación (oscuro por defecto, sin mirar el sistema operativo) y su persistencia. Aplica el tema en
 * `<html>` como `data-theme` y `color-scheme`; el CSS (`styles/_tema.scss`) se encarga del resto. Todo acceso a
 * localStorage va en try/catch: en modo privado o con el almacenamiento bloqueado la app sigue funcionando.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly documento = inject(DOCUMENT);
  private readonly raiz = this.documento.documentElement;
  private readonly _tema = signal<Tema>(this.leer());
  readonly tema = this._tema.asReadonly();

  constructor() {
    this.aplicar(this._tema());
    this.sincronizarEntrePestanas();
  }

  alternar(): void {
    this.establecer(this._tema() === TEMA.OSCURO ? TEMA.CLARO : TEMA.OSCURO);
  }

  establecer(tema: Tema): void {
    // Primero el DOM y luego la señal: quien reaccione al cambio (los gráficos) ya lee los colores del tema nuevo.
    this.aplicar(tema);
    this._tema.set(tema);
    this.guardar(tema);
  }

  private aplicar(tema: Tema): void {
    this.raiz.setAttribute('data-theme', tema);
    this.raiz.style.colorScheme = tema;
    // El color de la barra del navegador sigue al tema elegido; los valores salen del propio meta (index.html).
    const meta = this.documento.querySelector('meta[name="theme-color"]');
    const color = meta?.getAttribute(tema === TEMA.CLARO ? 'data-claro' : 'data-oscuro');
    if (color) {
      meta?.setAttribute('content', color);
    }
  }

  /** Otra pestaña cambió el tema: se aplica aquí sin volver a guardarlo (ya está en localStorage). */
  private sincronizarEntrePestanas(): void {
    const ventana = this.documento.defaultView;
    if (!ventana) {
      return;
    }
    const alCambiar = (evento: StorageEvent): void => {
      if (evento.key !== CLAVE_TEMA || !esTema(evento.newValue)) {
        return;
      }
      this.aplicar(evento.newValue);
      this._tema.set(evento.newValue);
    };
    ventana.addEventListener('storage', alCambiar);
    inject(DestroyRef).onDestroy(() => ventana.removeEventListener('storage', alCambiar));
  }

  private leer(): Tema {
    try {
      const guardado = localStorage.getItem(CLAVE_TEMA);
      return esTema(guardado) ? guardado : TEMA.OSCURO;
    } catch {
      return TEMA.OSCURO;
    }
  }

  private guardar(tema: Tema): void {
    try {
      localStorage.setItem(CLAVE_TEMA, tema);
    } catch {
      // sin almacenamiento: el tema vale para esta sesión
    }
  }
}
