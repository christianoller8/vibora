import { Component, OnInit, inject, input, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ClubService } from '../../../core/api/club.service';
import { recargarAlRecuperarSesion } from '../../../core/auth/recarga-sesion';
import { mensajeDeError } from '../../../core/http/error.util';
import { obligatorio } from '../../../shared/forms/obligatorio';
import { DatosFiscales } from '../../../shared/models/factura.model';
import { validadorNif } from '../../../shared/util/nif';

/** Límites del backend (`DatosFiscalesRequest`). */
const MAX_RAZON_SOCIAL = 200;
const MAX_NIF = 30;
const MAX_DIRECCION = 300;
const IVA_POR_DEFECTO = 21;
const IVA_MAXIMO = 99.99;

/** Como mucho dos decimales (la columna del backend es numeric(4, 2)). */
function dosDecimales(control: AbstractControl): ValidationErrors | null {
  const valor: unknown = control.value;
  if (typeof valor !== 'number') {
    return null;
  }
  return Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6 ? null : { decimales: true };
}

/**
 * Datos fiscales del club (razón social, NIF/CIF/NIE, dirección y tipo de IVA). Sin ellos el club no puede emitir
 * facturas. Hace la petición él mismo para enseñar los 400 del backend en el propio formulario.
 */
@Component({
  selector: 'app-datos-fiscales-club',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './datos-fiscales-club.html',
  styleUrl: './datos-fiscales-club.scss',
})
export class DatosFiscalesClub implements OnInit {
  private readonly clubes = inject(ClubService);
  private readonly snack = inject(MatSnackBar);

  readonly clubId = input.required<number>();

  protected readonly form = inject(FormBuilder).group({
    razonSocial: ['', [obligatorio, Validators.maxLength(MAX_RAZON_SOCIAL)]],
    nif: ['', [obligatorio, Validators.maxLength(MAX_NIF), validadorNif]],
    direccionFiscal: ['', [obligatorio, Validators.maxLength(MAX_DIRECCION)]],
    tipoIva: [
      IVA_POR_DEFECTO as number | null,
      [Validators.required, Validators.min(0), Validators.max(IVA_MAXIMO), dosDecimales],
    ],
  });

  protected readonly cargando = signal(true);
  protected readonly errorCarga = signal<string | null>(null);
  protected readonly configurado = signal(false);
  protected readonly guardando = signal(false);
  protected readonly errorGuardado = signal<string | null>(null);

  constructor() {
    recargarAlRecuperarSesion(
      () => this.errorCarga() !== null,
      () => this.cargar(),
    );
  }

  /** `clubId` es un input requerido: no se puede leer en el constructor, solo a partir de ngOnInit. */
  ngOnInit(): void {
    this.cargar();
  }

  protected cargar(): void {
    this.cargando.set(true);
    this.errorCarga.set(null);
    this.clubes.datosFiscales(this.clubId()).subscribe({
      next: (datos) => {
        this.aplicar(datos);
        this.cargando.set(false);
      },
      error: (err: unknown) => {
        this.errorCarga.set(mensajeDeError(err, 'No se pudieron cargar los datos fiscales.'));
        this.cargando.set(false);
      },
    });
  }

  protected guardar(): void {
    if (this.guardando()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valores = this.form.getRawValue();
    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.clubes
      .actualizarDatosFiscales(this.clubId(), {
        razonSocial: (valores.razonSocial ?? '').trim(),
        nif: (valores.nif ?? '').trim(),
        direccionFiscal: (valores.direccionFiscal ?? '').trim(),
        tipoIva: valores.tipoIva ?? IVA_POR_DEFECTO,
      })
      .subscribe({
        next: (datos) => {
          this.guardando.set(false);
          this.aplicar(datos);
          this.snack.open('Datos fiscales guardados.', 'Cerrar', { duration: 5000 });
        },
        error: (err: unknown) => {
          this.guardando.set(false);
          this.errorGuardado.set(
            mensajeDeError(err, 'No se pudieron guardar los datos fiscales. Inténtalo de nuevo.'),
          );
        },
      });
  }

  private aplicar(datos: DatosFiscales): void {
    this.configurado.set(datos.configurado);
    this.form.reset({
      razonSocial: datos.razonSocial ?? '',
      nif: datos.nif ?? '',
      direccionFiscal: datos.direccionFiscal ?? '',
      tipoIva: datos.tipoIva ?? IVA_POR_DEFECTO,
    });
  }
}
