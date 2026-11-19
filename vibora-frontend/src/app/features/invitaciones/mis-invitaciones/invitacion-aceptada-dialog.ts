import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface InvitacionAceptadaDialogData {
  clubNombre: string;
  /** Texto visible del rol ("Monitor", "Mantenimiento"). */
  rol: string;
}

/** Aviso tras aceptar: el token sigue diciendo JUGADOR, así que hay que volver a iniciar sesión. */
@Component({
  selector: 'app-invitacion-aceptada-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Invitación aceptada</h2>
    <mat-dialog-content>
      <p>
        Ya formas parte de <strong>{{ datos.clubNombre }}</strong> como
        <strong>{{ datos.rol }}</strong
        >.
      </p>
      <p>
        Para activar tus nuevos permisos tienes que iniciar sesión de nuevo: cerraremos tu sesión
        actual y te llevaremos a la pantalla de acceso.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" data-accion="entendido" (click)="cerrar()">
        Iniciar sesión de nuevo
      </button>
    </mat-dialog-actions>
  `,
})
export class InvitacionAceptadaDialog {
  protected readonly datos = inject<InvitacionAceptadaDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<InvitacionAceptadaDialog>>(MatDialogRef);

  protected cerrar(): void {
    this.dialogRef.close();
  }
}
