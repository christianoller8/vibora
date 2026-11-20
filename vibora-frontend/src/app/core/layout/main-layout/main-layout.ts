import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { map } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { mensajeDeError } from '../../http/error.util';
import { InvitacionesStore } from '../../invitaciones/invitaciones.store';
import { Campana } from '../../notificaciones/campana/campana';
import { TiempoRealService } from '../../notificaciones/tiempo-real.service';
import { PersonalService } from '../../../features/club/personal.service';
import {
  ConfirmDialog,
  ConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog';
import { SelectorTema } from '../../../shared/components/selector-tema/selector-tema';
import { ETIQUETA_ROL } from '../../../shared/models/usuario.model';

@Component({
  selector: 'app-main-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatBadgeModule,
    Campana,
    SelectorTema,
  ],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  protected readonly auth = inject(AuthService);
  protected readonly invitaciones = inject(InvitacionesStore);
  private readonly router = inject(Router);
  private readonly personal = inject(PersonalService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly etiquetaRol = ETIQUETA_ROL;

  // En móvil el menú se superpone y arranca cerrado; en escritorio empuja el contenido y arranca abierto
  protected readonly esMovil = toSignal(
    inject(BreakpointObserver)
      .observe(Breakpoints.XSmall)
      .pipe(map((estado) => estado.matches)),
    { initialValue: false },
  );
  // controla si el menú lateral está abierto o cerrado
  protected readonly menuAbierto = linkedSignal(() => !this.esMovil());

  constructor() {
    // Instancia el servicio que abre/cierra la conexión en tiempo real según la sesión. Se hace aquí (layout
    // diferido) y no al arrancar para no meter snackbar/overlay en el bundle inicial.
    inject(TiempoRealService);
  }

  protected alternarMenu(): void {
    this.menuAbierto.update((abierto) => !abierto);
  }

  /** En móvil el menú tapa el contenido, así que se cierra al navegar. */
  protected alNavegar(): void {
    if (this.esMovil()) {
      this.menuAbierto.set(false);
    }
  }

  protected salir(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  /** Dejar el club solo tiene sentido para el personal; el administrador no ve la opción (el backend responde 409). */
  protected readonly esPersonal = computed(
    () => this.auth.rol() === 'MONITOR' || this.auth.rol() === 'MANTENIMIENTO',
  );
  protected readonly saliendoDelClub = signal(false);

  protected salirDelClub(): void {
    if (this.saliendoDelClub()) {
      return;
    }
    const datos: ConfirmDialogData = {
      titulo: 'Salir del club',
      mensaje:
        'Las incidencias activas que tengas asignadas quedarán sin asignar y perderás tus permisos de personal. ' +
        'Tendrás que volver a iniciar sesión, y volverás a ser un jugador sin club.',
      textoConfirmar: 'Salir del club',
      textoCancelar: 'Quedarme',
    };
    this.dialog
      .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, { data: datos })
      .afterClosed()
      .subscribe((confirmado) => {
        if (confirmado) {
          this.ejecutarSalidaDelClub();
        }
      });
  }

  private ejecutarSalidaDelClub(): void {
    this.saliendoDelClub.set(true);
    this.personal.salir().subscribe({
      next: () => {
        // El token que tenemos sigue diciendo MONITOR/MANTENIMIENTO y no se puede reutilizar: nueva sesión
        this.saliendoDelClub.set(false);
        this.auth.logout();
        void this.router.navigate(['/login'], { queryParams: { motivo: 'salida-del-club' } });
      },
      error: (err: unknown) => {
        this.saliendoDelClub.set(false);
        this.snack.open(
          mensajeDeError(err, 'No se pudo salir del club. Inténtalo de nuevo.'),
          'Cerrar',
          {
            duration: 6000,
          },
        );
      },
    });
  }
}
