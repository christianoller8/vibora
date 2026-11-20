import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { FacturaService } from '../../../core/api/factura.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Factura } from '../../../shared/models/factura.model';
import { crearAuthFalso, simularObjectUrls } from '../../../testing/test-utils';
import { MisFacturas } from './mis-facturas';

const http = (status: number, error?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

function factura(id: number, cambios: Partial<Factura> = {}): Factura {
  return {
    id,
    serie: 'F2026',
    numero: id,
    numeroCompleto: `F2026-${String(id).padStart(4, '0')}`,
    tipo: 'ORIGINAL',
    rectificaA: null,
    reservaId: 100 + id,
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

const RECTIFICATIVA = factura(2, {
  tipo: 'RECTIFICATIVA',
  rectificaA: 1,
  emitidaEn: '2026-07-16T08:00:00Z',
  base: -24.79,
  cuotaIva: -5.21,
  total: -30,
});

function pagina(n: number, desde = 1): Factura[] {
  return Array.from({ length: n }, (_, i) => factura(desde + i));
}

describe('MisFacturas', () => {
  let fixture: ComponentFixture<MisFacturas>;
  let auth: ReturnType<typeof crearAuthFalso>;
  const facturas = { mias: vi.fn(), pdf: vi.fn() };
  const snack = { open: vi.fn() };
  let urls: ReturnType<typeof simularObjectUrls>;
  let descargas: string[];

  async function crear(): Promise<void> {
    auth = crearAuthFalso();
    await TestBed.configureTestingModule({
      imports: [MisFacturas],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: FacturaService, useValue: facturas },
        { provide: MatSnackBar, useValue: snack },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MisFacturas);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const filas = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('li.factura'));
  const texto = (e: Element | null | undefined): string =>
    (e?.textContent ?? '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
  const boton = (accion: string): HTMLButtonElement | null =>
    el().querySelector<HTMLButtonElement>(`button[data-accion="${accion}"]`);
  const descargar = (fila: HTMLElement): HTMLButtonElement =>
    fila.querySelector<HTMLButtonElement>('button[data-accion="descargar"]')!;
  const alerta = (): string | undefined =>
    el().querySelector('[role="alert"]')?.textContent?.trim();

  async function estable(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
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
    facturas.mias.mockReturnValue(of([factura(1), RECTIFICATIVA]));
    facturas.pdf.mockReturnValue(of(new Blob(['%PDF-1.4'], { type: 'application/pdf' })));
  });

  afterEach(() => {
    urls.restaurar();
    vi.restoreAllMocks();
  });

  it('tiene un título "Mis facturas" y pide la primera página (20)', async () => {
    await crear();

    expect(el().querySelector('h1')?.textContent).toContain('Mis facturas');
    expect(facturas.mias).toHaveBeenCalledTimes(1);
    expect(facturas.mias).toHaveBeenCalledWith(0, 20);
  });

  it('mientras carga enseña un spinner', async () => {
    facturas.mias.mockReturnValue(NEVER);
    await crear();

    expect(el().querySelector('mat-spinner')).not.toBeNull();
    expect(filas()).toHaveLength(0);
  });

  describe('listado', () => {
    it('una tarjeta por factura, en el orden del backend (las más recientes primero)', async () => {
      await crear();

      expect(filas()).toHaveLength(2);
      expect(texto(filas()[0].querySelector('.numero'))).toBe('F2026-0001');
      expect(texto(filas()[1].querySelector('.numero'))).toBe('F2026-0002');
    });

    it('enseña fecha en Madrid, club, concepto y total', async () => {
      await crear();

      const f = filas()[0];
      expect(texto(f.querySelector('.fecha'))).toBe('15 de julio de 2026, 18:30');
      expect(texto(f.querySelector('.club'))).toBe('Club Víbora SL');
      expect(texto(f.querySelector('.concepto'))).toBe('Alquiler de pista: Pista 1');
      expect(texto(f.querySelector('.total'))).toBe('30,00 €');
    });

    it('la rectificativa lleva su chip, está marcada y su total es negativo', async () => {
      await crear();

      const [original, rectificativa] = filas();
      expect(texto(original.querySelector('.tipo'))).toBe('Factura');
      expect(texto(rectificativa.querySelector('.tipo'))).toBe('Rectificativa');
      expect(original.classList.contains('rectificativa')).toBe(false);
      expect(rectificativa.classList.contains('rectificativa')).toBe(true);
      expect(texto(rectificativa.querySelector('.total'))).toBe('-30,00 €');
    });

    it('sin facturas explica dónde se piden', async () => {
      facturas.mias.mockReturnValue(of([]));
      await crear();

      expect(texto(el())).toContain(
        'Todavía no tienes facturas. Puedes pedirlas desde Mis reservas.',
      );
      expect(filas()).toHaveLength(0);
      expect(boton('siguiente')).toBeNull();
    });
  });

  describe('paginación (el backend no devuelve el total: hay más si la página viene llena)', () => {
    it('con menos de 20 resultados no hay página siguiente y Anterior está desactivado', async () => {
      facturas.mias.mockReturnValue(of(pagina(5)));
      await crear();

      expect(el().querySelector('[data-testid="paginacion"]')).toBeNull();
    });

    it('con 20 resultados Siguiente pide la página 1', async () => {
      facturas.mias.mockReturnValueOnce(of(pagina(20))).mockReturnValueOnce(of(pagina(3, 21)));
      await crear();
      expect(boton('anterior')!.disabled).toBe(true);
      expect(boton('siguiente')!.disabled).toBe(false);
      expect(texto(el().querySelector('[data-testid="paginacion"]'))).toContain('Página 1');

      boton('siguiente')!.click();
      await estable();

      expect(facturas.mias).toHaveBeenLastCalledWith(1, 20);
      expect(filas()).toHaveLength(3);
      expect(texto(el().querySelector('[data-testid="paginacion"]'))).toContain('Página 2');
      expect(boton('siguiente')!.disabled).toBe(true);
      expect(boton('anterior')!.disabled).toBe(false);
    });

    it('Anterior vuelve a la página anterior', async () => {
      facturas.mias.mockReturnValue(of(pagina(20)));
      await crear();
      boton('siguiente')!.click();
      await estable();

      boton('anterior')!.click();
      await estable();

      expect(facturas.mias).toHaveBeenLastCalledWith(0, 20);
    });

    it('una página vacía tras la última lo dice y deja volver atrás', async () => {
      facturas.mias.mockReturnValueOnce(of(pagina(20))).mockReturnValueOnce(of([]));
      await crear();

      boton('siguiente')!.click();
      await estable();

      expect(texto(el())).toContain('No hay más facturas.');
      expect(boton('anterior')!.disabled).toBe(false);
      expect(boton('siguiente')!.disabled).toBe(true);
    });

    it('la paginación es una navegación con nombre accesible', async () => {
      facturas.mias.mockReturnValue(of(pagina(20)));
      await crear();

      expect(el().querySelector('[data-testid="paginacion"]')?.getAttribute('aria-label')).toBe(
        'Paginación de mis facturas',
      );
    });
  });

  describe('descargar PDF', () => {
    it('cada factura tiene su botón y descarga el PDF de esa factura con su nombre', async () => {
      await crear();

      expect(descargar(filas()[1]).getAttribute('aria-label')).toBe(
        'Descargar el PDF de la factura F2026-0002',
      );
      descargar(filas()[1]).click();
      await estable();

      expect(facturas.pdf).toHaveBeenCalledWith(2);
      expect(descargas).toEqual(['F2026-0002.pdf']);
    });

    it('si falla avisa con un snackbar y no descarga', async () => {
      facturas.pdf.mockReturnValue(throwError(() => http(500)));
      await crear();

      descargar(filas()[0]).click();
      await estable();

      expect(snack.open).toHaveBeenCalledWith(
        'No se pudo descargar la factura. Inténtalo de nuevo.',
        'Cerrar',
        { duration: 6000 },
      );
      expect(descargas).toEqual([]);
    });

    it('un 404 (la factura ya no es visible) enseña el mensaje del backend', async () => {
      facturas.pdf.mockReturnValue(throwError(() => http(404, { error: 'Factura no encontrada' })));
      await crear();

      descargar(filas()[0]).click();
      await estable();

      expect(snack.open.mock.calls[0][0]).toBe('Factura no encontrada');
    });

    it('mientras se descarga una no deja pedir otra', async () => {
      facturas.pdf.mockReturnValue(new Subject());
      await crear();

      descargar(filas()[0]).click();
      await estable();
      descargar(filas()[1]).click();
      await estable();

      expect(facturas.pdf).toHaveBeenCalledTimes(1);
      expect(descargar(filas()[0]).disabled).toBe(true);
      expect(descargar(filas()[1]).disabled).toBe(true);
    });
  });

  describe('error', () => {
    it('muestra el mensaje y Reintentar repite la consulta de la página actual', async () => {
      facturas.mias.mockReturnValueOnce(throwError(() => http(500)));
      await crear();

      expect(alerta()).toContain('No se pudieron cargar tus facturas');
      expect(filas()).toHaveLength(0);

      boton('reintentar')!.click();
      await estable();

      expect(facturas.mias).toHaveBeenCalledTimes(2);
      expect(facturas.mias).toHaveBeenLastCalledWith(0, 20);
      expect(filas()).toHaveLength(2);
      expect(alerta()).toBeUndefined();
    });

    it('recarga sola cuando la sesión deja de ser incierta si estaba en error', async () => {
      facturas.mias.mockReturnValueOnce(throwError(() => http(0)));
      await crear();
      auth.sesionIncierta.set(true);
      await estable();

      auth.sesionIncierta.set(false);
      await estable();

      expect(facturas.mias).toHaveBeenCalledTimes(2);
    });

    it('si la sesión se recupera sin error, no recarga', async () => {
      await crear();
      auth.sesionIncierta.set(true);
      await estable();

      auth.sesionIncierta.set(false);
      await estable();

      expect(facturas.mias).toHaveBeenCalledTimes(1);
    });
  });
});
