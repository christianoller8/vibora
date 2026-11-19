import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { InvitacionService } from '../../../core/api/invitacion.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificacionesStore } from '../../../core/notificaciones/notificaciones.store';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { InvitacionClub } from '../../../shared/models/invitacion.model';
import { Notificacion, TipoNotificacion } from '../../../shared/models/notificacion.model';
import { InvitacionesClub } from './invitaciones-club';

const base = (id: number, extra: Partial<InvitacionClub>): InvitacionClub => ({
  id,
  email: `p${id}@club.es`,
  rol: 'MONITOR',
  estado: 'PENDIENTE',
  creadaEn: '2026-07-01T10:00:00Z',
  caducaEn: '2026-07-15T10:00:00Z',
  resueltaEn: null,
  ...extra,
});

const PENDIENTE = base(1, { email: 'ana@club.es', rol: 'MANTENIMIENTO' });
const ACEPTADA = base(2, { estado: 'ACEPTADA', resueltaEn: '2026-07-02T11:00:00Z' });
const RECHAZADA = base(3, { estado: 'RECHAZADA', resueltaEn: '2026-07-02T12:00:00Z' });
const CANCELADA = base(4, { estado: 'CANCELADA', resueltaEn: '2026-07-02T13:00:00Z' });
const CADUCADA = base(5, { estado: 'CADUCADA' });

const http = (status: number, error?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

const push = (tipo: TipoNotificacion): Notificacion => ({
  id: Math.floor(Math.random() * 1e6),
  tipo,
  mensaje: 'x',
  reservaId: null,
  leida: false,
  creadaEn: '2026-07-10T10:00:00Z',
});

describe('InvitacionesClub', () => {
  let fixture: ComponentFixture<InvitacionesClub>;
  let recibidas: Subject<Notificacion>;
  let sesionIncierta: ReturnType<typeof signal<boolean>>;
  const invitaciones = { listar: vi.fn(), cancelar: vi.fn() };
  const dialogo = { open: vi.fn() };
  const snack = { open: vi.fn() };

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [InvitacionesClub],
      providers: [
        { provide: InvitacionService, useValue: invitaciones },
        { provide: MatDialog, useValue: dialogo },
        { provide: MatSnackBar, useValue: snack },
        { provide: NotificacionesStore, useValue: { recibidas$: recibidas.asObservable() } },
        { provide: AuthService, useValue: { sesionIncierta } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvitacionesClub);
    fixture.componentRef.setInput('clubId', 5);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends Element>(s: string): T | null => el().querySelector<T>(s);
  const filas = (): HTMLElement[] =>
    Array.from(el().querySelectorAll<HTMLElement>('tr.invitacion'));
  const texto = (e: Element | null): string => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const cierraCon = (r: unknown): void => {
    dialogo.open.mockReturnValue({ afterClosed: () => of(r) });
  };
  const botonCancelar = (fila: HTMLElement): HTMLButtonElement | null =>
    fila.querySelector<HTMLButtonElement>('button[data-accion="cancelar"]');
  const asentar = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.resetAllMocks();
    recibidas = new Subject<Notificacion>();
    sesionIncierta = signal(false);
    invitaciones.listar.mockReturnValue(of([PENDIENTE, ACEPTADA, RECHAZADA, CANCELADA, CADUCADA]));
    cierraCon(undefined);
  });

  afterEach(() => vi.useRealTimers());

  describe('listado', () => {
    it('pide todas las invitaciones del club (sin filtro) y muestra un spinner', async () => {
      invitaciones.listar.mockReturnValue(NEVER);

      await crear();

      expect(invitaciones.listar).toHaveBeenCalledWith(5, undefined);
      expect(q('mat-spinner')?.getAttribute('aria-label')).toBe('Cargando las invitaciones');
    });

    it('una fila por invitación con email, rol, estado y fechas en hora de Madrid', async () => {
      await crear();

      expect(filas()).toHaveLength(5);
      expect(texto(filas()[0])).toContain('ana@club.es');
      expect(texto(filas()[0].querySelector('mat-chip.rol'))).toBe('Mantenimiento');
      expect(texto(filas()[0].querySelector('mat-chip.estado'))).toBe('Pendiente');
      expect(texto(filas()[0])).toContain('1 de julio de 2026, 12:00'); // 10:00Z = 12:00 Madrid
      expect(texto(filas()[0])).toContain('15 de julio de 2026, 12:00');
      expect(q('table')?.getAttribute('aria-label')).toBe('Invitaciones del club');
    });

    it('cada estado tiene su etiqueta y su clase distinta, accesible por texto', async () => {
      await crear();

      const chips = filas().map((f) => f.querySelector('mat-chip.estado')!);
      expect(chips.map((c) => texto(c))).toEqual([
        'Pendiente',
        'Aceptada',
        'Rechazada',
        'Cancelada',
        'Caducada',
      ]);
      expect(new Set(chips.map((c) => c.className.match(/estado-\w+/)?.[0])).size).toBe(5);
    });

    it('solo las pendientes tienen "Cancelar", con etiqueta accesible', async () => {
      await crear();

      expect(botonCancelar(filas()[0])?.getAttribute('aria-label')).toBe(
        'Cancelar la invitación a ana@club.es',
      );
      for (const f of filas().slice(1)) {
        expect(botonCancelar(f)).toBeNull();
      }
    });

    it('sin invitaciones lo dice', async () => {
      invitaciones.listar.mockReturnValue(of([]));

      await crear();

      expect(texto(el())).toContain('No hay invitaciones');
      expect(q('table')).toBeNull();
    });

    it('si falla muestra el motivo y Reintentar vuelve a cargar', async () => {
      invitaciones.listar.mockReturnValueOnce(throwError(() => http(500)));
      await crear();

      expect(q('[role="alert"]')?.textContent).toContain('No se pudieron cargar las invitaciones');
      invitaciones.listar.mockReturnValue(of([PENDIENTE]));
      q<HTMLButtonElement>('button[data-accion="reintentar"]')!.click();
      await asentar();

      expect(filas()).toHaveLength(1);
      expect(q('[role="alert"]')).toBeNull();
    });

    it('al recuperarse la sesión tras una caída recarga solo si estaba en error', async () => {
      sesionIncierta.set(true);
      invitaciones.listar.mockReturnValueOnce(throwError(() => http(0)));
      await crear();
      invitaciones.listar.mockReturnValue(of([PENDIENTE]));

      sesionIncierta.set(false);
      await asentar();

      expect(filas()).toHaveLength(1);
    });
  });

  describe('filtro por estado', () => {
    it('"Pendientes" pide ?estado=PENDIENTE y "Todas" quita el filtro', async () => {
      await crear();
      invitaciones.listar.mockReturnValue(of([PENDIENTE]));

      q<HTMLButtonElement>('button[data-filtro="pendientes"]')!.click();
      await asentar();

      expect(invitaciones.listar).toHaveBeenLastCalledWith(5, 'PENDIENTE');
      expect(filas()).toHaveLength(1);

      q<HTMLButtonElement>('button[data-filtro="todas"]')!.click();
      await asentar();

      expect(invitaciones.listar).toHaveBeenLastCalledWith(5, undefined);
    });

    it('los botones de filtro tienen grupo accesible y estado pulsado', async () => {
      await crear();

      expect(q('[role="group"]')?.getAttribute('aria-label')).toBe('Filtrar por estado');
      expect(q('button[data-filtro="todas"]')?.getAttribute('aria-pressed')).toBe('true');
      expect(q('button[data-filtro="pendientes"]')?.getAttribute('aria-pressed')).toBe('false');
    });

    it('con el filtro activo y sin resultados el vacío lo menciona', async () => {
      await crear();
      invitaciones.listar.mockReturnValue(of([]));

      q<HTMLButtonElement>('button[data-filtro="pendientes"]')!.click();
      await asentar();

      expect(texto(el())).toContain('No hay invitaciones pendientes');
    });
  });

  describe('cancelar', () => {
    async function pulsarCancelar(indice = 0): Promise<void> {
      botonCancelar(filas()[indice])!.click();
      await asentar();
    }

    it('pide confirmación con el email y no cancela hasta confirmar', async () => {
      await crear();

      await pulsarCancelar();

      const [componente, config] = dialogo.open.mock.calls[0];
      expect(componente).toBe(ConfirmDialog);
      expect(config.data.titulo).toContain('Cancelar');
      expect(config.data.lineas).toEqual(
        expect.arrayContaining([{ etiqueta: 'Correo', valor: 'ana@club.es' }]),
      );
      expect(invitaciones.cancelar).not.toHaveBeenCalled();
    });

    it('al confirmar cancela (club, id), avisa y recarga en silencio', async () => {
      invitaciones.cancelar.mockReturnValue(of(undefined));
      await crear();
      cierraCon(true);
      invitaciones.listar.mockClear();
      invitaciones.listar.mockReturnValue(of([{ ...PENDIENTE, estado: 'CANCELADA' }]));

      await pulsarCancelar();

      expect(invitaciones.cancelar).toHaveBeenCalledWith(5, 1);
      expect(snack.open.mock.calls[0][0]).toContain('cancelada');
      expect(invitaciones.listar).toHaveBeenCalledTimes(1);
      expect(q('mat-spinner')).toBeNull();
    });

    it('si se rechaza la confirmación no cancela', async () => {
      await crear();
      cierraCon(false);

      await pulsarCancelar();

      expect(invitaciones.cancelar).not.toHaveBeenCalled();
    });

    it.each([404, 409])('un %s avisa con el mensaje del backend y recarga', async (estado) => {
      invitaciones.cancelar.mockReturnValue(throwError(() => http(estado, { error: 'Ya no' })));
      await crear();
      cierraCon(true);
      invitaciones.listar.mockClear();

      await pulsarCancelar();

      expect(snack.open.mock.calls[0][0]).toBe('Ya no');
      expect(invitaciones.listar).toHaveBeenCalledTimes(1);
    });

    it('un fallo de red avisa sin recargar', async () => {
      invitaciones.cancelar.mockReturnValue(throwError(() => http(0)));
      await crear();
      cierraCon(true);
      invitaciones.listar.mockClear();

      await pulsarCancelar();

      expect(snack.open.mock.calls[0][0]).toContain('No se pudo conectar');
      expect(invitaciones.listar).not.toHaveBeenCalled();
    });
  });

  describe('recarga en vivo', () => {
    it.each<TipoNotificacion>(['INVITACION_ACEPTADA', 'INVITACION_RECHAZADA'])(
      'un push %s recarga en silencio (sin spinner) tras 300 ms, agrupando ráfagas',
      async (tipo) => {
        await crear();
        vi.useFakeTimers();
        invitaciones.listar.mockClear();

        recibidas.next(push(tipo));
        recibidas.next(push(tipo));
        vi.advanceTimersByTime(299);
        expect(invitaciones.listar).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);

        expect(invitaciones.listar).toHaveBeenCalledTimes(1);
        expect(q('mat-spinner')).toBeNull();
      },
    );

    it('otros tipos de notificación no recargan', async () => {
      await crear();
      vi.useFakeTimers();
      invitaciones.listar.mockClear();

      recibidas.next(push('INVITACION_RECIBIDA'));
      recibidas.next(push('CARGO_NUEVO'));
      vi.advanceTimersByTime(1000);

      expect(invitaciones.listar).not.toHaveBeenCalled();
    });

    it('respeta el filtro activo al recargar', async () => {
      await crear();
      q<HTMLButtonElement>('button[data-filtro="pendientes"]')!.click();
      await asentar();
      vi.useFakeTimers();
      invitaciones.listar.mockClear();

      recibidas.next(push('INVITACION_ACEPTADA'));
      vi.advanceTimersByTime(300);

      expect(invitaciones.listar).toHaveBeenCalledWith(5, 'PENDIENTE');
    });

    describe('fallo de un refresco silencioso', () => {
      /** Un push ya agrupado: dispara el refresco silencioso con el resultado que se haya preparado. */
      async function empujar(): Promise<void> {
        recibidas.next(push('INVITACION_ACEPTADA'));
        await new Promise((resolver) => setTimeout(resolver, 350)); // el debounce real de 300 ms
        await asentar();
      }

      it('si releva a la primera carga y falla, muestra el error y Reintentar (no una lista vacía)', async () => {
        invitaciones.listar.mockReturnValueOnce(NEVER);
        await crear();
        invitaciones.listar.mockReturnValue(throwError(() => http(500)));

        await empujar();

        expect(q('[role="alert"]')?.textContent).toContain(
          'No se pudieron cargar las invitaciones',
        );
        expect(q('button[data-accion="reintentar"]')).not.toBeNull();
        expect(texto(el())).not.toContain('No hay invitaciones');
        expect(q('mat-spinner')).toBeNull();
      });

      it('si releva a la carga de un cambio de filtro y falla, tampoco muestra una lista vacía', async () => {
        await crear();
        invitaciones.listar.mockReturnValue(NEVER);
        q<HTMLButtonElement>('button[data-filtro="pendientes"]')!.click();
        await asentar();
        invitaciones.listar.mockReturnValue(throwError(() => http(500)));

        await empujar();

        expect(q('[role="alert"]')).not.toBeNull();
        expect(texto(el())).not.toContain('No hay invitaciones');
      });

      it('si ya hubo una carga correcta, conserva la última lista buena sin error', async () => {
        await crear();
        invitaciones.listar.mockReturnValue(throwError(() => http(500)));

        await empujar();

        expect(filas()).toHaveLength(5);
        expect(q('[role="alert"]')).toBeNull();
      });

      it('tras el error, Reintentar carga bien y deja de mostrar el error', async () => {
        invitaciones.listar.mockReturnValueOnce(NEVER);
        await crear();
        invitaciones.listar.mockReturnValue(throwError(() => http(500)));
        await empujar();
        invitaciones.listar.mockReturnValue(of([PENDIENTE]));

        q<HTMLButtonElement>('button[data-accion="reintentar"]')!.click();
        await asentar();

        expect(filas()).toHaveLength(1);
        expect(q('[role="alert"]')).toBeNull();
      });
    });

    it('al destruirse cancela la suscripción y no recarga más', async () => {
      await crear();
      vi.useFakeTimers();
      invitaciones.listar.mockClear();

      recibidas.next(push('INVITACION_ACEPTADA'));
      fixture.destroy();
      vi.advanceTimersByTime(1000);
      recibidas.next(push('INVITACION_ACEPTADA'));
      vi.advanceTimersByTime(1000);

      expect(invitaciones.listar).not.toHaveBeenCalled();
      expect(recibidas.observed).toBe(false);
    });
  });
});
