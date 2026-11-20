import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FacturaService } from '../../../core/api/factura.service';
import { mensajeDeError } from '../../../core/http/error.util';
import {
  formatearFechaHora,
  formatearFechaLarga,
  formatearRangoHoras,
} from '../../../core/util/fecha';
import { Factura, ReceptorRequest } from '../../../shared/models/factura.model';
import { Reserva } from '../../../shared/models/reserva.model';
import { descargarPdf, esRectificativa, formatearImporte } from '../../../shared/util/factura';
import { validadorNif } from '../../../shared/util/nif';

export interface FacturaReservaDialogData {
  reserva: Reserva;
}

/** Límites del backend (`EmitirFacturaRequest`). */
const MAX_NOMBRE = 200;
const MAX_NIF = 30;
const MAX_DIRECCION = 300;

/**
 * Factura de UNA reserva del organizador. Pide sus facturas al abrirse (una sola petición, solo de esa reserva: la
 * lista de "Mis reservas" no consulta nada por adelantado). Sin facturas y confirmada, deja pedirla con los datos
 * opcionales del receptor; con facturas, deja descargar la original y la rectificativa (si la reserva se canceló).
 * Hace él mismo las peticiones para enseñar los 400/409 del backend sin cerrarse.
 */
@Component({
  selector: 'app-factura-reserva-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './factura-reserva-dialog.html',
  styleUrl: './factura-reserva-dialog.scss',
})
export class FacturaReservaDialog implements OnInit {
  private readonly datos = inject<FacturaReservaDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<FacturaReservaDialog>>(MatDialogRef);
  private readonly facturaService = inject(FacturaService);
  private readonly snack = inject(MatSnackBar);

  protected readonly reserva = this.datos.reserva;
  protected readonly puedePedirla = this.reserva.estado === 'CONFIRMADA';

  protected readonly form = inject(FormBuilder).nonNullable.group({
    nombre: ['', [Validators.maxLength(MAX_NOMBRE)]],
    nif: ['', [Validators.maxLength(MAX_NIF), validadorNif]],
    direccion: ['', [Validators.maxLength(MAX_DIRECCION)]],
  });

  protected readonly cargando = signal(true);
  protected readonly errorCarga = signal<string | null>(null);
  /** `null` hasta que se sabe; vacío = la reserva no tiene facturas. */
  protected readonly facturas = signal<Factura[] | null>(null);
  protected readonly emitiendo = signal(false);
  protected readonly errorEmision = signal<string | null>(null);
  /** Factura cuyo PDF se está descargando. */
  protected readonly descargando = signal<number | null>(null);

  protected readonly maxNombre = MAX_NOMBRE;
  protected readonly maxNif = MAX_NIF;
  protected readonly maxDireccion = MAX_DIRECCION;
  protected readonly formatearFechaLarga = formatearFechaLarga;
  protected readonly formatearRango = formatearRangoHoras;
  protected readonly formatearFechaHora = formatearFechaHora;
  protected readonly formatearImporte = formatearImporte;
  protected readonly esRectificativa = esRectificativa;

  ngOnInit(): void {
    this.cargar();
  }

  protected cargar(): void {
    this.cargando.set(true);
    this.errorCarga.set(null);
    this.facturaService.deReserva(this.reserva.id).subscribe({
      next: (facturas) => {
        this.facturas.set(facturas);
        this.cargando.set(false);
      },
      error: (err: unknown) => {
        this.errorCarga.set(mensajeDeError(err, 'No se pudieron cargar las facturas.'));
        this.cargando.set(false);
      },
    });
  }

  protected pedir(): void {
    if (this.emitiendo()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.emitiendo.set(true);
    this.errorEmision.set(null);
    this.facturaService.emitir(this.reserva.id, this.receptor()).subscribe({
      next: ({ factura, creada }) => {
        this.emitiendo.set(false);
        this.facturas.set([factura]);
        this.snack.open(
          creada
            ? `Factura ${factura.numeroCompleto} emitida.`
            : `Esta reserva ya tenía la factura ${factura.numeroCompleto}.`,
          'Cerrar',
          { duration: 6000 },
        );
      },
      error: (err: unknown) => {
        this.emitiendo.set(false);
        this.errorEmision.set(mensajeEmision(err));
      },
    });
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

  protected cerrar(): void {
    this.dialogRef.close();
  }

  /** Sin ningún dato no se manda receptor (el backend usa el nombre del organizador). */
  private receptor(): ReceptorRequest | undefined {
    const { nombre, nif, direccion } = this.form.getRawValue();
    const limpio = { nombre: nombre.trim(), nif: nif.trim(), direccion: direccion.trim() };
    return limpio.nombre === '' && limpio.nif === '' && limpio.direccion === ''
      ? undefined
      : limpio;
  }
}

/** 409 = el club no puede emitir (sin datos fiscales) o la reserva no se puede facturar; 400 = datos del receptor. */
function mensajeEmision(err: unknown): string {
  if (err instanceof HttpErrorResponse && err.status === 409) {
    const mensaje = mensajeDeError(err, '');
    if (/datos fiscales/i.test(mensaje)) {
      return 'El club todavía no puede emitir facturas: falta configurar sus datos fiscales.';
    }
    return mensaje === '' ? 'No se puede emitir la factura de esta reserva.' : mensaje;
  }
  return mensajeDeError(err, 'No se pudo emitir la factura. Inténtalo de nuevo.');
}
