import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NotificacionesStore } from '../../notificaciones/notificaciones.store';
import { TiempoRealService } from '../../notificaciones/tiempo-real.service';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { USUARIO_ADMIN, USUARIO_JUGADOR, crearAuthFalso } from '../../../testing/test-utils';
import { MainLayout } from './main-layout';

describe('MainLayout', () => {
  const storeFalso = {
    items: signal([]),
    noLeidas: signal(0),
    marcarLeida: vi.fn(),
    marcarTodas: vi.fn(),
  };
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

  it('muestra las entradas Agenda y Mis reservas cuando hay sesión', async () => {
    await crear(crearAuthFalso());

    const enlaces = Array.from(el().querySelectorAll('a[mat-list-item]')).map((a) =>
      a.textContent?.trim(),
    );
    expect(enlaces.some((t) => t?.includes('Agenda'))).toBe(true);
    expect(enlaces.some((t) => t?.includes('Mis reservas'))).toBe(true);
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
      '/incidencias',
      '/club/crear',
    ]);
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
