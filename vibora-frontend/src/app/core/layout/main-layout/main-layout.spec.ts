import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, NEVER, map, of, throwError } from 'rxjs';
import { NotificacionesStore } from '../../notificaciones/notificaciones.store';
import { TiempoRealService } from '../../notificaciones/tiempo-real.service';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { InvitacionesStore } from '../../invitaciones/invitaciones.store';
import { PersonalService } from '../../../features/club/personal.service';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { USUARIO_ADMIN, USUARIO_JUGADOR, crearAuthFalso } from '../../../testing/test-utils';
import { MainLayout } from './main-layout';

describe('MainLayout', () => {
  const storeFalso = {
    items: signal([]),
    noLeidas: signal(0),
    marcarLeida: vi.fn(),
    marcarTodas: vi.fn(),
  };
  const pendientes = signal(0);
  const invitacionesFalso = { pendientes };
  const personal = { salir: vi.fn() };
  const dialogo = { open: vi.fn() };
  const snack = { open: vi.fn() };
  let tiempoRealCreado = false;
  let component: MainLayout;
  let fixture: ComponentFixture<MainLayout>;
  // Anchura de la ventana simulada: el layout pide las consultas (max-width: 720px) y (max-width: 480px) y aquí
  // decidimos si coinciden
  const esMovil = new BehaviorSubject(false);
  const esEstrecho = new BehaviorSubject(false);
  let consultas: string[] = [];

  async function crear(
    auth: ReturnType<typeof crearAuthFalso>,
    movil = false,
    estrecho = false,
  ): Promise<void> {
    esMovil.next(movil);
    esEstrecho.next(estrecho);
    consultas = [];
    await TestBed.configureTestingModule({
      imports: [MainLayout],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: BreakpointObserver,
          useValue: {
            observe: (consulta: string | string[]) => {
              const pedidas = [consulta].flat();
              consultas.push(...pedidas);
              const flujo = pedidas.includes('(max-width: 480px)') ? esEstrecho : esMovil;
              return flujo.pipe(map((matches) => ({ matches, breakpoints: {} })));
            },
          },
        },
        { provide: AuthService, useValue: auth },
        { provide: NotificacionesStore, useValue: storeFalso },
        { provide: InvitacionesStore, useValue: invitacionesFalso },
        { provide: PersonalService, useValue: personal },
        { provide: MatDialog, useValue: dialogo },
        { provide: MatSnackBar, useValue: snack },
        {
          provide: TiempoRealService,
          useFactory: () => {
            tiempoRealCreado = true;
            return {};
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MainLayout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  /** Enlaces de la barra superior (escritorio). */
  const enlaces = (): HTMLAnchorElement[] =>
    Array.from(el().querySelectorAll<HTMLAnchorElement>('nav.enlaces a.enlace'));
  const enlace = (href: string): HTMLAnchorElement | undefined =>
    enlaces().find((a) => a.getAttribute('href') === href);
  /** Enlaces del menú desplegable (móvil). */
  const enlacesMenu = (): HTMLAnchorElement[] =>
    Array.from(el().querySelectorAll<HTMLAnchorElement>('mat-nav-list a[mat-list-item]'));
  const hrefs = (lista: HTMLAnchorElement[]): (string | null)[] =>
    lista.map((a) => a.getAttribute('href'));

  beforeEach(() => {
    // jsdom no implementa Element.scrollTo: se simula (los casos que miran el desplazamiento lo sustituyen en la lista)
    Object.defineProperty(Element.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    pendientes.set(0);
    personal.salir.mockReset();
    dialogo.open.mockReset();
    snack.open.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('should create', async () => {
    await crear(crearAuthFalso());
    expect(component).toBeTruthy();
  });

  it('muestra la marca, el nombre del usuario y su rol cuando hay sesión', async () => {
    await crear(crearAuthFalso());

    expect(el().querySelector('mat-toolbar')?.textContent).toContain('Víbora');
    expect(el().querySelector('mat-toolbar')?.textContent).toContain('Ana');
    expect(el().querySelector('mat-chip, .rol')?.textContent).toContain('Jugador');
  });

  it('la barra superior lleva el logo de Víbora (marca y nombre), sin animación', async () => {
    await crear(crearAuthFalso());

    const logo = el().querySelector('mat-toolbar app-logo') as HTMLElement | null;
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute('role')).toBe('img');
    expect(logo?.getAttribute('aria-label')).toBe('Víbora');
    expect(logo?.querySelector('svg')).not.toBeNull();
    expect(logo?.querySelector('.nombre')).not.toBeNull();
    expect(logo?.classList.contains('animado')).toBe(false);
    // el texto plano anterior ya no existe
    expect(el().querySelector('mat-toolbar span.marca')).toBeNull();
  });

  it('en pantallas estrechas (<= 480 px) el logo es solo la marca, sin el nombre, y conserva su nombre accesible', async () => {
    await crear(crearAuthFalso(), false, true);

    const logo = el().querySelector('mat-toolbar app-logo') as HTMLElement | null;
    expect(logo).not.toBeNull();
    expect(logo?.querySelector('svg')).not.toBeNull();
    expect(logo?.querySelector('.nombre')).toBeNull();
    expect(logo?.getAttribute('role')).toBe('img');
    expect(logo?.getAttribute('aria-label')).toBe('Víbora');
  });

  it('en pantallas anchas el logo lleva el nombre', async () => {
    await crear(crearAuthFalso(), false, false);

    expect(el().querySelector('mat-toolbar app-logo .nombre')).not.toBeNull();
  });

  it('la barra superior lleva el selector de tema, con su etiqueta accesible', async () => {
    await crear(crearAuthFalso());

    const boton = el().querySelector('mat-toolbar button[data-accion="cambiar-tema"]');
    expect(boton).not.toBeNull();
    expect(boton?.getAttribute('aria-label')).toMatch(/^Cambiar a tema (claro|oscuro)$/);
  });

  it('muestra las entradas Agenda y Mis reservas cuando hay sesión', async () => {
    await crear(crearAuthFalso());

    const textos = enlaces().map((a) => a.textContent?.trim());
    expect(textos.some((t) => t?.includes('Agenda'))).toBe(true);
    expect(textos.some((t) => t?.includes('Mis reservas'))).toBe(true);
  });

  it('en escritorio los enlaces van en la barra superior, dentro de una navegación con nombre accesible', async () => {
    await crear(crearAuthFalso());

    const nav = el().querySelector('mat-toolbar nav.enlaces');
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute('aria-label')).toBe('Principal');
    // sin botón de menú ni lista lateral: no hay duplicados en el árbol de accesibilidad
    expect(el().querySelector('button[aria-label="Abrir o cerrar el menú"]')).toBeNull();
    expect(enlacesMenu()).toHaveLength(0);
  });

  it('el enlace de la ruta activa es una píldora marcada con aria-current="page"', async () => {
    await crear(crearAuthFalso());
    await TestBed.inject(Router).navigateByUrl('/mis-reservas');
    await fixture.whenStable();

    const activos = enlaces().filter((a) => a.classList.contains('activo'));
    expect(activos.map((a) => a.getAttribute('href'))).toEqual(['/mis-reservas']);
    expect(activos[0].getAttribute('aria-current')).toBe('page');
    expect(enlace('/agenda')?.hasAttribute('aria-current')).toBe(false);
  });

  describe('enlace activo visible en la barra (la lista se desplaza si no caben)', () => {
    const ANCHO_VISIBLE = 400;
    const ANCHO_TOTAL = 900;
    const ANCHO_ENLACE = 100;
    const MARGEN = 32; // scroll-padding-inline: 2rem
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    let intoView: ReturnType<typeof vi.fn>;
    let lista: HTMLElement;
    let scrollTo: ReturnType<typeof vi.fn>;

    /** jsdom no maqueta: se fija la geometría de la lista (400 de 900 px) y de sus enlaces (100 px cada uno). */
    function geometria(scrollLeft = 0, total = ANCHO_TOTAL): void {
      lista = el().querySelector<HTMLElement>('nav.enlaces')!;
      scrollTo = vi.fn();
      const fijar = (obj: object, propiedad: string, valor: unknown) =>
        Object.defineProperty(obj, propiedad, { configurable: true, writable: true, value: valor });
      fijar(lista, 'clientWidth', ANCHO_VISIBLE);
      fijar(lista, 'scrollWidth', total);
      fijar(lista, 'scrollLeft', scrollLeft);
      fijar(lista, 'scrollTo', scrollTo);
      enlaces().forEach((a, i) => {
        fijar(a, 'offsetLeft', 4 + i * ANCHO_ENLACE);
        fijar(a, 'offsetWidth', ANCHO_ENLACE);
      });
    }

    async function ir(url: string): Promise<void> {
      await TestBed.inject(Router).navigateByUrl(url);
      await fixture.whenStable();
    }

    beforeEach(() => {
      // jsdom no implementa scrollIntoView: se simula para detectar que nadie lo use (movería también el contenedor
      // vertical, cuyo scroll-padding-top hace saltar la página)
      intoView = vi.fn();
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: intoView,
      });
      vi.spyOn(globalThis, 'getComputedStyle').mockReturnValue({
        scrollPaddingLeft: `${MARGEN}px`,
        scrollPaddingRight: `${MARGEN}px`,
      } as CSSStyleDeclaration);
    });

    afterEach(() => {
      if (original) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', original);
      } else {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it('al activarse un enlace fuera de la vista desplaza solo la lista en horizontal, respetando el margen', async () => {
      await crear(crearAuthFalso());
      geometria();

      await ir('/deudas'); // cuarto enlace: ocupa 304..404 y lo visible acaba en 400 - 32

      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith({
        left: 304 + ANCHO_ENLACE - ANCHO_VISIBLE + MARGEN,
        behavior: 'auto',
      });
      // nunca se toca el desplazamiento vertical: ni scrollIntoView ni un `top`
      expect(intoView).not.toHaveBeenCalled();
      expect(Object.keys(scrollTo.mock.calls[0][0])).toEqual(['left', 'behavior']);
    });

    it('un enlace oculto por el borde izquierdo vuelve a la vista dejando el margen', async () => {
      await crear(crearAuthFalso());
      geometria(500);

      await ir('/partidos'); // 204..304 con la lista desplazada 500: queda a la izquierda

      expect(scrollTo).toHaveBeenCalledWith({ left: 204 - MARGEN, behavior: 'auto' });
      expect(intoView).not.toHaveBeenCalled();
    });

    it('un enlace que ya se ve entero no mueve la lista', async () => {
      await crear(crearAuthFalso());
      geometria();

      await ir('/agenda');

      expect(scrollTo).not.toHaveBeenCalled();
      expect(intoView).not.toHaveBeenCalled();
    });

    it('un enlace que deja de estar activo no se desplaza', async () => {
      await crear(crearAuthFalso());
      geometria();
      await ir('/deudas');
      scrollTo.mockClear();
      lista.scrollLeft = 36;

      await ir('/agenda');

      // solo se desplaza hacia el nuevo activo (/agenda, a la izquierda), nunca hacia /deudas
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'auto' });
    });
  });

  describe('rueda del ratón sobre la lista de enlaces que desborda', () => {
    let lista: HTMLElement;

    function preparar(scrollLeft: number, scrollWidth: number): void {
      lista = el().querySelector<HTMLElement>('nav.enlaces')!;
      const fijar = (propiedad: string, valor: number) =>
        Object.defineProperty(lista, propiedad, { configurable: true, writable: true, value: valor });
      fijar('clientWidth', 400);
      fijar('scrollWidth', scrollWidth);
      fijar('scrollLeft', scrollLeft);
    }

    function rueda(deltaY: number, deltaX = 0, extra: WheelEventInit = {}): WheelEvent {
      const evento = new WheelEvent('wheel', {
        deltaY,
        deltaX,
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      lista.dispatchEvent(evento);
      return evento;
    }

    it('con Ctrl (zoom o pellizco) no se intercepta ni se desplaza', async () => {
      await crear(crearAuthFalso());
      preparar(0, 900);

      const evento = rueda(120, 0, { ctrlKey: true });

      expect(evento.defaultPrevented).toBe(false);
      expect(lista.scrollLeft).toBe(0);
    });

    it('con Meta tampoco se intercepta', async () => {
      await crear(crearAuthFalso());
      preparar(0, 900);

      const evento = rueda(120, 0, { metaKey: true });

      expect(evento.defaultPrevented).toBe(false);
      expect(lista.scrollLeft).toBe(0);
    });

    it('deltaMode de líneas: cada línea son 16 px', async () => {
      await crear(crearAuthFalso());
      preparar(0, 900);

      const evento = rueda(3, 0, { deltaMode: WheelEvent.DOM_DELTA_LINE });

      expect(lista.scrollLeft).toBe(48);
      expect(evento.defaultPrevented).toBe(true);
    });

    it('deltaMode de páginas: cada página es el ancho visible de la lista', async () => {
      await crear(crearAuthFalso());
      preparar(0, 900);

      const evento = rueda(1, 0, { deltaMode: WheelEvent.DOM_DELTA_PAGE });

      expect(lista.scrollLeft).toBe(400);
      expect(evento.defaultPrevented).toBe(true);
    });

    it('con un scrollLeft fraccionario a menos de 1 px del final no se intercepta (la página sigue)', async () => {
      await crear(crearAuthFalso());
      preparar(500 - 0.4, 900); // el máximo es 500

      const evento = rueda(120);

      expect(evento.defaultPrevented).toBe(false);
    });

    it('con un scrollLeft fraccionario a menos de 1 px del inicio tampoco se intercepta al subir', async () => {
      await crear(crearAuthFalso());
      preparar(0.4, 900);

      const evento = rueda(-120);

      expect(evento.defaultPrevented).toBe(false);
    });

    it('retira el oyente de la rueda, con el mismo manejador, cuando la lista desaparece', async () => {
      // los espías van antes de crear el componente: así se ve con qué manejador se registra el oyente
      const alta = vi.spyOn(EventTarget.prototype, 'addEventListener');
      const baja = vi.spyOn(EventTarget.prototype, 'removeEventListener');
      await crear(crearAuthFalso());
      const indice = alta.mock.calls.findIndex(([tipo]) => tipo === 'wheel');
      expect(indice).toBeGreaterThanOrEqual(0);
      const manejador = alta.mock.calls[indice][1];
      const nav = alta.mock.contexts[indice] as HTMLElement;
      expect(nav.matches('nav.enlaces')).toBe(true);
      expect(alta.mock.calls[indice][2]).toEqual({ passive: false });

      esMovil.next(true); // en móvil la lista deja de existir
      await fixture.whenStable();

      expect(el().querySelector('nav.enlaces')).toBeNull();
      const retirada = baja.mock.calls.findIndex(([tipo, fn]) => tipo === 'wheel' && fn === manejador);
      expect(retirada).toBeGreaterThanOrEqual(0);
      expect(baja.mock.contexts[retirada]).toBe(nav);
    });

    it('convierte el giro vertical en desplazamiento horizontal cuando la lista desborda', async () => {
      await crear(crearAuthFalso());
      preparar(0, 900);

      const evento = rueda(120);

      expect(lista.scrollLeft).toBe(120);
      expect(evento.defaultPrevented).toBe(true);
    });

    it('no hace nada si la lista cabe entera', async () => {
      await crear(crearAuthFalso());
      preparar(0, 400);

      const evento = rueda(120);

      expect(lista.scrollLeft).toBe(0);
      expect(evento.defaultPrevented).toBe(false);
    });

    it('no hace nada al final de la lista: la página puede seguir desplazándose', async () => {
      await crear(crearAuthFalso());
      preparar(500, 900);

      const evento = rueda(120);

      expect(lista.scrollLeft).toBe(500);
      expect(evento.defaultPrevented).toBe(false);
    });

    it('al principio de la lista el giro hacia arriba tampoco se intercepta', async () => {
      await crear(crearAuthFalso());
      preparar(0, 900);

      const evento = rueda(-120);

      expect(lista.scrollLeft).toBe(0);
      expect(evento.defaultPrevented).toBe(false);
    });

    it('deja pasar el gesto horizontal del trackpad', async () => {
      await crear(crearAuthFalso());
      preparar(0, 900);

      const evento = rueda(0, 80);

      expect(lista.scrollLeft).toBe(0);
      expect(evento.defaultPrevented).toBe(false);
    });
  });

  describe('botón "Salir" en pantallas estrechas (<= 480 px)', () => {
    const salirBtn = (): HTMLButtonElement =>
      el().querySelector<HTMLButtonElement>('button[data-accion="salir"]')!;
    /** Texto visible del botón, sin el nombre del icono que Material pinta como ligadura. */
    const textoVisible = (b: HTMLElement): string => {
      const copia = b.cloneNode(true) as HTMLElement;
      copia.querySelectorAll('mat-icon').forEach((i) => i.remove());
      return copia.textContent?.trim() ?? '';
    };

    it('consulta el punto de corte de 480 px', async () => {
      await crear(crearAuthFalso());

      expect(consultas).toContain('(max-width: 480px)');
    });

    it('en estrecho es un botón de icono con el mismo nombre accesible y sin texto visible', async () => {
      await crear(crearAuthFalso(), true, true);

      expect(salirBtn().getAttribute('aria-label')).toBe('Salir');
      expect(salirBtn().hasAttribute('mat-icon-button')).toBe(true);
      expect(textoVisible(salirBtn())).toBe('');
      expect(salirBtn().querySelector('mat-icon')).not.toBeNull();
    });

    it('en ancho sigue siendo el botón de texto "Salir"', async () => {
      await crear(crearAuthFalso());

      expect(textoVisible(salirBtn())).toBe('Salir');
    });

    it('en estrecho también cierra la sesión', async () => {
      const auth = crearAuthFalso();
      await crear(auth, true, true);
      vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

      salirBtn().click();

      expect(auth.logout).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['jugador sin club', USUARIO_JUGADOR],
    ['administrador de club', USUARIO_ADMIN],
    ['monitor', { ...USUARIO_JUGADOR, rol: 'MONITOR' as const, clubId: 5, clubNombre: 'Club' }],
  ])(
    'muestra "Mis facturas" (/facturas) a todo usuario autenticado: %s',
    async (_, usuario) => {
      await crear(crearAuthFalso(usuario));

      expect(enlace('/facturas')?.textContent).toContain('Mis facturas');
    },
  );

  it('sin sesión no hay menú, y por tanto tampoco "Mis facturas"', async () => {
    await crear(crearAuthFalso(null));

    expect(el().querySelector('a[href="/facturas"]')).toBeNull();
  });

  it('muestra Incidencias a todo usuario autenticado, también a un jugador sin club', async () => {
    await crear(crearAuthFalso(USUARIO_JUGADOR));

    expect(enlace('/incidencias')?.textContent).toContain('Incidencias');
  });

  it('muestra también Partidos y Deudas, con sus rutas, y todas las entradas en orden', async () => {
    await crear(crearAuthFalso());

    expect(enlace('/partidos')?.textContent).toContain('Partidos');
    expect(enlace('/deudas')?.textContent).toContain('Deudas');
    expect(hrefs(enlaces())).toEqual([
      '/agenda',
      '/mis-reservas',
      '/partidos',
      '/deudas',
      '/facturas',
      '/incidencias',
      '/invitaciones',
      '/club/crear',
    ]);
  });

  describe('menú móvil (<= 720 px): los enlaces se pliegan en el menú lateral', () => {
    const botonMenu = (): HTMLButtonElement | null =>
      el().querySelector<HTMLButtonElement>('button[aria-label="Abrir o cerrar el menú"]');

    it('consulta el punto de corte de 720 px', async () => {
      await crear(crearAuthFalso(), true);

      expect(consultas).toContain('(max-width: 720px)');
    });

    it('la barra deja de llevar los enlaces y muestra el botón de menú, con el logo y los controles', async () => {
      await crear(crearAuthFalso(), true);

      expect(el().querySelector('nav.enlaces')).toBeNull();
      expect(botonMenu()).not.toBeNull();
      expect(el().querySelector('mat-toolbar app-logo')).not.toBeNull();
      expect(el().querySelector('mat-toolbar button[data-accion="cambiar-tema"]')).not.toBeNull();
      expect(el().querySelector('mat-toolbar app-campana')).not.toBeNull();
      expect(el().querySelector('button[data-accion="salir"]')).not.toBeNull();
    });

    it('el menú lleva las mismas entradas, con sus iconos y rutas', async () => {
      await crear(crearAuthFalso(), true);

      expect(hrefs(enlacesMenu())).toEqual([
        '/agenda',
        '/mis-reservas',
        '/partidos',
        '/deudas',
        '/facturas',
        '/incidencias',
        '/invitaciones',
        '/club/crear',
      ]);
      const icono = (href: string) =>
        enlacesMenu()
          .find((a) => a.getAttribute('href') === href)
          ?.querySelector('mat-icon')
          ?.textContent?.trim();
      expect(icono('/facturas')).toBe('receipt_long');
      expect(icono('/incidencias')).toBe('report_problem');
      expect(icono('/partidos')).toBe('groups');
      expect(icono('/deudas')).toBe('payments');
      expect(icono('/invitaciones')).toBe('mail');
    });

    it('el administrador ve "Panel" el primero y "Mi club"', async () => {
      await crear(crearAuthFalso(USUARIO_ADMIN), true);

      expect(hrefs(enlacesMenu())[0]).toBe('/panel');
      expect(
        enlacesMenu()
          .find((a) => a.getAttribute('href') === '/panel')
          ?.querySelector('mat-icon')
          ?.textContent?.trim(),
      ).toBe('insights');
      expect(hrefs(enlacesMenu())).toContain('/club');
    });

    it('el botón alterna el menú y navegar lo cierra', async () => {
      await crear(crearAuthFalso(), true);
      expect(component['menuAbierto']()).toBe(false);

      botonMenu()!.click();
      await fixture.whenStable();
      expect(component['menuAbierto']()).toBe(true);
      expect(botonMenu()!.getAttribute('aria-expanded')).toBe('true');

      enlacesMenu()[0].click();
      expect(component['menuAbierto']()).toBe(false);
    });

    it('el menú muestra arriba el nombre y el rol del usuario (en la barra se ocultan por debajo de 900 px)', async () => {
      await crear(crearAuthFalso(), true);

      const cabecera = el().querySelector('mat-sidenav .menu-usuario');
      expect(cabecera).not.toBeNull();
      expect(cabecera?.querySelector('.menu-nombre')?.textContent).toContain('Ana');
      expect(cabecera?.querySelector('.menu-rol')?.textContent).toContain('Jugador');
      // va antes de la lista de enlaces
      const lista = el().querySelector('mat-sidenav mat-nav-list')!;
      expect(
        cabecera!.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('el botón de menú apunta con aria-controls al menú lateral, y la lista se llama "Principal"', async () => {
      await crear(crearAuthFalso(), true);

      const id = botonMenu()!.getAttribute('aria-controls');
      expect(id).toBeTruthy();
      expect(el().querySelector('mat-sidenav')?.id).toBe(id);
      expect(el().querySelector('mat-nav-list')?.getAttribute('aria-label')).toBe('Principal');
    });

    it('la entrada de la ruta activa lleva la clase "activo" y aria-current="page"', async () => {
      await crear(crearAuthFalso(), true);
      await TestBed.inject(Router).navigateByUrl('/mis-reservas');
      await fixture.whenStable();

      const activos = enlacesMenu().filter((a) => a.classList.contains('activo'));
      expect(activos.map((a) => a.getAttribute('href'))).toEqual(['/mis-reservas']);
      expect(activos[0].getAttribute('aria-current')).toBe('page');
      const agenda = enlacesMenu().find((a) => a.getAttribute('href') === '/agenda')!;
      expect(agenda.hasAttribute('aria-current')).toBe(false);
    });

    it('sin sesión no hay enlaces ni botón de menú', async () => {
      await crear(crearAuthFalso(null), true);

      expect(enlacesMenu()).toHaveLength(0);
      expect(botonMenu()).toBeNull();
    });

    it('al ensanchar la ventana vuelven los enlaces a la barra y el menú se cierra', async () => {
      await crear(crearAuthFalso(), true);
      botonMenu()!.click();

      esMovil.next(false);
      await fixture.whenStable();

      expect(enlaces().length).toBeGreaterThan(0);
      expect(enlacesMenu()).toHaveLength(0);
      expect(component['menuAbierto']()).toBe(false);
    });
  });

  describe('entrada "Panel" (solo el administrador del club)', () => {
    const entradaPanel = (): HTMLAnchorElement | undefined => enlace('/panel');

    it('el administrador la ve la primera', async () => {
      await crear(crearAuthFalso(USUARIO_ADMIN));

      expect(entradaPanel()?.textContent).toContain('Panel');
      expect(enlaces()[0]?.getAttribute('href')).toBe('/panel');
    });

    it.each(['JUGADOR', 'MONITOR', 'MANTENIMIENTO'] as const)('un %s no la ve', async (rol) => {
      await crear(crearAuthFalso({ ...USUARIO_ADMIN, rol }));

      expect(entradaPanel()).toBeUndefined();
    });
  });

  describe('entrada "Invitaciones" (solo quien puede aceptar: jugador sin club)', () => {
    const entrada = (): HTMLAnchorElement | undefined => enlace('/invitaciones');

    it('un jugador sin club la ve', async () => {
      await crear(crearAuthFalso(USUARIO_JUGADOR));

      expect(entrada()?.textContent).toContain('Invitaciones');
    });

    it.each(['MONITOR', 'MANTENIMIENTO', 'ADMIN_CLUB'] as const)('un %s no la ve', async (rol) => {
      await crear(crearAuthFalso({ ...USUARIO_ADMIN, rol }));

      expect(entrada()).toBeUndefined();
    });

    it('sin usuario cargado (sesión incierta) tampoco', async () => {
      const auth = crearAuthFalso();
      auth.usuario.set(null);
      auth.sesionIncierta.set(true);

      await crear(auth);

      expect(entrada()).toBeUndefined();
    });

    it('muestra el número de invitaciones pendientes en una insignia con descripción accesible', async () => {
      pendientes.set(3);

      await crear(crearAuthFalso(USUARIO_JUGADOR));

      const insignia = entrada()!.querySelector('.mat-badge-content');
      expect(insignia?.textContent?.trim()).toBe('3');
      // el número de la insignia es visual; los lectores de pantalla leen un texto oculto con el mismo dato
      expect(entrada()!.querySelector('.solo-lectores')?.textContent).toContain('3 pendientes');
    });

    it('sin invitaciones pendientes la insignia está oculta', async () => {
      await crear(crearAuthFalso(USUARIO_JUGADOR));

      expect(entrada()!.querySelector('.mat-badge-hidden')).not.toBeNull();
    });
  });

  describe('"Salir del club" (solo personal: monitor y mantenimiento)', () => {
    const botonSalirClub = (): HTMLButtonElement | null =>
      el().querySelector<HTMLButtonElement>('button[data-accion="salir-club"]');
    const personalAuth = (rol: 'MONITOR' | 'MANTENIMIENTO' = 'MONITOR') =>
      crearAuthFalso({ ...USUARIO_ADMIN, rol });
    const confirma = (respuesta: boolean): void => {
      dialogo.open.mockReturnValue({ afterClosed: () => of(respuesta) });
    };

    it.each(['MONITOR', 'MANTENIMIENTO'] as const)(
      'un %s tiene el botón, accesible',
      async (rol) => {
        await crear(personalAuth(rol));

        expect(botonSalirClub()?.getAttribute('aria-label')).toBe('Salir del club');
      },
    );

    it.each([USUARIO_ADMIN, USUARIO_JUGADOR])(
      'un administrador o un jugador no lo tienen',
      async (usuario) => {
        await crear(crearAuthFalso(usuario));

        expect(botonSalirClub()).toBeNull();
      },
    );

    it('sin sesión no aparece', async () => {
      await crear(crearAuthFalso(null));

      expect(botonSalirClub()).toBeNull();
    });

    it('pide confirmación avisando de que sus incidencias activas quedarán sin asignar', async () => {
      await crear(personalAuth());
      confirma(false);

      botonSalirClub()!.click();

      const [componente, config] = dialogo.open.mock.calls[0];
      expect(componente).toBe(ConfirmDialog);
      expect(config.data.titulo).toContain('Salir del club');
      expect(config.data.mensaje).toContain('incidencias');
      expect(config.data.mensaje).toContain('sin asignar');
      expect(config.data.mensaje).toContain('volver a iniciar sesión');
      expect(personal.salir).not.toHaveBeenCalled();
    });

    it('al confirmar sale, cierra la sesión y va a /login con el motivo', async () => {
      personal.salir.mockReturnValue(of(undefined));
      const auth = personalAuth();
      await crear(auth);
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      confirma(true);

      botonSalirClub()!.click();

      expect(personal.salir).toHaveBeenCalledTimes(1);
      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect(navegar).toHaveBeenCalledWith(['/login'], {
        queryParams: { motivo: 'salida-del-club' },
      });
    });

    it('no cierra la sesión hasta que el backend responde', async () => {
      personal.salir.mockReturnValue(NEVER);
      const auth = personalAuth();
      await crear(auth);
      confirma(true);

      botonSalirClub()!.click();

      expect(auth.logout).not.toHaveBeenCalled();
    });

    it('si se cancela la confirmación no hace nada', async () => {
      const auth = personalAuth();
      await crear(auth);
      confirma(false);

      botonSalirClub()!.click();

      expect(personal.salir).not.toHaveBeenCalled();
      expect(auth.logout).not.toHaveBeenCalled();
    });

    it('un 409 se avisa con el mensaje del backend y la sesión sigue abierta', async () => {
      personal.salir.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { error: 'El administrador no puede salir del club' },
            }),
        ),
      );
      const auth = personalAuth();
      await crear(auth);
      confirma(true);

      botonSalirClub()!.click();

      expect(snack.open.mock.calls[0][0]).toBe('El administrador no puede salir del club');
      expect(auth.logout).not.toHaveBeenCalled();
    });
  });

  describe('entrada del club según el usuario', () => {
    const entradaClub = (): HTMLAnchorElement | undefined =>
      enlaces().find((a) => a.getAttribute('href')?.startsWith('/club'));

    it('un jugador sin club ve "Crear mi club"', async () => {
      await crear(crearAuthFalso(USUARIO_JUGADOR));

      expect(entradaClub()?.textContent).toContain('Crear mi club');
      expect(entradaClub()?.getAttribute('href')).toBe('/club/crear');
    });

    it('un administrador ve "Mi club"', async () => {
      await crear(crearAuthFalso(USUARIO_ADMIN));

      expect(entradaClub()?.textContent).toContain('Mi club');
      expect(entradaClub()?.textContent).not.toContain('Crear');
      expect(entradaClub()?.getAttribute('href')).toBe('/club');
    });

    it('un monitor no ve ninguna entrada de club', async () => {
      await crear(crearAuthFalso({ ...USUARIO_ADMIN, rol: 'MONITOR' }));

      expect(entradaClub()).toBeUndefined();
    });
  });

  it('muestra la campana de notificaciones en la barra solo con sesión', async () => {
    await crear(crearAuthFalso());
    expect(el().querySelector('mat-toolbar app-campana')).not.toBeNull();
  });

  it('arranca el servicio de tiempo real al montarse (fuera del bundle inicial)', async () => {
    tiempoRealCreado = false;
    await crear(crearAuthFalso());
    expect(tiempoRealCreado).toBe(true);
  });

  it('no muestra la campana sin sesión', async () => {
    await crear(crearAuthFalso(null));
    expect(el().querySelector('app-campana')).toBeNull();
  });

  it('oculta el menú, el usuario y el botón de salir sin sesión', async () => {
    await crear(crearAuthFalso(null));

    expect(enlaces()).toHaveLength(0);
    expect(enlacesMenu()).toHaveLength(0);
    expect(el().querySelector('nav.enlaces')).toBeNull();
    expect(el().querySelector('button[data-accion="salir"]')).toBeNull();
    expect(el().querySelector('mat-chip, .rol')).toBeNull();
  });

  describe('sesión incierta (hay token pero /me no ha podido cargar el usuario)', () => {
    const aviso = (): HTMLElement | null => el().querySelector('[data-aviso="servidor"]');

    function authIncierta(): ReturnType<typeof crearAuthFalso> {
      const auth = crearAuthFalso();
      auth.usuario.set(null); // token presente, usuario sin cargar
      auth.sesionIncierta.set(true);
      return auth;
    }

    it('muestra un aviso no bloqueante y sigue pintando el menú y el contenido', async () => {
      await crear(authIncierta());

      expect(aviso()?.getAttribute('role')).toBe('status');
      expect(aviso()?.textContent).toContain('No se pudo contactar con el servidor');
      expect(el().querySelector('router-outlet')).not.toBeNull();
      expect(enlaces().length).toBeGreaterThan(0);
    });

    it('sin usuario cargado no pinta nombre, rol ni entradas de club', async () => {
      await crear(authIncierta());

      expect(el().querySelector('.usuario')).toBeNull();
      expect(el().querySelector('.rol')).toBeNull();
      expect(hrefs(enlaces()).some((h) => h?.startsWith('/club'))).toBe(false);
    });

    it('"Reintentar" vuelve a pedir el usuario', async () => {
      const auth = authIncierta();
      await crear(auth);

      el().querySelector<HTMLButtonElement>('[data-aviso="servidor"] button')!.click();

      expect(auth.reintentarCarga).toHaveBeenCalledTimes(1);
    });

    it('el aviso desaparece cuando la sesión deja de ser incierta', async () => {
      const auth = authIncierta();
      await crear(auth);

      auth.sesionIncierta.set(false);
      await fixture.whenStable();

      expect(aviso()).toBeNull();
    });

    it('con la sesión normal no hay aviso', async () => {
      await crear(crearAuthFalso());
      expect(aviso()).toBeNull();
    });
  });

  it('al salir cierra la sesión y navega a /login', async () => {
    const auth = crearAuthFalso();
    await crear(auth);
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    el().querySelector<HTMLButtonElement>('button[data-accion="salir"]')!.click();

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith('/login');
  });
});
