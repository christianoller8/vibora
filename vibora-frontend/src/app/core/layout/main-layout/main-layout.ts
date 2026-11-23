import { BreakpointObserver } from '@angular/cdk/layout';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
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
import { Logo } from '../../../shared/components/logo/logo';
import { SelectorTema } from '../../../shared/components/selector-tema/selector-tema';
import { ETIQUETA_ROL } from '../../../shared/models/usuario.model';

/** Hasta esta anchura los enlaces de la barra se pliegan en el menú (DESIGN.md: "on phones links collapse"). */
const PUNTO_DE_CORTE_MOVIL = '(max-width: 720px)';

/** Hasta esta anchura el botón "Salir" pasa a ser un botón de icono para que la barra del personal quepa. */
const PUNTO_DE_CORTE_ESTRECHO = '(max-width: 480px)';

interface EntradaNav {
  ruta: string;
  texto: string;
  icono: string;
  /** Muestra la insignia con el número de invitaciones pendientes. */
  insignia?: boolean;
}

@Component({
  selector: 'app-main-layout',
  imports: [
    NgTemplateOutlet,
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
    Logo,
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

  // Hasta 720 px los enlaces salen de la barra y pasan a un menú que se superpone al contenido
  protected readonly esMovil = toSignal(
    inject(BreakpointObserver)
      .observe(PUNTO_DE_CORTE_MOVIL)
      .pipe(map((estado) => estado.matches)),
    { initialValue: false },
  );
  protected readonly esEstrecho = toSignal(
    inject(BreakpointObserver)
      .observe(PUNTO_DE_CORTE_ESTRECHO)
      .pipe(map((estado) => estado.matches)),
    { initialValue: false },
  );
  // el menú de móvil arranca cerrado, y vuelve a cerrarse si la ventana cruza el punto de corte
  protected readonly menuAbierto = linkedSignal(() => {
    this.esMovil();
    return false;
  });
  /** Entradas de navegación según la sesión y el rol (las mismas en la barra y en el menú de móvil). */
  protected readonly entradas = computed<EntradaNav[]>(() => {
    if (!this.auth.estaAutenticado()) {
      return [];
    }
    const lista: EntradaNav[] = [];
    if (this.auth.esAdminClub()) {
      lista.push({ ruta: '/panel', texto: 'Panel', icono: 'insights' });
    }
    lista.push(
      { ruta: '/agenda', texto: 'Agenda', icono: 'calendar_month' },
      { ruta: '/mis-reservas', texto: 'Mis reservas', icono: 'event_available' },
      { ruta: '/partidos', texto: 'Partidos', icono: 'groups' },
      { ruta: '/deudas', texto: 'Deudas', icono: 'payments' },
      { ruta: '/facturas', texto: 'Mis facturas', icono: 'receipt_long' },
      { ruta: '/incidencias', texto: 'Incidencias', icono: 'report_problem' },
    );
    // solo quien puede aceptar una invitación (jugador sin club); el personal y el administrador no la ven
    if (this.auth.puedeCrearClub()) {
      lista.push({ ruta: '/invitaciones', texto: 'Invitaciones', icono: 'mail', insignia: true });
    }
    if (this.auth.esAdminClub()) {
      lista.push({ ruta: '/club', texto: 'Mi club', icono: 'storefront' });
    } else if (this.auth.puedeCrearClub()) {
      lista.push({ ruta: '/club/crear', texto: 'Crear mi club', icono: 'add_business' });
    }
    return lista;
  });

  constructor() {
    // Instancia el servicio que abre/cierra la conexión en tiempo real según la sesión. Se hace aquí (layout
    // diferido) y no al arrancar para no meter snackbar/overlay en el bundle inicial.
    inject(TiempoRealService);

    // la lista solo existe en escritorio con sesión: el oyente (no pasivo, porque puede cancelar el gesto) vive solo en
    // ese elemento y se retira cuando desaparece o el componente se destruye
    effect((alLimpiar) => {
      const lista = this.listaEnlaces()?.nativeElement;
      if (lista) {
        lista.addEventListener('wheel', this.alGirarRueda, { passive: false });
        alLimpiar(() => lista.removeEventListener('wheel', this.alGirarRueda));
      }
    });
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

  /**
   * Si la lista de enlaces desborda, el enlace de la ruta activa puede quedar fuera de la vista: al activarse se
   * desplaza solo la lista, en horizontal y lo mínimo necesario, dejando el margen de `scroll-padding-inline` (el
   * borde difuminado no debe tapar al activo). No se usa `scrollIntoView`: también movería el contenedor vertical,
   * y su `scroll-padding-top` (el alto de la barra fija) hace saltar la página en cada cambio de enlace activo.
   * `offsetLeft` es relativo a `.enlaces` porque esa lista es `position: relative`.
   */
  protected mostrarSiActivo(activo: boolean, enlace: HTMLElement): void {
    const lista = enlace.closest<HTMLElement>('.enlaces');
    if (!activo || !lista) {
      return;
    }
    const estilo = getComputedStyle(lista);
    const margenIzq = parseFloat(estilo.scrollPaddingLeft) || 0;
    const margenDer = parseFloat(estilo.scrollPaddingRight) || 0;
    const inicio = enlace.offsetLeft;
    const fin = inicio + enlace.offsetWidth;
    let izquierda = lista.scrollLeft;
    if (inicio < izquierda + margenIzq) {
      izquierda = inicio - margenIzq;
    } else if (fin > izquierda + lista.clientWidth - margenDer) {
      izquierda = fin - lista.clientWidth + margenDer;
    }
    izquierda = Math.min(Math.max(0, izquierda), Math.max(0, lista.scrollWidth - lista.clientWidth));
    if (izquierda !== lista.scrollLeft) {
      lista.scrollTo({ left: izquierda, behavior: 'auto' });
    }
  }

  /**
   * Con ratón, la lista desbordada solo se desplaza con la barra fina o con gestos horizontales: la rueda vertical
   * se convierte en desplazamiento horizontal mientras la lista pueda moverse en esa dirección. Al llegar al
   * extremo no se intercepta, para que la página siga desplazándose.
   */
  private readonly alGirarRueda = (evento: WheelEvent): void => {
    if (evento.ctrlKey || evento.metaKey) {
      return; // zoom con la rueda o pellizco del trackpad: no es un gesto de desplazamiento
    }
    const lista = evento.currentTarget as HTMLElement;
    if (Math.abs(evento.deltaX) >= Math.abs(evento.deltaY)) {
      return; // gesto horizontal (trackpad): el navegador ya lo desplaza
    }
    const maximo = lista.scrollWidth - lista.clientWidth;
    if (maximo <= 0) {
      return;
    }
    // deltaMode 1: líneas (unos 16 px); 2: páginas (el ancho visible de la lista); 0: píxeles
    const delta =
      evento.deltaMode === 1
        ? evento.deltaY * 16
        : evento.deltaMode === 2
          ? evento.deltaY * lista.clientWidth
          : evento.deltaY;
    // tolerancia de 1 px en los extremos: con zoom o pantallas de alta densidad `scrollLeft` es fraccionario y nunca
    // llega exacto al máximo, lo que atraparía el desplazamiento de la página
    const puedeAvanzar = delta > 0 && lista.scrollLeft < maximo - 1;
    const puedeRetroceder = delta < 0 && lista.scrollLeft > 1;
    if (puedeAvanzar || puedeRetroceder) {
      evento.preventDefault();
      lista.scrollLeft = Math.min(Math.max(0, lista.scrollLeft + delta), maximo);
    }
  };

  private readonly listaEnlaces = viewChild<ElementRef<HTMLElement>>('listaEnlaces');

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
