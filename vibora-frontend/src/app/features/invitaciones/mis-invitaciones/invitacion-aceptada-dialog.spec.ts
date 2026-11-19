import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  InvitacionAceptadaDialog,
  InvitacionAceptadaDialogData,
} from './invitacion-aceptada-dialog';

describe('InvitacionAceptadaDialog', () => {
  let fixture: ComponentFixture<InvitacionAceptadaDialog>;
  const dialogRef = { close: vi.fn() };
  const DATOS: InvitacionAceptadaDialogData = { clubNombre: 'Club Norte', rol: 'Monitor' };

  beforeEach(async () => {
    vi.resetAllMocks();
    await TestBed.configureTestingModule({
      imports: [InvitacionAceptadaDialog],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: DATOS },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvitacionAceptadaDialog);
    await fixture.whenStable();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  it('dice el club y el rol y que hay que iniciar sesión de nuevo', () => {
    const texto = el().textContent ?? '';
    expect(texto).toContain('Club Norte');
    expect(texto).toContain('Monitor');
    expect(texto).toContain('iniciar sesión de nuevo');
  });

  it('el botón cierra el aviso', () => {
    el().querySelector<HTMLButtonElement>('button[data-accion="entendido"]')!.click();

    expect(dialogRef.close).toHaveBeenCalledTimes(1);
  });
});
