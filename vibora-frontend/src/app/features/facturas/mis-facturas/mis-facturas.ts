import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FacturaService } from '../../../core/api/factura.service';
import { recargarAlRecuperarSesion } from '../../../core/auth/recarga-sesion';
import { mensajeDeError } from '../../../core/http/error.util';
import { formatearFechaHora } from '../../../core/util/fecha';
import { Factura } from '../../../shared/models/factura.model';
import { descargarPdf, esRectificativa, formatearImporte } from '../../../shared/util/factura';

/** Facturas por página; si una página viene llena puede haber otra (el backend no devuelve el total). */
const POR_PAGINA = 20;

/** Las facturas de las que soy receptor (las más recientes primero) con descarga del PDF. */
@Component({
  selector: 'app-mis-facturas',
  imports: [MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './mis-facturas.html',
  styleUrl: './mis-facturas.scss',
})
export class MisFacturas {
  private readonly facturaService = inject(FacturaService);
  private readonly snack = inject(MatSnackBar);

  protected readonly facturas = signal<Factura[]>([]);
  protected readonly pagina = signal(0);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Factura cuyo PDF se está descargando. */
  protected readonly descargando = signal<number | null>(null);
  /** Hay otra página si esta vino llena. */
  protected readonly hayMas = signal(false);

  protected readonly formatearFechaHora = formatearFechaHora;
  protected readonly formatearImporte = formatearImporte;
  protected readonly esRectificativa = esRectificativa;

  /** Petición en curso: una respuesta que llega tarde de otra página no debe pisar la actual. */
  private peticion = 0;

  constructor() {
    recargarAlRecuperarSesion(
      () => this.error() !== null,
      () => this.cargar(),
    );
    this.cargar();
  }

  protected cargar(): void {
    const mia = ++this.peticion;
    this.cargando.set(true);
    this.error.set(null);
    this.facturaService.mias(this.pagina(), POR_PAGINA).subscribe({
      next: (facturas) => {
        if (mia !== this.peticion) {
          return;
        }
        this.facturas.set(facturas);
        this.hayMas.set(facturas.length >= POR_PAGINA);
        this.cargando.set(false);
      },
      error: (err: unknown) => {
        if (mia !== this.peticion) {
          return;
        }
        this.error.set(mensajeDeError(err, 'No se pudieron cargar tus facturas.'));
        this.cargando.set(false);
      },
    });
  }

  protected irA(pagina: number): void {
    if (pagina < 0 || pagina === this.pagina()) {
      return;
    }
    this.pagina.set(pagina);
    this.cargar();
  }

  protected descargar(factura: Factura): void {
    if (this.descargando() !== null) {
      return;
    }
    this.descargando.set(factura.id);
    this.facturaService.pdf(factura.id).subscribe({
      next: (blob) => {
        this.descargando.set(null);
        descargarPdf(blob, factura.numeroCompleto);
      },
      error: (err: unknown) => {
        this.descargando.set(null);
        this.snack.open(
          mensajeDeError(err, 'No se pudo descargar la factura. Inténtalo de nuevo.'),
          'Cerrar',
          { duration: 6000 },
        );
      },
    });
  }
}
