import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { InvitacionService } from '../../../core/api/invitacion.service';
import { AuthService } from '../../../core/auth/auth.service';
import { InvitacionesStore } from '../../../core/invitaciones/invitaciones.store';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { InvitacionMia } from '../../../shared/models/invitacion.model';
import { InvitacionAceptadaDialog } from './invitacion-aceptada-dialog';
import { MisInvitaciones } from './mis-invitaciones';

const AHORA = new Date('2026-07-10T09:00:00Z');

const FUTURA = (dias: number): string =>
  new Date(AHORA.getTime() + dias * 86_400_000 + 3_600_000).toISOString();

const NORTE: InvitacionMia = {
  id: 1,
  clubNombre: 'Club Norte',
  rol: 'MONITOR',
  invitadoPor: 'Marta Ruiz',
  caducaEn: FUTURA(5),
};
const SUR: InvitacionMia = {
  id: 2,
  clubNombre: 'Club Sur',
  rol: 'MANTENIMIENTO',
  invitadoPor: null,
  caducaEn: FUTURA(1),
};

const http = (status: number, error?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

describe('MisInvitaciones', () => {
  let fixture: ComponentFixture<MisInvitaciones>;
  const items = signal<InvitacionMia[]>([]);
  const cargando = signal(false);
  const error = signal<string | null>(null);
  const store = { items, cargando, error, recargar: vi.fn(), retirar: vi.fn() };
  const invitaciones = { aceptar: vi.fn(), rechazar: vi.fn() };
  const auth = { logout: vi.fn() };
  const router = { navigate: vi.fn() };
  const dialogo = { open: vi.fn() };
  const snack = { open: vi.fn() };

  async function crear(): Promise<void> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AHORA);
    await TestBed.configureTestingModule({
      imports: [MisInvitaciones],
      providers: [
        { provide: InvitacionesStore, useValue: store },
        { provide: InvitacionService, useValue: invitaciones },
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        { provide: MatDialog, useValue: dialogo },
        { provide: MatSnackBar, useValue: snack },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MisInvitaciones);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends Element>(s: string): T | null => el().querySelector<T>(s);
  const tarjetas = (): HTMLElement[] =>
    Array.from(el().querySelectorAll<HTMLElement>('mat-card.invitacion'));
  const texto = (e: Element | null): string => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const boton = (t: HTMLElement, accion: string): HTMLButtonElement =>
    t.querySelector<HTMLButtonElement>(`button[data-accion="${accion}"]`)!;
  const asentar = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  /** El diálogo de confirmación (1º) se resuelve con `respuesta`; el resto con `segundo` si se da. */
  const dialogos = (respuesta: boolean, segundo?: Subject<unknown>): void => {
    dialogo.open
      .mockReturnValueOnce({ afterClosed: () => of(respuesta) })
      .mockReturnValueOnce({ afterClosed: () => (segundo ? segundo.asObservable() : of(true)) });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    items.set([NORTE, SUR]);
    cargando.set(false);
    error.set(null);
  });

  afterEach(() => vi.useRealTimers());

  describe('listado', () => {
    it('una tarjeta por invitación con club, rol en español y quién invita', async () => {
      await crear();

      expect(tarjetas()).toHaveLength(2);
      expect(texto(tarjetas()[0])).toContain('Club Norte');
      expect(texto(tarjetas()[0])).toContain('Monitor');
      expect(texto(tarjetas()[0])).toContain('Marta Ruiz');
      expect(texto(tarjetas()[1])).toContain('Mantenimiento');
    });

    it('si falta quién invita no pinta "null" ni deja el hueco', async () => {
      await crear();

      expect(texto(tarjetas()[1])).not.toContain('null');
      expect(texto(tarjetas()[1])).not.toMatch(/Invitado por\s*$/);
      items.set([{ ...SUR, invitadoPor: '   ' }]);
      await asentar();
      expect(texto(tarjetas()[0])).not.toContain('Invitado por');
      expect(el().textContent).not.toContain('null');
      expect(el().textContent).not.toContain('undefined');
    });

    it('caducidad: fecha exacta en hora de Madrid y relativa', async () => {
      await crear();

      expect(texto(tarjetas()[0])).toContain('15 de julio de 2026, 12:00'); // 09:00Z + 5d + 1h = 10:00Z; Madrid en verano = UTC+2
      expect(texto(tarjetas()[0])).toContain('caduca en 5 días');
      expect(texto(tarjetas()[1])).toContain('caduca en 1 día');
    });

    it('sin invitaciones: "No tienes invitaciones pendientes"', async () => {
      items.set([]);

      await crear();

      expect(texto(el())).toContain('No tienes invitaciones pendientes');
      expect(tarjetas()).toHaveLength(0);
    });

    it('mientras carga muestra un spinner accesible', async () => {
      cargando.set(true);

      await crear();

      expect(q('mat-spinner')?.getAttribute('aria-label')).toBe('Cargando tus invitaciones');
    });

    it('si falla muestra el motivo y Reintentar pide la carga con spinner', async () => {
      error.set('No se pudieron cargar tus invitaciones.');

      await crear();

      expect(q('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
      q<HTMLButtonElement>('button[data-accion="reintentar"]')!.click();
      expect(store.recargar).toHaveBeenCalledWith();
      expect(tarjetas()).toHaveLength(0);
    });
  });

  describe('aceptar', () => {
    it('pide confirmación explicando el rol, el club y que tendrá que volver a iniciar sesión', async () => {
      await crear();
      dialogos(false);

      boton(tarjetas()[0], 'aceptar').click();

      const [componente, config] = dialogo.open.mock.calls[0];
      expect(componente).toBe(ConfirmDialog);
      expect(config.data.mensaje).toContain('Monitor');
      expect(config.data.mensaje).toContain('Club Norte');
      expect(config.data.mensaje).toContain('volver a iniciar sesión');
      expect(invitaciones.aceptar).not.toHaveBeenCalled();
    });

    it('si se cancela la confirmación no acepta', async () => {
      await crear();
      dialogos(false);

      boton(tarjetas()[0], 'aceptar').click();

      expect(invitaciones.aceptar).not.toHaveBeenCalled();
    });

    it('al aceptar avisa de que debe volver a iniciar sesión y, solo al cerrar el aviso, cierra la sesión y va a /login con el motivo', async () => {
      invitaciones.aceptar.mockReturnValue(
        of({ requiereNuevoLogin: true, clubNombre: 'Club Norte', rol: 'MONITOR' }),
      );
      const cierre = new Subject<unknown>();
      await crear();
      dialogos(true, cierre);

      boton(tarjetas()[0], 'aceptar').click();

      expect(invitaciones.aceptar).toHaveBeenCalledWith(1);
      const [componente, config] = dialogo.open.mock.calls[1];
      expect(componente).toBe(InvitacionAceptadaDialog);
      expect(config.disableClose).toBe(true);
      expect(config.data).toEqual({ clubNombre: 'Club Norte', rol: 'Monitor' });
      expect(auth.logout).not.toHaveBeenCalled();

      cierre.next(undefined);

      expect(auth.logout).toHaveBeenCalledTimes(1);
      expect(router.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { motivo: 'invitacion-aceptada' },
      });
    });

    it('un 409 (caducada / ya perteneces a un club) se muestra en la tarjeta con el mensaje del backend', async () => {
      invitaciones.aceptar.mockReturnValue(
        throwError(() => http(409, { error: 'Ya perteneces a un club' })),
      );
      await crear();
      dialogos(true);

      boton(tarjetas()[0], 'aceptar').click();
      await asentar();

      expect(texto(tarjetas()[0].querySelector('[role="alert"]'))).toBe('Ya perteneces a un club');
      expect(auth.logout).not.toHaveBeenCalled();
      expect(store.recargar).not.toHaveBeenCalled();
    });

    it('un 404 (cancelada o caducada): recarga la lista en silencio y avisa', async () => {
      invitaciones.aceptar.mockReturnValue(throwError(() => http(404, { error: 'No existe' })));
      await crear();
      dialogos(true);

      boton(tarjetas()[0], 'aceptar').click();

      expect(store.recargar).toHaveBeenCalledWith(true);
      expect(snack.open.mock.calls[0][0]).toContain('ya no está disponible');
      expect(auth.logout).not.toHaveBeenCalled();
    });

    it('un fallo de red se muestra en la tarjeta sin cerrar sesión', async () => {
      invitaciones.aceptar.mockReturnValue(throwError(() => http(0)));
      await crear();
      dialogos(true);

      boton(tarjetas()[0], 'aceptar').click();
      await asentar();

      expect(texto(tarjetas()[0].querySelector('[role="alert"]'))).toContain('No se pudo conectar');
      expect(auth.logout).not.toHaveBeenCalled();
    });

    it('los botones de la invitación en curso se deshabilitan hasta la respuesta', async () => {
      invitaciones.aceptar.mockReturnValue(new Subject());
      await crear();
      dialogos(true);

      boton(tarjetas()[0], 'aceptar').click();
      await asentar();

      expect(boton(tarjetas()[0], 'aceptar').disabled).toBe(true);
      expect(boton(tarjetas()[1], 'aceptar').disabled).toBe(true);
    });
  });

  describe('rechazar', () => {
    it('pide confirmación y no rechaza hasta confirmar', async () => {
      await crear();
      dialogos(false);

      boton(tarjetas()[0], 'rechazar').click();

      const [componente, config] = dialogo.open.mock.calls[0];
      expect(componente).toBe(ConfirmDialog);
      expect(config.data.titulo).toContain('Rechazar');
      expect(config.data.lineas).toEqual(
        expect.arrayContaining([{ etiqueta: 'Club', valor: 'Club Norte' }]),
      );
      expect(invitaciones.rechazar).not.toHaveBeenCalled();
    });

    it('al confirmar rechaza, la retira de la lista y avisa; no cierra la sesión', async () => {
      invitaciones.rechazar.mockReturnValue(of(undefined));
      await crear();
      dialogos(true);

      boton(tarjetas()[0], 'rechazar').click();

      expect(invitaciones.rechazar).toHaveBeenCalledWith(1);
      expect(store.retirar).toHaveBeenCalledWith(1);
      expect(snack.open.mock.calls[0][0]).toContain('rechazado');
      expect(auth.logout).not.toHaveBeenCalled();
    });

    it('un 404 recarga la lista en silencio', async () => {
      invitaciones.rechazar.mockReturnValue(throwError(() => http(404, { error: 'No existe' })));
      await crear();
      dialogos(true);

      boton(tarjetas()[1], 'rechazar').click();

      expect(store.recargar).toHaveBeenCalledWith(true);
      expect(store.retirar).not.toHaveBeenCalled();
    });

    it('otro error se muestra en la tarjeta', async () => {
      invitaciones.rechazar.mockReturnValue(throwError(() => http(500)));
      await crear();
      dialogos(true);

      boton(tarjetas()[0], 'rechazar').click();
      await asentar();

      expect(texto(tarjetas()[0].querySelector('[role="alert"]'))).toContain('No se pudo rechazar');
    });
  });

  it('los botones tienen etiqueta accesible con el club', async () => {
    await crear();

    expect(boton(tarjetas()[0], 'aceptar').getAttribute('aria-label')).toBe(
      'Aceptar la invitación de Club Norte',
    );
    expect(boton(tarjetas()[0], 'rechazar').getAttribute('aria-label')).toBe(
      'Rechazar la invitación de Club Norte',
    );
  });
});
