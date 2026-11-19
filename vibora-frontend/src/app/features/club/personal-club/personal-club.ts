import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, input, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { mensajeDeError } from '../../../core/http/error.util';
import {
  ConfirmDialog,
  ConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog';
import { MiembroPersonal } from '../../../shared/models/incidencia.model';
import { ETIQUETA_ROL } from '../../../shared/models/usuario.model';
import { nombreVisible } from '../../../shared/util/nombres';
import { PersonalService } from '../personal.service';
import { InvitacionesClub } from './invitaciones-club';
import { InvitarDialog, InvitarDialogData } from './invitar-dialog';

/** Gestión del personal del club: quién es administrador, monitor o mantenimiento, con alta y baja. */
@Component({
  selector: 'app-personal-club',
  imports: [
    InvitacionesClub,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './personal-club.html',
  styleUrl: './personal-club.scss',
})
export class PersonalClub implements OnInit {
  private readonly personalService = inject(PersonalService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  readonly clubId = input.required<number>();
  private readonly invitacionesClub = viewChild(InvitacionesClub);

  protected readonly personal = signal<MiembroPersonal[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Persona con una baja en vuelo. */
  protected readonly quitando = signal<number | null>(null);

  protected readonly columnas = ['nombre', 'email', 'rol', 'acciones'];
  protected readonly etiquetaRol = ETIQUETA_ROL;

  /** `clubId` es un input requerido: no se puede leer en el constructor, solo a partir de ngOnInit. */
  ngOnInit(): void {
    this.cargar();
  }

  protected cargar(conSpinner = true): void {
    if (conSpinner) {
      this.cargando.set(true);
    }
    this.error.set(null);
    this.personalService.listar(this.clubId()).subscribe({
      next: (personal) => {
        this.personal.set(personal);
        this.cargando.set(false);
      },
      error: (err: unknown) => {
        this.error.set(mensajeDeError(err, 'No se pudo cargar el personal.'));
        this.cargando.set(false);
      },
    });
  }

  protected nombreCompleto(persona: MiembroPersonal): string {
    return nombreVisible(persona.nombre, persona.apellidos, 'Sin nombre');
  }

  protected etiquetaDeRol(persona: MiembroPersonal): string {
    return this.etiquetaRol[persona.rol];
  }

  /** Los administradores no se quitan desde aquí (el backend responde 409). */
  protected puedeQuitar(persona: MiembroPersonal): boolean {
    return persona.rol !== 'ADMIN_CLUB';
  }

  /** La invitación no cambia el personal hasta que la persona acepta: solo se refresca la lista de invitaciones. */
  protected invitar(): void {
    this.dialog
      .open<InvitarDialog, InvitarDialogData, string>(InvitarDialog, {
        data: { clubId: this.clubId() },
      })
      .afterClosed()
      .subscribe((mensaje) => {
        if (mensaje) {
          this.aviso(mensaje, 8000);
          this.invitacionesClub()?.recargar();
        }
      });
  }

  protected quitar(persona: MiembroPersonal): void {
    if (this.quitando() !== null) {
      return;
    }
    const datos: ConfirmDialogData = {
      titulo: 'Quitar del personal',
      mensaje:
        'Las incidencias activas que tenga asignadas quedarán sin asignar y perderá sus permisos de personal. ' +
        'Tendrá que volver a iniciar sesión.',
      lineas: [
        { etiqueta: 'Persona', valor: this.nombreCompleto(persona) },
        { etiqueta: 'Rol', valor: this.etiquetaRol[persona.rol] },
      ],
      textoConfirmar: 'Quitar',
      textoCancelar: 'Mantener',
    };
    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data: datos })
      .afterClosed()
      .subscribe((confirmado) => {
        if (confirmado) {
          this.ejecutarBaja(persona);
        }
      });
  }

  private ejecutarBaja(persona: MiembroPersonal): void {
    this.quitando.set(persona.usuarioId);
    this.personalService.quitar(this.clubId(), persona.usuarioId).subscribe({
      next: () => {
        this.quitando.set(null);
        this.aviso(`${this.nombreCompleto(persona)} ya no forma parte del personal.`);
        this.cargar(false);
      },
      error: (err: unknown) => {
        this.quitando.set(null);
        this.aviso(mensajeDeError(err, 'No se pudo quitar a la persona. Inténtalo de nuevo.'));
        // 404/409: la lista que se veía ya no es cierta (otra sesión la cambió): se muestra la real
        if (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 409)) {
          this.cargar(false);
        }
      },
    });
  }

  private aviso(mensaje: string, duracion = 6000): void {
    this.snack.open(mensaje, 'Cerrar', { duration: duracion });
  }
}
