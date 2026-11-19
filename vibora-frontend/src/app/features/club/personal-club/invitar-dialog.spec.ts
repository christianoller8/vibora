import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject, of, throwError } from 'rxjs';
import { InvitacionService } from '../../../core/api/invitacion.service';
import { escribir } from '../../../testing/test-utils';
import { InvitarDialog, InvitarDialogData, MENSAJE_INVITACION_NEUTRO } from './invitar-dialog';

const http = (status: number, error?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

describe('InvitarDialog', () => {
  let fixture: ComponentFixture<InvitarDialog>;
  const invitaciones = { crear: vi.fn() };
  const dialogRef = { close: vi.fn() };
  const DATOS: InvitarDialogData = { clubId: 5 };

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [InvitarDialog],
      providers: [
        { provide: InvitacionService, useValue: invitaciones },
        { provide: MAT_DIALOG_DATA, useValue: DATOS },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvitarDialog);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const email = (): HTMLInputElement =>
    el().querySelector<HTMLInputElement>('input[name="email"]')!;
  const rol = (): HTMLSelectElement => el().querySelector<HTMLSelectElement>('select[name="rol"]')!;
  const enviar = (): HTMLButtonElement =>
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const alerta = (): string | undefined =>
    el().querySelector('[role="alert"]')?.textContent?.trim();

  async function rellenar(valorEmail: string, valorRol?: string): Promise<void> {
    escribir(email(), valorEmail);
    if (valorRol !== undefined) {
      escribir(rol(), valorRol);
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function enviarFormulario(): Promise<void> {
    enviar().click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.resetAllMocks();
    invitaciones.crear.mockReturnValue(of({ mensaje: MENSAJE_INVITACION_NEUTRO }));
  });

  it('se llama "Invitar", con email y selector con solo Monitor y Mantenimiento', async () => {
    await crear();

    expect(el().querySelector('h2')?.textContent).toContain('Invitar');
    expect(email().type).toBe('email');
    const opciones = Array.from(rol().options).map((o) => [o.value, o.textContent!.trim()]);
    expect(opciones).toEqual([
      ['MONITOR', 'Monitor'],
      ['MANTENIMIENTO', 'Mantenimiento'],
    ]);
  });

  it('no deja enviar con el email vacío, mal formado o de más de 255 caracteres', async () => {
    await crear();
    expect(enviar().disabled).toBe(true);

    await rellenar('esto-no-es-un-email');
    expect(enviar().disabled).toBe(true);
    expect(el().querySelector('mat-error')?.textContent).toContain('email válido');

    await rellenar(`${'a'.repeat(250)}@club.es`);
    expect(enviar().disabled).toBe(true);
    expect(el().querySelector('mat-error')?.textContent).toContain('demasiado largo');
    expect(invitaciones.crear).not.toHaveBeenCalled();
  });

  it('envía el email recortado y el rol elegido; se cierra con el mensaje neutro', async () => {
    await crear();
    await rellenar('  pepe@club.es  ', 'MANTENIMIENTO');

    await enviarFormulario();

    expect(invitaciones.crear).toHaveBeenCalledWith(5, {
      email: 'pepe@club.es',
      rol: 'MANTENIMIENTO',
    });
    expect(dialogRef.close).toHaveBeenCalledWith(MENSAJE_INVITACION_NEUTRO);
  });

  it('el mensaje neutro es el del backend y es siempre el mismo para correos distintos', async () => {
    await crear();
    await rellenar('registrado@club.es');
    await enviarFormulario();
    const primero = dialogRef.close.mock.calls[0][0];

    dialogRef.close.mockClear();
    fixture.destroy();
    TestBed.resetTestingModule();
    await crear();
    await rellenar('no-existe@nada.es');
    await enviarFormulario();

    expect(dialogRef.close.mock.calls[0][0]).toBe(primero);
    expect(primero).toBe('Si el correo es válido, la persona recibirá la invitación.');
  });

  it('si el backend no manda mensaje usa el texto neutro por defecto', async () => {
    invitaciones.crear.mockReturnValue(of({ mensaje: '  ' }));
    await crear();
    await rellenar('pepe@club.es');

    await enviarFormulario();

    expect(dialogRef.close).toHaveBeenCalledWith(MENSAJE_INVITACION_NEUTRO);
  });

  it('nada en el diálogo revela si el correo está registrado', async () => {
    await crear();
    await rellenar('pepe@club.es');
    await enviarFormulario();

    const texto = el().textContent ?? '';
    expect(texto).not.toMatch(/no existe|ya pertenece|registrad[oa]\b.*(no|sí)/i);
    expect(el().querySelector('.ayuda')?.textContent).not.toMatch(/ya registrad/i);
  });

  it('un 400 se muestra inline con el mensaje del backend y no se cierra', async () => {
    invitaciones.crear.mockReturnValue(throwError(() => http(400, { error: 'Email no válido' })));
    await crear();
    await rellenar('pepe@club.es');

    await enviarFormulario();

    expect(alerta()).toBe('Email no válido');
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(enviar().disabled).toBe(false);
  });

  it('un 429 (límite de invitaciones) se muestra inline con el mensaje del backend', async () => {
    invitaciones.crear.mockReturnValue(
      throwError(() => http(429, { error: 'Has alcanzado el máximo de invitaciones por día' })),
    );
    await crear();
    await rellenar('pepe@club.es');

    await enviarFormulario();

    expect(alerta()).toBe('Has alcanzado el máximo de invitaciones por día');
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('un 429 sin cuerpo usa un texto propio', async () => {
    invitaciones.crear.mockReturnValue(throwError(() => http(429)));
    await crear();
    await rellenar('pepe@club.es');

    await enviarFormulario();

    expect(alerta()).toContain('límite');
  });

  it('mientras se envía no deja enviar dos veces', async () => {
    invitaciones.crear.mockReturnValue(new Subject());
    await crear();
    await rellenar('pepe@club.es');

    await enviarFormulario();
    await enviarFormulario();

    expect(invitaciones.crear).toHaveBeenCalledTimes(1);
    expect(enviar().disabled).toBe(true);
  });

  it('Cancelar cierra sin resultado', async () => {
    await crear();

    el().querySelector<HTMLButtonElement>('button[data-accion="cancelar"]')!.click();

    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});
