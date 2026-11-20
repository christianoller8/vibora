import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { FacturaService } from '../../../core/api/factura.service';
import { Factura } from '../../../shared/models/factura.model';
import { Reserva } from '../../../shared/models/reserva.model';
import { escribir, simularObjectUrls } from '../../../testing/test-utils';
import { FacturaReservaDialog, FacturaReservaDialogData } from './factura-reserva-dialog';

const http = (status: number, error?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

function reserva(cambios: Partial<Reserva> = {}): Reserva {
  return {
    id: 7,
    pistaId: 10,
    pistaNombre: 'Pista 1',
    clubId: 1,
    clubNombre: 'Club Víbora',
    inicio: '2026-07-20T16:00:00Z',
    fin: '2026-07-20T17:30:00Z',
    estado: 'CONFIRMADA',
    precioTotal: 30,
    abierta: false,
    jugadores: 1,
    cuotaPorJugador: 7.5,
    ...cambios,
  };
}

function factura(cambios: Partial<Factura> = {}): Factura {
  return {
    id: 3,
    serie: 'F2026',
    numero: 1,
    numeroCompleto: 'F2026-0001',
    tipo: 'ORIGINAL',
    rectificaA: null,
    reservaId: 7,
    emitidaEn: '2026-07-15T16:30:00Z',
    emisor: { razonSocial: 'Club Víbora SL', nif: 'B12345674', direccion: 'Calle Mayor 1' },
    receptor: { nombre: 'Ana García', nif: null, direccion: null },
    concepto: 'Alquiler de pista: Pista 1',
    base: 24.79,
    tipoIva: 21,
    cuotaIva: 5.21,
    total: 30,
    ...cambios,
  };
}

const ORIGINAL = factura();
const RECTIFICATIVA = factura({
  id: 4,
  numero: 2,
  numeroCompleto: 'F2026-0002',
  tipo: 'RECTIFICATIVA',
  rectificaA: 3,
  base: -24.79,
  cuotaIva: -5.21,
  total: -30,
});

describe('FacturaReservaDialog', () => {
  let fixture: ComponentFixture<FacturaReservaDialog>;
  const facturas = { deReserva: vi.fn(), emitir: vi.fn(), pdf: vi.fn() };
  const dialogRef = { close: vi.fn() };
  const snack = { open: vi.fn() };
  let urls: ReturnType<typeof simularObjectUrls>;
  let descargas: string[];

  async function crear(r: Reserva = reserva()): Promise<void> {
    const datos: FacturaReservaDialogData = { reserva: r };
    await TestBed.configureTestingModule({
      imports: [FacturaReservaDialog],
      providers: [
        { provide: FacturaService, useValue: facturas },
        { provide: MAT_DIALOG_DATA, useValue: datos },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatSnackBar, useValue: snack },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FacturaReservaDialog);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const texto = (e: Element | null | undefined): string =>
    (e?.textContent ?? '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
  const campo = (nombre: string): HTMLInputElement =>
    el().querySelector<HTMLInputElement>(`input[name="${nombre}"]`)!;
  const pedir = (): HTMLButtonElement | null =>
    el().querySelector<HTMLButtonElement>('button[type="submit"]');
  const alerta = (): string | undefined =>
    el().querySelector('[role="alert"]')?.textContent?.trim();
  const botonesDescarga = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('button[data-accion="descargar"]'));

  async function estable(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function rellenar(valores: Record<string, string>): Promise<void> {
    for (const [nombre, valor] of Object.entries(valores)) {
      escribir(campo(nombre), valor);
    }
    await estable();
  }

  async function enviar(): Promise<void> {
    pedir()!.click();
    await estable();
  }

  beforeEach(() => {
    vi.resetAllMocks();
    urls = simularObjectUrls();
    descargas = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      descargas.push(this.download);
    });
    facturas.deReserva.mockReturnValue(of([]));
    facturas.emitir.mockReturnValue(of({ factura: ORIGINAL, creada: true }));
    facturas.pdf.mockReturnValue(of(new Blob(['%PDF-1.4'], { type: 'application/pdf' })));
  });

  afterEach(() => {
    urls.restaurar();
    vi.restoreAllMocks();
  });

  describe('al abrirse', () => {
    it('pide las facturas de ESA reserva, una sola vez (carga perezosa, sin N+1)', async () => {
      await crear();

      expect(facturas.deReserva).toHaveBeenCalledTimes(1);
      expect(facturas.deReserva).toHaveBeenCalledWith(7);
    });

    it('mientras carga enseña un spinner', async () => {
      facturas.deReserva.mockReturnValue(NEVER);
      await crear();

      expect(el().querySelector('mat-spinner')).not.toBeNull();
      expect(el().querySelector('form')).toBeNull();
    });

    it('un error de carga se muestra con Reintentar, que vuelve a pedir', async () => {
      facturas.deReserva.mockReturnValueOnce(throwError(() => http(500)));
      await crear();
      expect(alerta()).toContain('No se pudieron cargar las facturas');

      el().querySelector<HTMLButtonElement>('button[data-accion="reintentar"]')!.click();
      await estable();

      expect(facturas.deReserva).toHaveBeenCalledTimes(2);
      expect(alerta()).toBeUndefined();
      expect(el().querySelector('form')).not.toBeNull();
    });

    it('Cerrar cierra el diálogo', async () => {
      await crear();

      el().querySelector<HTMLButtonElement>('button[data-accion="cerrar"]')!.click();

      expect(dialogRef.close).toHaveBeenCalled();
    });

    it('lleva un título y resume la reserva', async () => {
      await crear();

      expect(el().querySelector('h2')?.textContent).toContain('Factura');
      expect(texto(el())).toContain('Club Víbora · Pista 1');
    });
  });

  describe('reserva confirmada sin factura: pedirla', () => {
    it('enseña el formulario del receptor (todo opcional) y "Pedir factura"', async () => {
      await crear();

      expect(campo('nombre')).not.toBeNull();
      expect(campo('nif')).not.toBeNull();
      expect(campo('direccion')).not.toBeNull();
      expect(pedir()!.textContent).toContain('Pedir factura');
      expect(pedir()!.disabled).toBe(false);
      expect(botonesDescarga()).toHaveLength(0);
    });

    it('sin datos del receptor se pide la factura sin receptor (se usa el nombre del organizador)', async () => {
      await crear();

      await enviar();

      expect(facturas.emitir).toHaveBeenCalledTimes(1);
      expect(facturas.emitir).toHaveBeenCalledWith(7, undefined);
    });

    it('con datos del receptor los manda recortados', async () => {
      await crear();
      await rellenar({ nombre: '  Ana SL ', nif: ' 12345678Z ', direccion: ' Calle 1 ' });

      await enviar();

      expect(facturas.emitir).toHaveBeenCalledWith(7, {
        nombre: 'Ana SL',
        nif: '12345678Z',
        direccion: 'Calle 1',
      });
    });

    it('con solo el nombre manda el resto vacío', async () => {
      await crear();
      await rellenar({ nombre: 'Ana SL' });

      await enviar();

      expect(facturas.emitir).toHaveBeenCalledWith(7, { nombre: 'Ana SL', nif: '', direccion: '' });
    });

    it('un NIF escrito pero inválido se rechaza sin llamar al servidor', async () => {
      await crear();
      await rellenar({ nif: '12345678A' });

      await enviar();

      expect(facturas.emitir).not.toHaveBeenCalled();
      expect(texto(el().querySelector('mat-error'))).toBe('El NIF/CIF no es válido');
    });

    it.each(['12345678Z', 'B12345674', 'X1234567L'])('acepta el NIF válido %s', async (nif) => {
      await crear();
      await rellenar({ nif });

      await enviar();

      expect(facturas.emitir).toHaveBeenCalledTimes(1);
    });

    it('límites de longitud: nombre 200, NIF 30, dirección 300', async () => {
      await crear();

      expect(campo('nombre').maxLength).toBe(200);
      expect(campo('nif').maxLength).toBe(30);
      expect(campo('direccion').maxLength).toBe(300);
    });

    it('al emitir (201) avisa, enseña la factura y ofrece descargarla', async () => {
      await crear();

      await enviar();

      expect(snack.open).toHaveBeenCalledWith('Factura F2026-0001 emitida.', 'Cerrar', {
        duration: 6000,
      });
      expect(el().querySelector('form')).toBeNull();
      expect(texto(el())).toContain('F2026-0001');
      expect(botonesDescarga()).toHaveLength(1);
      expect(botonesDescarga()[0].textContent).toContain('Descargar factura');
    });

    it('si ya estaba emitida (200) lo dice y enseña la misma factura', async () => {
      facturas.emitir.mockReturnValue(of({ factura: ORIGINAL, creada: false }));
      await crear();

      await enviar();

      expect(snack.open).toHaveBeenCalledWith(
        'Esta reserva ya tenía la factura F2026-0001.',
        'Cerrar',
        { duration: 6000 },
      );
      expect(botonesDescarga()).toHaveLength(1);
    });

    it('mientras se emite no deja pedir dos veces', async () => {
      facturas.emitir.mockReturnValue(new Subject());
      await crear();

      await enviar();
      await enviar();

      expect(facturas.emitir).toHaveBeenCalledTimes(1);
      expect(pedir()!.disabled).toBe(true);
    });
  });

  describe('errores al emitir (inline, el formulario se queda)', () => {
    it('409 por datos fiscales del club sin configurar: "El club todavía no puede emitir facturas"', async () => {
      facturas.emitir.mockReturnValue(
        throwError(() => http(409, { error: 'El club no ha configurado sus datos fiscales' })),
      );
      await crear();

      await enviar();

      expect(alerta()).toContain('El club todavía no puede emitir facturas');
      expect(el().querySelector('form')).not.toBeNull();
      expect(snack.open).not.toHaveBeenCalled();
      expect(pedir()!.disabled).toBe(false);
    });

    it('409 por reserva no confirmada: usa el mensaje del backend', async () => {
      facturas.emitir.mockReturnValue(
        throwError(() => http(409, { error: 'Solo se pueden facturar reservas confirmadas' })),
      );
      await crear();

      await enviar();

      expect(alerta()).toBe('Solo se pueden facturar reservas confirmadas');
    });

    it('409 sin mensaje: texto propio', async () => {
      facturas.emitir.mockReturnValue(throwError(() => http(409)));
      await crear();

      await enviar();

      expect(alerta()).toContain('No se puede emitir la factura');
    });

    it('400 (nombre no válido, NIF...): el mensaje del backend', async () => {
      facturas.emitir.mockReturnValue(
        throwError(() => http(400, { error: 'El nombre del receptor no es válido' })),
      );
      await crear();

      await enviar();

      expect(alerta()).toBe('El nombre del receptor no es válido');
      expect(el().querySelector('form')).not.toBeNull();
    });

    it('otro error: texto propio, y se puede reintentar', async () => {
      facturas.emitir.mockReturnValueOnce(throwError(() => http(500)));
      await crear();
      await enviar();
      expect(alerta()).toContain('No se pudo emitir la factura');

      await enviar();

      expect(alerta()).toBeUndefined();
      expect(facturas.emitir).toHaveBeenCalledTimes(2);
    });
  });

  describe('reserva con facturas: descargarlas', () => {
    it('lista la original con su total y un botón "Descargar factura"; no ofrece pedirla otra vez', async () => {
      facturas.deReserva.mockReturnValue(of([ORIGINAL]));
      await crear();

      expect(el().querySelector('form')).toBeNull();
      expect(pedir()).toBeNull();
      expect(texto(el())).toContain('F2026-0001');
      expect(texto(el())).toContain('30,00 €');
      expect(botonesDescarga()).toHaveLength(1);
      expect(botonesDescarga()[0].textContent).toContain('Descargar factura');
      expect(botonesDescarga()[0].getAttribute('aria-label')).toBe(
        'Descargar la factura F2026-0001',
      );
    });

    it('con rectificativa ofrece también "Descargar rectificativa" con su total negativo', async () => {
      facturas.deReserva.mockReturnValue(of([ORIGINAL, RECTIFICATIVA]));
      await crear(reserva({ estado: 'CANCELADA' }));

      const botones = botonesDescarga();
      expect(botones.map((b) => texto(b))).toEqual([
        'Descargar factura',
        'Descargar rectificativa',
      ]);
      expect(botones[1].getAttribute('aria-label')).toBe('Descargar la rectificativa F2026-0002');
      expect(texto(el())).toContain('-30,00 €');
    });

    it('descargar la original pide el PDF de esa factura y lo guarda con su nombre', async () => {
      facturas.deReserva.mockReturnValue(of([ORIGINAL, RECTIFICATIVA]));
      await crear(reserva({ estado: 'CANCELADA' }));

      botonesDescarga()[0].click();
      await estable();

      expect(facturas.pdf).toHaveBeenCalledWith(3);
      expect(descargas).toEqual(['F2026-0001.pdf']);
    });

    it('descargar la rectificativa pide el PDF de la rectificativa', async () => {
      facturas.deReserva.mockReturnValue(of([ORIGINAL, RECTIFICATIVA]));
      await crear(reserva({ estado: 'CANCELADA' }));

      botonesDescarga()[1].click();
      await estable();

      expect(facturas.pdf).toHaveBeenCalledWith(4);
      expect(descargas).toEqual(['F2026-0002.pdf']);
    });

    it('si el PDF falla avisa con un snackbar y no descarga', async () => {
      facturas.deReserva.mockReturnValue(of([ORIGINAL]));
      facturas.pdf.mockReturnValue(throwError(() => http(500)));
      await crear();

      botonesDescarga()[0].click();
      await estable();

      expect(snack.open).toHaveBeenCalledWith(
        'No se pudo descargar la factura. Inténtalo de nuevo.',
        'Cerrar',
        { duration: 6000 },
      );
      expect(descargas).toEqual([]);
    });

    it('tras emitir se descarga igual que si ya existiera', async () => {
      await crear();
      await enviar();

      botonesDescarga()[0].click();
      await estable();

      expect(facturas.pdf).toHaveBeenCalledWith(3);
      expect(descargas).toEqual(['F2026-0001.pdf']);
    });

    it('mientras se descarga no deja pedir otra descarga', async () => {
      facturas.deReserva.mockReturnValue(of([ORIGINAL, RECTIFICATIVA]));
      facturas.pdf.mockReturnValue(new Subject());
      await crear(reserva({ estado: 'CANCELADA' }));

      botonesDescarga()[0].click();
      await estable();
      botonesDescarga()[1].click();
      await estable();

      expect(facturas.pdf).toHaveBeenCalledTimes(1);
      expect(botonesDescarga().every((b) => b.disabled)).toBe(true);
    });
  });

  describe('reserva cancelada sin facturas', () => {
    it('dice que no tiene facturas y NO ofrece pedirla (solo se factura lo confirmado)', async () => {
      await crear(reserva({ estado: 'CANCELADA' }));

      expect(texto(el())).toContain('Esta reserva no tiene facturas.');
      expect(el().querySelector('form')).toBeNull();
      expect(pedir()).toBeNull();
    });
  });
});
