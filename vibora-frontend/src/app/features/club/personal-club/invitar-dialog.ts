import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { InvitacionService } from '../../../core/api/invitacion.service';
import { mensajeDeError } from '../../../core/http/error.util';
import { ROLES_PERSONAL, RolPersonal } from '../../../shared/models/personal.model';
import { ETIQUETA_ROL } from '../../../shared/models/usuario.model';

export interface InvitarDialogData {
  clubId: number;
}

/** Texto único tras invitar: no dice (ni puede decir) si el correo pertenece a un usuario registrado. */
export const MENSAJE_INVITACION_NEUTRO =
  'Si el correo es válido, la persona recibirá la invitación.';

/** Máximo que admite el backend (`@Size(max = 255)`). */
const EMAIL_MAXIMO = 255;

/** Valida el email recortado: es lo que se envía, y los espacios que se cuelan al pegar no deben invalidarlo. */
function emailRecortado(control: AbstractControl): ValidationErrors | null {
  const valor = String(control.value ?? '').trim();
  if (valor === '') {
    return { required: true };
  }
  if (valor.length > EMAIL_MAXIMO) {
    return { maxlength: true };
  }
  return Validators.email({ value: valor } as AbstractControl);
}

/**
 * Invitación de personal. Hace la petición él mismo para mostrar 400/429 sin cerrarse. En el éxito (202) se cierra
 * con el mensaje neutro: la respuesta del backend es la misma exista o no el correo y aquí no se mira nada más.
 */
@Component({
  selector: 'app-invitar-dialog',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './invitar-dialog.html',
  styleUrl: './invitar-dialog.scss',
})
export class InvitarDialog {
  private readonly datos = inject<InvitarDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<InvitarDialog, string>>(MatDialogRef);
  private readonly invitaciones = inject(InvitacionService);

  protected readonly roles = ROLES_PERSONAL;
  protected readonly etiquetaRol = ETIQUETA_ROL;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [emailRecortado]],
    rol: ['MONITOR' as RolPersonal, [Validators.required]],
  });
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected enviar(): void {
    if (this.form.invalid || this.enviando()) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, rol } = this.form.getRawValue();
    this.enviando.set(true);
    this.error.set(null);
    this.invitaciones.crear(this.datos.clubId, { email: email.trim(), rol }).subscribe({
      next: (respuesta) => this.dialogRef.close(textoNeutro(respuesta.mensaje)),
      error: (err: unknown) => {
        this.error.set(mensajeDeError(err, this.mensajePorDefecto(err)));
        this.enviando.set(false);
      },
    });
  }

  protected cancelar(): void {
    this.dialogRef.close();
  }

  /** Texto propio por si el backend no manda mensaje. */
  private mensajePorDefecto(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 429) {
      return 'Has alcanzado el límite de invitaciones. Inténtalo más tarde.';
    }
    return 'No se pudo enviar la invitación. Inténtalo de nuevo.';
  }
}

function textoNeutro(mensaje: string | null | undefined): string {
  return typeof mensaje === 'string' && mensaje.trim() !== '' ? mensaje : MENSAJE_INVITACION_NEUTRO;
}
