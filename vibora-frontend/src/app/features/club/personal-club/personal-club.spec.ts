import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EMPTY, NEVER, of, throwError } from 'rxjs';
import { InvitacionService } from '../../../core/api/invitacion.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificacionesStore } from '../../../core/notificaciones/notificaciones.store';
import { ConfirmDialog } from '../../../shared/components/confirm-dialog/confirm-dialog';
import { MiembroPersonal } from '../../../shared/models/incidencia.model';
import { PersonalService } from '../personal.service';
import { InvitarDialog } from './invitar-dialog';
import { PersonalClub } from './personal-club';

const ADMIN: MiembroPersonal = {
  usuarioId: 9,
  nombre: 'Marta',
  apellidos: 'Ruiz',
  email: 'admin@club.es',
  rol: 'ADMIN_CLUB',
};
const PEPE: MiembroPersonal = {
  usuarioId: 20,
  nombre: 'Pepe',
  apellidos: 'Gil',
  email: 'pepe@club.es',
  rol: 'MANTENIMIENTO',
};
const LOLA: MiembroPersonal = {
  usuarioId: 21,
  nombre: 'Lola',
  apellidos: 'Sanz',
  email: 'lola@club.es',
  rol: 'MONITOR',
};
const SIN_NOMBRE: MiembroPersonal = {
  usuarioId: 22,
  nombre: null,
  apellidos: 'Ortega',
  email: 'ortega@club.es',
  rol: 'MONITOR',
};

const http = (status: number, error?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

describe('PersonalClub', () => {
  let fixture: ComponentFixture<PersonalClub>;
  const personal = { listar: vi.fn(), quitar: vi.fn() };
  const invitaciones = { listar: vi.fn() };
  const dialogo = { open: vi.fn() };
  const snack = { open: vi.fn() };

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [PersonalClub],
      providers: [
        { provide: PersonalService, useValue: personal },
        { provide: InvitacionService, useValue: invitaciones },
        { provide: NotificacionesStore, useValue: { recibidas$: EMPTY } },
        { provide: AuthService, useValue: { sesionIncierta: signal(false) } },
        { provide: MatDialog, useValue: dialogo },
        { provide: MatSnackBar, useValue: snack },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PersonalClub);
    fixture.componentRef.setInput('clubId', 5);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends Element>(s: string): T | null => el().querySelector<T>(s);
  const filas = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('tr.miembro'));
  const texto = (e: Element | null): string => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const cierraCon = (resultado: unknown): void => {
    dialogo.open.mockReturnValue({ afterClosed: () => of(resultado) });
  };
  const botonQuitar = (fila: HTMLElement): HTMLButtonElement | null =>
    fila.querySelector<HTMLButtonElement>('button[data-accion="quitar"]');

  beforeEach(() => {
    vi.resetAllMocks();
    personal.listar.mockReturnValue(of([ADMIN, PEPE, LOLA, SIN_NOMBRE]));
    invitaciones.listar.mockReturnValue(of([]));
    cierraCon(undefined);
  });

  it('un miembro sin nombre ni apellidos sale como "Sin nombre" (también en el aria-label), sin "null"', async () => {
    personal.listar.mockReturnValue(of([{ ...SIN_NOMBRE, nombre: null, apellidos: null }]));

    await crear();

    expect(texto(filas()[0].querySelector('.nombre'))).toBe('Sin nombre');
    expect(botonQuitar(filas()[0])!.getAttribute('aria-label')).toBe(
      'Quitar a Sin nombre del personal',
    );
    expect(el().textContent).not.toContain('null');
  });

  describe('listado', () => {
    it('pide el personal del club y muestra un spinner mientras tanto', async () => {
      personal.listar.mockReturnValue(NEVER);

      await crear();

      expect(personal.listar).toHaveBeenCalledWith(5);
      expect(q('mat-spinner')?.getAttribute('aria-label')).toBe('Cargando el personal');
      expect(q('table')).toBeNull();
    });

    it('una fila por persona con nombre, email y rol en español; sin nombre usa solo apellidos', async () => {
      await crear();

      expect(filas()).toHaveLength(4);
      expect(texto(filas()[0])).toContain('Marta Ruiz');
      expect(texto(filas()[0])).toContain('admin@club.es');
      expect(texto(filas()[0].querySelector('mat-chip'))).toBe('Admin de club');
      expect(texto(filas()[1].querySelector('mat-chip'))).toBe('Mantenimiento');
      expect(texto(filas()[2].querySelector('mat-chip'))).toBe('Monitor');
      expect(texto(filas()[3].querySelector('.nombre'))).toBe('Ortega');
    });

    it('la tabla tiene nombre accesible y cabeceras', async () => {
      await crear();

      expect(q('table')?.getAttribute('aria-label')).toBe('Personal del club');
      const cabeceras = Array.from(el().querySelectorAll('th')).map((c) => texto(c));
      expect(cabeceras.slice(0, 3)).toEqual(['Nombre', 'Email', 'Rol']);
    });

    it('el administrador se muestra pero sin botón de quitar; el resto sí, con etiqueta accesible', async () => {
      await crear();

      expect(botonQuitar(filas()[0])).toBeNull();
      expect(botonQuitar(filas()[1])?.getAttribute('aria-label')).toBe(
        'Quitar a Pepe Gil del personal',
      );
      expect(botonQuitar(filas()[2])).not.toBeNull();
      expect(botonQuitar(filas()[3])?.getAttribute('aria-label')).toBe(
        'Quitar a Ortega del personal',
      );
    });

    it('sin personal (solo la lista vacía) lo dice', async () => {
      personal.listar.mockReturnValue(of([]));

      await crear();

      expect(texto(el())).toContain('No hay personal');
      expect(q('table')).toBeNull();
    });

    it('si la carga falla muestra el motivo y permite reintentar', async () => {
      personal.listar.mockReturnValueOnce(throwError(() => http(500)));
      await crear();

      expect(q('[role="alert"]')?.textContent).toContain('No se pudo cargar el personal');
      personal.listar.mockReturnValue(of([ADMIN, PEPE]));
      q<HTMLButtonElement>('button[data-accion="reintentar"]')!.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(filas()).toHaveLength(2);
      expect(q('[role="alert"]')).toBeNull();
    });
  });

  describe('invitar', () => {
    it('ya no hay alta directa: el botón es "Invitar"', async () => {
      await crear();

      expect(q('button[data-accion="anadir"]')).toBeNull();
      expect(texto(q('button[data-accion="invitar"]'))).toContain('Invitar');
      expect(texto(el())).not.toContain('Añadir personal');
    });

    it('el botón abre el diálogo de invitación con el club', async () => {
      await crear();

      q<HTMLButtonElement>('button[data-accion="invitar"]')!.click();

      const [componente, config] = dialogo.open.mock.calls[0];
      expect(componente).toBe(InvitarDialog);
      expect(config.data).toEqual({ clubId: 5 });
    });

    it('al invitar muestra el mensaje neutro recibido y recarga las invitaciones (no el personal)', async () => {
      await crear();
      cierraCon('Si el correo es válido, la persona recibirá la invitación.');
      personal.listar.mockClear();
      invitaciones.listar.mockClear();

      q<HTMLButtonElement>('button[data-accion="invitar"]')!.click();
      await fixture.whenStable();

      expect(snack.open.mock.calls[0][0]).toBe(
        'Si el correo es válido, la persona recibirá la invitación.',
      );
      expect(invitaciones.listar).toHaveBeenCalledTimes(1);
      expect(personal.listar).not.toHaveBeenCalled();
    });

    it('si se cierra el diálogo sin invitar no avisa ni recarga', async () => {
      await crear();
      personal.listar.mockClear();
      invitaciones.listar.mockClear();

      q<HTMLButtonElement>('button[data-accion="invitar"]')!.click();
      await fixture.whenStable();

      expect(snack.open).not.toHaveBeenCalled();
      expect(invitaciones.listar).not.toHaveBeenCalled();
    });

    it('debajo del personal hay una sección "Invitaciones" del mismo club', async () => {
      await crear();

      const seccion = q('app-invitaciones-club');
      expect(seccion).not.toBeNull();
      expect(invitaciones.listar).toHaveBeenCalledWith(5, undefined);
    });
  });

  describe('quitar personal', () => {
    async function pulsarQuitar(indice: number): Promise<void> {
      botonQuitar(filas()[indice])!.click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('pide confirmación diciendo que las incidencias activas de esa persona quedarán sin asignar', async () => {
      await crear();

      await pulsarQuitar(1);

      const [componente, config] = dialogo.open.mock.calls[0];
      expect(componente).toBe(ConfirmDialog);
      expect(config.data.titulo).toContain('Quitar');
      expect(config.data.mensaje).toContain('incidencias');
      expect(config.data.mensaje).toContain('sin asignar');
      expect(config.data.lineas).toEqual(
        expect.arrayContaining([
          { etiqueta: 'Persona', valor: 'Pepe Gil' },
          { etiqueta: 'Rol', valor: 'Mantenimiento' },
        ]),
      );
      expect(personal.quitar).not.toHaveBeenCalled();
    });

    it('al confirmar quita, avisa y recarga la lista', async () => {
      personal.quitar.mockReturnValue(of(undefined));
      await crear();
      cierraCon(true);
      personal.listar.mockClear();
      personal.listar.mockReturnValue(of([ADMIN, LOLA]));

      await pulsarQuitar(1);

      expect(personal.quitar).toHaveBeenCalledWith(5, 20);
      expect(snack.open.mock.calls[0][0]).toContain('Pepe Gil');
      expect(personal.listar).toHaveBeenCalledTimes(1);
      expect(filas()).toHaveLength(2);
    });

    it('si se cancela la confirmación no se quita a nadie', async () => {
      await crear();
      cierraCon(false);

      await pulsarQuitar(1);

      expect(personal.quitar).not.toHaveBeenCalled();
    });

    it('un error (409 de administrador) se avisa con el mensaje del backend y se recarga', async () => {
      personal.quitar.mockReturnValue(
        throwError(() => http(409, { error: 'No se puede quitar a un administrador del club' })),
      );
      await crear();
      cierraCon(true);
      personal.listar.mockClear();

      await pulsarQuitar(1);

      expect(snack.open.mock.calls[0][0]).toBe('No se puede quitar a un administrador del club');
      expect(personal.listar).toHaveBeenCalledTimes(1);
    });

    it('un 404 (ya no es personal) también recarga para mostrar el estado real', async () => {
      personal.quitar.mockReturnValue(
        throwError(() => http(404, { error: 'Personal no encontrado' })),
      );
      await crear();
      cierraCon(true);
      personal.listar.mockClear();

      await pulsarQuitar(2);

      expect(snack.open.mock.calls[0][0]).toBe('Personal no encontrado');
      expect(personal.listar).toHaveBeenCalledTimes(1);
    });

    it('un fallo de red avisa sin recargar', async () => {
      personal.quitar.mockReturnValue(throwError(() => http(0)));
      await crear();
      cierraCon(true);
      personal.listar.mockClear();

      await pulsarQuitar(1);

      expect(snack.open.mock.calls[0][0]).toContain('No se pudo conectar');
      expect(personal.listar).not.toHaveBeenCalled();
    });

    it('con una baja en vuelo los botones de quitar se deshabilitan', async () => {
      personal.quitar.mockReturnValue(NEVER);
      await crear();
      cierraCon(true);

      await pulsarQuitar(1);

      expect(botonQuitar(filas()[2])!.disabled).toBe(true);
    });
  });
});
