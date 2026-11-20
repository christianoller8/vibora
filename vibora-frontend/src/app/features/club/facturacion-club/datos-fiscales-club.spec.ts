import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { ClubService } from '../../../core/api/club.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DatosFiscales } from '../../../shared/models/factura.model';
import { USUARIO_ADMIN, crearAuthFalso, escribir } from '../../../testing/test-utils';
import { DatosFiscalesClub } from './datos-fiscales-club';

const http = (status: number, error?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

const SIN_CONFIGURAR: DatosFiscales = {
  razonSocial: null,
  nif: null,
  direccionFiscal: null,
  tipoIva: 21,
  configurado: false,
};

const CONFIGURADOS: DatosFiscales = {
  razonSocial: 'Club Víbora SL',
  nif: 'B12345674',
  direccionFiscal: 'Calle Mayor 1, Madrid',
  tipoIva: 10,
  configurado: true,
};

describe('DatosFiscalesClub', () => {
  let fixture: ComponentFixture<DatosFiscalesClub>;
  let auth: ReturnType<typeof crearAuthFalso>;
  const clubes = { datosFiscales: vi.fn(), actualizarDatosFiscales: vi.fn() };
  const snack = { open: vi.fn() };

  async function crear(): Promise<void> {
    auth = crearAuthFalso(USUARIO_ADMIN);
    await TestBed.configureTestingModule({
      imports: [DatosFiscalesClub],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ClubService, useValue: clubes },
        { provide: MatSnackBar, useValue: snack },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DatosFiscalesClub);
    fixture.componentRef.setInput('clubId', 5);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const campo = (nombre: string): HTMLInputElement =>
    el().querySelector<HTMLInputElement>(`input[name="${nombre}"]`)!;
  const guardar = (): HTMLButtonElement =>
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const alerta = (): string | undefined =>
    el().querySelector('[role="alert"]')?.textContent?.trim();
  const errores = (): string[] =>
    Array.from(el().querySelectorAll('mat-error')).map((e) => e.textContent!.trim());

  async function rellenar(valores: Record<string, string>): Promise<void> {
    for (const [nombre, valor] of Object.entries(valores)) {
      escribir(campo(nombre), valor);
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function enviar(): Promise<void> {
    guardar().click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const VALIDOS = {
    razonSocial: '  Club Víbora SL ',
    nif: ' B12345674 ',
    direccionFiscal: ' Calle Mayor 1, Madrid ',
    tipoIva: '10',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    clubes.datosFiscales.mockReturnValue(of(SIN_CONFIGURAR));
    clubes.actualizarDatosFiscales.mockReturnValue(of(CONFIGURADOS));
  });

  it('carga los datos fiscales del club', async () => {
    await crear();

    expect(clubes.datosFiscales).toHaveBeenCalledWith(5);
  });

  it('sin configurar: avisa de que no se pueden emitir facturas y deja el IVA en 21', async () => {
    await crear();

    expect(el().textContent).toContain(
      'Aún no has configurado los datos fiscales: sin ellos no se pueden emitir facturas',
    );
    expect(campo('razonSocial').value).toBe('');
    expect(campo('nif').value).toBe('');
    expect(campo('direccionFiscal').value).toBe('');
    expect(campo('tipoIva').value).toBe('21');
  });

  it('configurado: rellena el formulario y no enseña el aviso', async () => {
    clubes.datosFiscales.mockReturnValue(of(CONFIGURADOS));
    await crear();

    expect(el().textContent).not.toContain('Aún no has configurado');
    expect(campo('razonSocial').value).toBe('Club Víbora SL');
    expect(campo('nif').value).toBe('B12345674');
    expect(campo('direccionFiscal').value).toBe('Calle Mayor 1, Madrid');
    expect(campo('tipoIva').value).toBe('10');
  });

  it('mientras carga enseña un spinner y no el formulario', async () => {
    clubes.datosFiscales.mockReturnValue(NEVER);
    await crear();

    expect(el().querySelector('mat-spinner')).not.toBeNull();
    expect(el().querySelector('form')).toBeNull();
  });

  describe('validación en el cliente', () => {
    it('razón social, NIF y dirección son obligatorios: no se envía y se muestran los errores', async () => {
      await crear();

      await enviar();

      expect(clubes.actualizarDatosFiscales).not.toHaveBeenCalled();
      expect(errores()).toEqual([
        'La razón social es obligatoria',
        'El NIF/CIF es obligatorio',
        'La dirección fiscal es obligatoria',
      ]);
    });

    it('un texto de solo espacios cuenta como vacío: mismo error «obligatorio» y no se envía (el backend lo recortaría a "")', async () => {
      await crear();
      await rellenar({ razonSocial: '   ', nif: '  ', direccionFiscal: ' \t ', tipoIva: '10' });

      await enviar();

      expect(clubes.actualizarDatosFiscales).not.toHaveBeenCalled();
      expect(errores()).toEqual([
        'La razón social es obligatoria',
        'El NIF/CIF es obligatorio',
        'La dirección fiscal es obligatoria',
      ]);
    });

    it('con texto real rodeado de espacios sí es válido (se recorta al enviar)', async () => {
      await crear();
      await rellenar(VALIDOS);

      await enviar();

      expect(errores()).toEqual([]);
      expect(clubes.actualizarDatosFiscales).toHaveBeenCalledTimes(1);
    });

    it('un NIF con la letra de control equivocada se rechaza sin llamar al servidor', async () => {
      await crear();
      await rellenar({ ...VALIDOS, nif: '12345678A' });

      await enviar();

      expect(clubes.actualizarDatosFiscales).not.toHaveBeenCalled();
      expect(errores()).toEqual(['El NIF/CIF no es válido']);
    });

    it.each(['12345678Z', 'x1234567l', 'B12345674', 'A28015865', 'K1234567D'])(
      'acepta el identificador válido %s',
      async (nif) => {
        await crear();
        await rellenar({ ...VALIDOS, nif });

        await enviar();

        expect(clubes.actualizarDatosFiscales).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['-1', '100', '99.995', '21.123', ''])(
      'el tipo de IVA %j no es válido',
      async (iva) => {
        await crear();
        await rellenar({ ...VALIDOS, tipoIva: iva });

        await enviar();

        expect(clubes.actualizarDatosFiscales).not.toHaveBeenCalled();
        expect(errores().length).toBe(1);
        expect(errores()[0]).toContain('IVA');
      },
    );

    it.each(['0', '4', '10', '21', '21.5', '99.99'])('el tipo de IVA %s es válido', async (iva) => {
      await crear();
      await rellenar({ ...VALIDOS, tipoIva: iva });

      await enviar();

      expect(clubes.actualizarDatosFiscales).toHaveBeenCalledTimes(1);
      expect(clubes.actualizarDatosFiscales.mock.calls[0][1].tipoIva).toBe(Number(iva));
    });
  });

  describe('guardar', () => {
    it('envía los valores recortados y el IVA como número', async () => {
      await crear();
      await rellenar(VALIDOS);

      await enviar();

      expect(clubes.actualizarDatosFiscales).toHaveBeenCalledWith(5, {
        razonSocial: 'Club Víbora SL',
        nif: 'B12345674',
        direccionFiscal: 'Calle Mayor 1, Madrid',
        tipoIva: 10,
      });
    });

    it('avisa con un snackbar y quita el aviso de "sin configurar"', async () => {
      await crear();
      await rellenar(VALIDOS);

      await enviar();

      expect(snack.open).toHaveBeenCalledWith('Datos fiscales guardados.', 'Cerrar', {
        duration: 5000,
      });
      expect(el().textContent).not.toContain('Aún no has configurado');
    });

    it('un 400 se muestra inline con el mensaje del backend, sin snackbar de éxito', async () => {
      clubes.actualizarDatosFiscales.mockReturnValue(
        throwError(() => http(400, { error: 'El NIF/CIF no es válido' })),
      );
      await crear();
      await rellenar(VALIDOS);

      await enviar();

      expect(alerta()).toBe('El NIF/CIF no es válido');
      expect(snack.open).not.toHaveBeenCalled();
      expect(guardar().disabled).toBe(false);
    });

    it('un error sin cuerpo usa un texto propio', async () => {
      clubes.actualizarDatosFiscales.mockReturnValue(throwError(() => http(500)));
      await crear();
      await rellenar(VALIDOS);

      await enviar();

      expect(alerta()).toContain('No se pudieron guardar');
    });

    it('el error se borra al volver a guardar con éxito', async () => {
      clubes.actualizarDatosFiscales.mockReturnValueOnce(
        throwError(() => http(400, { error: 'Datos no válidos' })),
      );
      await crear();
      await rellenar(VALIDOS);
      await enviar();
      expect(alerta()).toBe('Datos no válidos');

      await enviar();

      expect(alerta()).toBeUndefined();
    });

    it('mientras se guarda no deja guardar dos veces', async () => {
      clubes.actualizarDatosFiscales.mockReturnValue(new Subject());
      await crear();
      await rellenar(VALIDOS);

      await enviar();
      await enviar();

      expect(clubes.actualizarDatosFiscales).toHaveBeenCalledTimes(1);
      expect(guardar().disabled).toBe(true);
    });
  });

  describe('error al cargar', () => {
    it('muestra el error y Reintentar vuelve a pedir los datos', async () => {
      clubes.datosFiscales.mockReturnValueOnce(throwError(() => http(500)));
      await crear();

      expect(alerta()).toContain('No se pudieron cargar los datos fiscales');
      expect(el().querySelector('form')).toBeNull();

      el().querySelector<HTMLButtonElement>('button[data-accion="reintentar"]')!.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(clubes.datosFiscales).toHaveBeenCalledTimes(2);
      expect(el().querySelector('form')).not.toBeNull();
      expect(alerta()).toBeUndefined();
    });

    it('recarga sola cuando la sesión deja de ser incierta si estaba en error', async () => {
      clubes.datosFiscales.mockReturnValueOnce(throwError(() => http(0)));
      await crear();
      auth.sesionIncierta.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      auth.sesionIncierta.set(false);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(clubes.datosFiscales).toHaveBeenCalledTimes(2);
    });
  });

  it('los campos tienen etiqueta y el formulario es operable con teclado (submit nativo)', async () => {
    await crear();

    const etiquetas = Array.from(el().querySelectorAll('mat-label')).map((l) =>
      l.textContent!.trim(),
    );
    expect(etiquetas).toEqual([
      'Razón social',
      'NIF / CIF / NIE',
      'Dirección fiscal',
      'Tipo de IVA (%)',
    ]);
    expect(guardar().type).toBe('submit');
  });
});
