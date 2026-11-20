import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NEVER, of, throwError } from 'rxjs';
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

  async function crear(auth: ReturnType<typeof crearAuthFalso>): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [MainLayout],
      providers: [
        provideRouter([]),
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

  beforeEach(() => {
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

  it('la barra superior lleva el selector de tema, con su etiqueta accesible', async () => {
    await crear(crearAuthFalso());

    const boton = el().querySelector('mat-toolbar button[data-accion="cambiar-tema"]');
    expect(boton).not.toBeNull();
    expect(boton?.getAttribute('aria-label')).toMatch(/^Cambiar a tema (claro|oscuro)$/);
  });

  it('muestra las entradas Agenda y Mis reservas cuando hay sesión', async () => {
    await crear(crearAuthFalso());

    const enlaces = Array.from(el().querySelectorAll('a[mat-list-item]')).map((a) =>
      a.textContent?.trim(),
    );
    expect(enlaces.some((t) => t?.includes('Agenda'))).toBe(true);
    expect(enlaces.some((t) => t?.includes('Mis reservas'))).toBe(true);
  });

  it.each([
    ['jugador sin club', USUARIO_JUGADOR],
    ['administrador de club', USUARIO_ADMIN],
    ['monitor', { ...USUARIO_JUGADOR, rol: 'MONITOR' as const, clubId: 5, clubNombre: 'Club' }],
  ])(
    'muestra "Mis facturas" (receipt_long, /facturas) a todo usuario autenticado: %s',
    async (_, usuario) => {
      await crear(crearAuthFalso(usuario));

      const enlace = Array.from(el().querySelectorAll<HTMLAnchorElement>('a[mat-list-item]')).find(
        (a) => a.getAttribute('href') === '/facturas',
      );
      expect(enlace?.textContent).toContain('Mis facturas');
      expect(enlace?.querySelector('mat-icon')?.textContent?.trim()).toBe('receipt_long');
    },
  );

  it('sin sesión no hay menú, y por tanto tampoco "Mis facturas"', async () => {
    await crear(crearAuthFalso(null));

    expect(el().querySelector('a[href="/facturas"]')).toBeNull();
  });

  it('muestra Incidencias a todo usuario autenticado, también a un jugador sin club', async () => {
    await crear(crearAuthFalso(USUARIO_JUGADOR));

    const enlace = Array.from(el().querySelectorAll<HTMLAnchorElement>('a[mat-list-item]')).find(
      (a) => a.getAttribute('href') === '/incidencias',
    );
    expect(enlace?.textContent).toContain('Incidencias');
    expect(enlace?.querySelector('mat-icon')?.textContent?.trim()).toBe('report_problem');
  });

  it('muestra también Partidos y Deudas, con sus iconos y rutas', async () => {
    await crear(crearAuthFalso());

    const enlaces = Array.from(el().querySelectorAll<HTMLAnchorElement>('a[mat-list-item]'));
    const porTexto = (texto: string) => enlaces.find((a) => a.textContent?.includes(texto));
    expect(porTexto('Partidos')?.getAttribute('href')).toBe('/partidos');
    expect(porTexto('Partidos')?.querySelector('mat-icon')?.textContent?.trim()).toBe('groups');
    expect(porTexto('Deudas')?.getAttribute('href')).toBe('/deudas');
    expect(porTexto('Deudas')?.querySelector('mat-icon')?.textContent?.trim()).toBe('payments');
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual([
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

  describe('entrada "Panel" (solo el administrador del club)', () => {
    const entradaPanel = (): HTMLAnchorElement | undefined =>
      Array.from(el().querySelectorAll<HTMLAnchorElement>('a[mat-list-item]')).find(
        (a) => a.getAttribute('href') === '/panel',
      );

    it('el administrador la ve la primera, con icono insights', async () => {
      await crear(crearAuthFalso(USUARIO_ADMIN));

      expect(entradaPanel()?.textContent).toContain('Panel');
      expect(entradaPanel()?.querySelector('mat-icon')?.textContent?.trim()).toBe('insights');
      expect(el().querySelector('a[mat-list-item]')?.getAttribute('href')).toBe('/panel');
    });

    it.each(['JUGADOR', 'MONITOR', 'MANTENIMIENTO'] as const)('un %s no la ve', async (rol) => {
      await crear(crearAuthFalso({ ...USUARIO_ADMIN, rol }));

      expect(entradaPanel()).toBeUndefined();
    });
  });

  describe('entrada "Invitaciones" (solo quien puede aceptar: jugador sin club)', () => {
    const entrada = (): HTMLAnchorElement | undefined =>
      Array.from(el().querySelectorAll<HTMLAnchorElement>('a[mat-list-item]')).find(
        (a) => a.getAttribute('href') === '/invitaciones',
      );

    it('un jugador sin club la ve, con icono mail', async () => {
      await crear(crearAuthFalso(USUARIO_JUGADOR));

      expect(entrada()?.textContent).toContain('Invitaciones');
      expect(entrada()?.querySelector('mat-icon')?.textContent?.trim()).toBe('mail');
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
      Array.from(el().querySelectorAll<HTMLAnchorElement>('a[mat-list-item]')).find((a) =>
        a.getAttribute('href')?.startsWith('/club'),
      );

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

    expect(el().querySelectorAll('a[mat-list-item]')).toHaveLength(0);
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
      expect(el().querySelectorAll('a[mat-list-item]').length).toBeGreaterThan(0);
    });

    it('sin usuario cargado no pinta nombre, rol ni entradas de club', async () => {
      await crear(authIncierta());

      expect(el().querySelector('.usuario')).toBeNull();
      expect(el().querySelector('.rol')).toBeNull();
      const hrefs = Array.from(el().querySelectorAll('a[mat-list-item]')).map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs.some((h) => h?.startsWith('/club'))).toBe(false);
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
