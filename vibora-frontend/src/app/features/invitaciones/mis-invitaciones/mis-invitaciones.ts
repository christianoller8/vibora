import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { InvitacionService } from '../../../core/api/invitacion.service';
import { AuthService } from '../../../core/auth/auth.service';
import { mensajeDeError } from '../../../core/http/error.util';
import { InvitacionesStore } from '../../../core/invitaciones/invitaciones.store';
import { formatearFechaHora } from '../../../core/util/fecha';
import {
  ConfirmDialog,
  ConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog';
import { InvitacionMia, textoCaducidad } from '../../../shared/models/invitacion.model';
import { ETIQUETA_ROL } from '../../../shared/models/usuario.model';
import { nombreVisible } from '../../../shared/util/nombres';
import {
  InvitacionAceptadaDialog,
  InvitacionAceptadaDialogData,
} from './invitacion-aceptada-dialog';

/** Invitaciones de club que ha recibido el usuario (un jugador sin club): aceptar o rechazar. */
@Component({
  selector: 'app-mis-invitaciones',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './mis-invitaciones.html',
  styleUrl: './mis-invitaciones.scss',
})
export class MisInvitaciones {
  protected readonly store = inject(InvitacionesStore);
  private readonly invitaciones = inject(InvitacionService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  /** Invitación con una aceptación o un rechazo en vuelo. */
  protected readonly enCurso = signal<number | null>(null);
  /** Error de la última acción sobre cada invitación, mostrado en su tarjeta. */
  protected readonly errores = signal<Record<number, string>>({});

  protected readonly etiquetaRol = ETIQUETA_ROL;
  protected readonly formatearFechaHora = formatearFechaHora;
  protected readonly textoCaducidad = (iso: string): string => textoCaducidad(iso);

  protected textoRol(invitacion: InvitacionMia): string {
    return this.etiquetaRol[invitacion.rol];
  }

  /** Quién invita, o cadena vacía: nunca "null" ni un hueco. */
  protected invitadoPor(invitacion: InvitacionMia): string {
    return nombreVisible(invitacion.invitadoPor, null, '');
  }

  protected recargar(): void {
    this.store.recargar();
  }

  protected aceptar(invitacion: InvitacionMia): void {
    if (this.enCurso() !== null) {
      return;
    }
    const rol = this.textoRol(invitacion);
    this.confirmar({
      titulo: 'Aceptar invitación',
      mensaje:
        `Pasarás a ser ${rol} del club ${invitacion.clubNombre}. ` +
        'Tendrás que volver a iniciar sesión para activar tus nuevos permisos.',
      lineas: [
        { etiqueta: 'Club', valor: invitacion.clubNombre },
        { etiqueta: 'Rol', valor: rol },
      ],
      textoConfirmar: 'Aceptar invitación',
      textoCancelar: 'Ahora no',
    }).subscribe((confirmado) => {
      if (confirmado) {
        this.ejecutarAceptacion(invitacion);
      }
    });
  }

  protected rechazar(invitacion: InvitacionMia): void {
    if (this.enCurso() !== null) {
      return;
    }
    this.confirmar({
      titulo: 'Rechazar invitación',
      mensaje: 'El club será avisado y la invitación dejará de estar disponible.',
      lineas: [
        { etiqueta: 'Club', valor: invitacion.clubNombre },
        { etiqueta: 'Rol', valor: this.textoRol(invitacion) },
      ],
      textoConfirmar: 'Rechazar',
      textoCancelar: 'Mantener',
    }).subscribe((confirmado) => {
      if (confirmado) {
        this.ejecutarRechazo(invitacion);
      }
    });
  }

  private ejecutarAceptacion(invitacion: InvitacionMia): void {
    this.empezar(invitacion.id);
    this.invitaciones.aceptar(invitacion.id).subscribe({
      next: (resultado) => {
        this.enCurso.set(null);
        // El backend ya nos ha hecho personal del club, pero el token que tenemos sigue diciendo JUGADOR y no se
        // puede reutilizar: se avisa y, al cerrar el aviso, se cierra la sesión y se vuelve al login.
        this.dialog
          .open<InvitacionAceptadaDialog, InvitacionAceptadaDialogData>(InvitacionAceptadaDialog, {
            disableClose: true,
            data: { clubNombre: resultado.clubNombre, rol: this.etiquetaRol[resultado.rol] },
          })
          .afterClosed()
          .subscribe(() => {
            this.auth.logout();
            void this.router.navigate(['/login'], {
              queryParams: { motivo: 'invitacion-aceptada' },
            });
          });
      },
      error: (err: unknown) =>
        this.alFallar(invitacion, err, 'No se pudo aceptar la invitación. Inténtalo de nuevo.'),
    });
  }

  private ejecutarRechazo(invitacion: InvitacionMia): void {
    this.empezar(invitacion.id);
    this.invitaciones.rechazar(invitacion.id).subscribe({
      next: () => {
        this.enCurso.set(null);
        this.store.retirar(invitacion.id);
        this.aviso(`Has rechazado la invitación de ${invitacion.clubNombre}.`);
      },
      error: (err: unknown) =>
        this.alFallar(invitacion, err, 'No se pudo rechazar la invitación. Inténtalo de nuevo.'),
    });
  }

  private alFallar(invitacion: InvitacionMia, err: unknown, porDefecto: string): void {
    this.enCurso.set(null);
    if (err instanceof HttpErrorResponse && err.status === 404) {
      // La cancelaron o caducó: no es suya o ya no existe. Se muestra la lista real, sin spinner.
      this.store.recargar(true);
      this.aviso('Esa invitación ya no está disponible.');
      return;
    }
    // 409 (caducada, "Ya perteneces a un club") y el resto: mensaje del backend en la propia tarjeta
    this.errores.update((e) => ({ ...e, [invitacion.id]: mensajeDeError(err, porDefecto) }));
  }

  private empezar(id: number): void {
    this.enCurso.set(id);
    this.errores.update((e) => {
      const resto = { ...e };
      delete resto[id];
      return resto;
    });
  }

  private confirmar(datos: ConfirmDialogData) {
    return this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data: datos })
      .afterClosed();
  }

  private aviso(mensaje: string): void {
    this.snack.open(mensaje, 'Cerrar', { duration: 6000 });
  }
}
