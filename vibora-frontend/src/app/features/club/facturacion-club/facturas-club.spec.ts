import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NEVER, Subject, of, throwError } from 'rxjs';
import { FacturaService } from '../../../core/api/factura.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Factura, ListadoFacturasClub } from '../../../shared/models/factura.model';
import {
  USUARIO_ADMIN,
  crearAuthFalso,
  escribir,
  simularObjectUrls,
} from '../../../testing/test-utils';
import { FacturasClub } from './facturas-club';

const http = (status: number, error?: unknown): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

function factura(cambios: Partial<Factura> = {}): Factura {
  return {
    id: 1,
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
  id: 2,
  numero: 2,
  numeroCompleto: 'F2026-0002',
  tipo: 'RECTIFICATIVA',
  rectificaA: 1,
  emitidaEn: '2026-07-16T08:00:00Z',
  base: -24.79,
  cuotaIva: -5.21,
  total: -30,
});

function listado(
  facturas: Factura[],
  cantidad = facturas.length,
  cambios: Partial<ListadoFacturasClub> = {},
): ListadoFacturasClub {
  return {
    facturas,
    totales: { cantidad, base: 1234.5, cuotaIva: 259.25, total: 1493.75 },
    page: 0,
    limit: 20,
    ...cambios,
  };
}

describe('FacturasClub', () => {
  let fixture: ComponentFixture<FacturasClub>;
  let auth: ReturnType<typeof crearAuthFalso>;
  const facturas = { delClub: vi.fn(), pdf: vi.fn() };
  const snack = { open: vi.fn() };
  let urls: ReturnType<typeof simularObjectUrls>;
  let descargas: string[];

  async function crear(): Promise<void> {
    auth = crearAuthFalso(USUARIO_ADMIN);
    await TestBed.configureTestingModule({
      imports: [FacturasClub],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: FacturaService, useValue: facturas },
        { provide: MatSnackBar, useValue: snack },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FacturasClub);
    fixture.componentRef.setInput('clubId', 5);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const filas = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('tr.factura'));
  const texto = (e: Element | null | undefined): string =>
    (e?.textContent ?? '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
  const desde = (): HTMLInputElement =>
    el().querySelector<HTMLInputElement>('input[name="desde"]')!;
  const hasta = (): HTMLInputElement =>
    el().querySelector<HTMLInputElement>('input[name="hasta"]')!;
  const tipo = (): HTMLSelectElement =>
    el().querySelector<HTMLSelectElement>('select[name="tipo"]')!;
  const boton = (accion: string): HTMLButtonElement =>
    el().querySelector<HTMLButtonElement>(`button[data-accion="${accion}"]`)!;
  const alerta = (): string | undefined =>
    el().querySelector('[role="alert"]')?.textContent?.trim();

  async function estable(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function cambiar(
    campo: HTMLInputElement | HTMLSelectElement,
    valor: string,
  ): Promise<void> {
    escribir(campo, valor);
    await estable();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'));
    vi.resetAllMocks();
    urls = simularObjectUrls();
    descargas = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      descargas.push(this.download);
    });
    facturas.delClub.mockReturnValue(of(listado([ORIGINAL, RECTIFICATIVA])));
    facturas.pdf.mockReturnValue(of(new Blob(['%PDF-1.4'], { type: 'application/pdf' })));
  });

  afterEach(() => {
    urls.restaurar();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('carga inicial', () => {
    it('pide el mes en curso (Madrid), todos los tipos, página 0 y 20 por página', async () => {
      await crear();

      expect(facturas.delClub).toHaveBeenCalledTimes(1);
      expect(facturas.delClub).toHaveBeenCalledWith(5, {
        desde: '2026-07-01',
        hasta: '2026-07-31',
        tipo: undefined,
        page: 0,
        limit: 20,
      });
      expect(desde().value).toBe('2026-07-01');
      expect(hasta().value).toBe('2026-07-31');
      expect(tipo().value).toBe('');
    });

    it('el mes en curso se calcula en Madrid, no en UTC (1 de agosto 00:30 en Madrid)', async () => {
      vi.setSystemTime(new Date('2026-07-31T22:30:00Z'));

      await crear();

      expect(facturas.delClub.mock.calls[0][1]).toMatchObject({
        desde: '2026-08-01',
        hasta: '2026-08-31',
      });
    });

    it('el mes por defecto es el de cuando se pide la primera vez, no el de cuando se construyó el componente', async () => {
      await TestBed.configureTestingModule({
        imports: [FacturasClub],
        providers: [
          { provide: AuthService, useValue: crearAuthFalso(USUARIO_ADMIN) },
          { provide: FacturaService, useValue: facturas },
          { provide: MatSnackBar, useValue: snack },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(FacturasClub); // 15 de julio
      vi.setSystemTime(new Date('2026-07-31T23:30:00Z')); // pasa la medianoche de Madrid: ya es 1 de agosto
      fixture.componentRef.setInput('clubId', 5);
      await fixture.whenStable();

      expect(facturas.delClub.mock.calls[0][1]).toMatchObject({
        desde: '2026-08-01',
        hasta: '2026-08-31',
      });
      expect(desde().value).toBe('2026-08-01');
      expect(hasta().value).toBe('2026-08-31');
    });

    it('mientras carga enseña un spinner', async () => {
      facturas.delClub.mockReturnValue(NEVER);
      await crear();

      expect(el().querySelector('mat-spinner')).not.toBeNull();
      expect(filas()).toHaveLength(0);
    });

    it('el selector de tipo ofrece Todas, Originales y Rectificativas', async () => {
      await crear();

      expect(Array.from(tipo().options).map((o) => [o.value, o.textContent!.trim()])).toEqual([
        ['', 'Todas'],
        ['ORIGINAL', 'Originales'],
        ['RECTIFICATIVA', 'Rectificativas'],
      ]);
    });
  });

  describe('listado', () => {
    it('una fila por factura con número, fecha de emisión en Madrid, receptor, concepto e importes', async () => {
      await crear();

      expect(filas()).toHaveLength(2);
      const celda = (fila: HTMLElement, etiqueta: string): string =>
        texto(fila.querySelector(`td[data-label="${etiqueta}"]`));
      const f = filas()[0];
      expect(celda(f, 'Número')).toContain('F2026-0001');
      expect(celda(f, 'Emitida')).toBe('15 de julio de 2026, 18:30');
      expect(celda(f, 'Receptor')).toBe('Ana García');
      expect(celda(f, 'Concepto')).toBe('Alquiler de pista: Pista 1');
      expect(celda(f, 'Base')).toBe('24,79 €');
      expect(celda(f, 'IVA')).toBe('21 %');
      expect(celda(f, 'Cuota')).toBe('5,21 €');
      expect(celda(f, 'Total')).toBe('30,00 €');
    });

    it('un tipo de IVA con decimales se muestra con coma', async () => {
      facturas.delClub.mockReturnValue(of(listado([factura({ tipoIva: 10.5 })])));
      await crear();

      expect(texto(filas()[0].querySelector('td[data-label="IVA"]'))).toBe('10,5 %');
    });

    it('la rectificativa se marca, lleva importes negativos y nombra a la original', async () => {
      await crear();

      const [original, rectificativa] = filas();
      expect(original.classList.contains('rectificativa')).toBe(false);
      expect(rectificativa.classList.contains('rectificativa')).toBe(true);
      expect(texto(rectificativa.querySelector('td[data-label="Número"]'))).toContain(
        'Rectificativa',
      );
      expect(texto(rectificativa.querySelector('td[data-label="Número"]'))).toContain(
        'Rectifica a F2026-0001',
      );
      expect(texto(rectificativa.querySelector('td[data-label="Total"]'))).toBe('-30,00 €');
      expect(texto(rectificativa.querySelector('td[data-label="Base"]'))).toBe('-24,79 €');
      expect(texto(original.querySelector('td[data-label="Número"]'))).not.toContain(
        'Rectificativa',
      );
    });

    it('el número de la original es un enlace que lleva a su fila', async () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      await crear();

      const enlace = filas()[1].querySelector<HTMLButtonElement>(
        'button[data-accion="ir-original"]',
      )!;
      expect(enlace.textContent).toContain('F2026-0001');
      enlace.click();

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(el().querySelector('#factura-1'));
    });

    it('si la original no está en la página se dice sin enlace', async () => {
      facturas.delClub.mockReturnValue(of(listado([RECTIFICATIVA])));
      await crear();

      const celda = filas()[0].querySelector('td[data-label="Número"]')!;
      expect(texto(celda)).toContain('Rectifica a otra factura');
      expect(celda.querySelector('button[data-accion="ir-original"]')).toBeNull();
    });

    it('cada celda lleva su cabecera (data-label) para el diseño apilado en móvil', async () => {
      await crear();

      const etiquetas = Array.from(filas()[0].querySelectorAll('td[data-label]')).map((td) =>
        td.getAttribute('data-label'),
      );
      expect(etiquetas).toEqual([
        'Número',
        'Emitida',
        'Receptor',
        'Concepto',
        'Base',
        'IVA',
        'Cuota',
        'Total',
      ]);
      expect(el().querySelector('table')?.getAttribute('aria-label')).toBe(
        'Facturas del club en el periodo elegido',
      );
    });

    it('sin facturas dice que no hay ninguna en el periodo', async () => {
      facturas.delClub.mockReturnValue(of(listado([], 0)));
      await crear();

      expect(el().textContent).toContain('No hay facturas en este periodo.');
      expect(el().querySelector('table')).toBeNull();
    });
  });

  describe('totales', () => {
    it('salen de la respuesta (todo el conjunto filtrado), no de sumar la página', async () => {
      facturas.delClub.mockReturnValue(of(listado([ORIGINAL], 41)));
      await crear();

      const totales = texto(el().querySelector('[data-testid="totales"]'));
      expect(totales).toContain('41 facturas');
      expect(totales).toContain('1.234,50 €');
      expect(totales).toContain('259,25 €');
      expect(totales).toContain('1.493,75 €');
    });

    it('en singular con una sola factura', async () => {
      facturas.delClub.mockReturnValue(of(listado([ORIGINAL], 1)));
      await crear();

      expect(texto(el().querySelector('[data-testid="totales"]'))).toContain('1 factura');
      expect(texto(el().querySelector('[data-testid="totales"]'))).not.toContain('1 facturas');
    });

    it('el bloque de totales es un grupo con nombre accesible', async () => {
      await crear();

      const grupo = el().querySelector('[data-testid="totales"]')!;
      expect(grupo.getAttribute('role')).toBe('group');
      expect(grupo.getAttribute('aria-label')).toBe('Totales del periodo filtrado');
    });
  });

  describe('filtros', () => {
    it('elegir un tipo recarga con ese tipo desde la página 0', async () => {
      await crear();

      await cambiar(tipo(), 'RECTIFICATIVA');

      expect(facturas.delClub).toHaveBeenCalledTimes(2);
      expect(facturas.delClub).toHaveBeenLastCalledWith(5, {
        desde: '2026-07-01',
        hasta: '2026-07-31',
        tipo: 'RECTIFICATIVA',
        page: 0,
        limit: 20,
      });
    });

    it('volver a "Todas" quita el tipo', async () => {
      await crear();
      await cambiar(tipo(), 'ORIGINAL');

      await cambiar(tipo(), '');

      expect(facturas.delClub.mock.calls.at(-1)![1].tipo).toBeUndefined();
    });

    it('cambiar las fechas recarga con el nuevo rango', async () => {
      await crear();

      await cambiar(desde(), '2026-06-15');
      await cambiar(hasta(), '2026-07-02');

      expect(facturas.delClub.mock.calls.at(-1)![1]).toMatchObject({
        desde: '2026-06-15',
        hasta: '2026-07-02',
        page: 0,
      });
    });

    it('vaciar una fecha deja ese extremo sin límite', async () => {
      await crear();

      await cambiar(desde(), '');

      expect(facturas.delClub.mock.calls.at(-1)![1].desde).toBeUndefined();
    });

    it('un rango al revés avisa y no llama al servidor', async () => {
      await crear();

      await cambiar(desde(), '2026-08-01');

      expect(facturas.delClub).toHaveBeenCalledTimes(1);
      expect(alerta()).toBe('La fecha inicial no puede ser posterior a la final');
    });

    it.each(['0202-01-01', '1969-12-31', '2101-01-01', '19999-01-01'])(
      'la fecha %s está fuera de 1970-2100: avisa y no llama al servidor (p. ej. al teclear el año)',
      async (fecha) => {
        await crear();

        await cambiar(desde(), fecha);

        expect(facturas.delClub).toHaveBeenCalledTimes(1);
        expect(alerta()).toBe('Las fechas deben estar entre 1970 y 2100');
      },
    );

    it('1970-01-01 y 2100-12-31 son fechas admitidas', async () => {
      await crear();

      await cambiar(desde(), '1970-01-01');
      await cambiar(hasta(), '2100-12-31');

      expect(facturas.delClub.mock.calls.at(-1)![1]).toMatchObject({
        desde: '1970-01-01',
        hasta: '2100-12-31',
      });
      expect(alerta()).toBeUndefined();
    });

    it('un rango inválido cancela la consulta en vuelo: se apaga el spinner y su respuesta tardía no se pinta', async () => {
      const enVuelo = new Subject<ListadoFacturasClub>();
      facturas.delClub.mockReturnValue(enVuelo);
      await crear();
      expect(el().querySelector('mat-spinner')).not.toBeNull();

      await cambiar(desde(), '2026-08-01'); // al revés: no se puede pedir
      expect(el().querySelector('mat-spinner')).toBeNull();
      expect(enVuelo.observed).toBe(false); // se canceló de verdad, no solo se ocultó

      enVuelo.next(listado([ORIGINAL, RECTIFICATIVA], 2)); // llega la del filtro anterior
      await estable();

      expect(filas()).toHaveLength(0);
      expect(el().querySelector('[data-testid="totales"]')).toBeNull();
      expect(alerta()).toBe('La fecha inicial no puede ser posterior a la final');
    });

    it('un rango inválido no deja a la vista las filas ni los totales del periodo anterior', async () => {
      await crear();
      expect(filas()).toHaveLength(2);
      expect(el().querySelector('[data-testid="totales"]')).not.toBeNull();

      await cambiar(desde(), '2026-08-01');

      expect(filas()).toHaveLength(0);
      expect(el().querySelector('[data-testid="totales"]')).toBeNull();
      expect(el().textContent).not.toContain('No hay facturas en este periodo.');
      expect(alerta()).toBe('La fecha inicial no puede ser posterior a la final');
    });

    it('corregir el rango al revés vuelve a cargar y quita el aviso', async () => {
      await crear();
      await cambiar(desde(), '2026-08-01');

      await cambiar(hasta(), '2026-08-31');

      expect(alerta()).toBeUndefined();
      expect(facturas.delClub.mock.calls.at(-1)![1]).toMatchObject({
        desde: '2026-08-01',
        hasta: '2026-08-31',
      });
    });

    it('los campos de fecha tienen etiqueta y los límites del backend (1970-2100)', async () => {
      await crear();

      expect(desde().min).toBe('1970-01-01');
      expect(desde().max).toBe('2100-12-31');
      expect(hasta().min).toBe('1970-01-01');
      expect(hasta().max).toBe('2100-12-31');
      const etiquetas = Array.from(el().querySelectorAll('mat-label')).map((l) =>
        l.textContent!.trim(),
      );
      expect(etiquetas).toEqual(['Desde', 'Hasta', 'Tipo']);
    });
  });

  describe('paginación', () => {
    it('con 45 facturas y 20 por página hay 3 páginas; Anterior está desactivado en la primera', async () => {
      facturas.delClub.mockReturnValue(of(listado([ORIGINAL], 45)));
      await crear();

      expect(texto(el().querySelector('[data-testid="paginacion"]'))).toContain('Página 1 de 3');
      expect(boton('anterior').disabled).toBe(true);
      expect(boton('siguiente').disabled).toBe(false);
    });

    it('Siguiente pide la página 1 con los mismos filtros; Anterior vuelve a la 0', async () => {
      facturas.delClub.mockReturnValue(of(listado([ORIGINAL], 45)));
      await crear();

      boton('siguiente').click();
      await estable();
      expect(facturas.delClub).toHaveBeenLastCalledWith(5, {
        desde: '2026-07-01',
        hasta: '2026-07-31',
        tipo: undefined,
        page: 1,
        limit: 20,
      });
      expect(texto(el().querySelector('[data-testid="paginacion"]'))).toContain('Página 2 de 3');

      boton('anterior').click();
      await estable();
      expect(facturas.delClub.mock.calls.at(-1)![1].page).toBe(0);
    });

    it('en la última página Siguiente está desactivado', async () => {
      facturas.delClub.mockReturnValue(of(listado([ORIGINAL], 45)));
      await crear();

      boton('siguiente').click();
      await estable();
      boton('siguiente').click();
      await estable();

      expect(texto(el().querySelector('[data-testid="paginacion"]'))).toContain('Página 3 de 3');
      expect(boton('siguiente').disabled).toBe(true);
      expect(facturas.delClub.mock.calls.at(-1)![1].page).toBe(2);
    });

    it('cambiar un filtro vuelve a la página 0', async () => {
      facturas.delClub.mockReturnValue(of(listado([ORIGINAL], 45)));
      await crear();
      boton('siguiente').click();
      await estable();

      await cambiar(tipo(), 'ORIGINAL');

      expect(facturas.delClub.mock.calls.at(-1)![1]).toMatchObject({ tipo: 'ORIGINAL', page: 0 });
    });

    it('con una sola página no se enseñan los botones', async () => {
      facturas.delClub.mockReturnValue(of(listado([ORIGINAL], 20)));
      await crear();

      expect(el().querySelector('[data-testid="paginacion"]')).toBeNull();
    });

    it('la paginación es una navegación con nombre accesible', async () => {
      facturas.delClub.mockReturnValue(of(listado([ORIGINAL], 45)));
      await crear();

      expect(el().querySelector('[data-testid="paginacion"]')?.getAttribute('aria-label')).toBe(
        'Paginación de facturas',
      );
    });
  });

  describe('descargar PDF', () => {
    it('cada fila tiene su botón con nombre accesible y descarga el PDF de esa factura', async () => {
      await crear();

      const botones = filas().map((f) =>
        f.querySelector<HTMLButtonElement>('button[data-accion="descargar"]')!,
      );
      expect(botones[0].getAttribute('aria-label')).toBe(
        'Descargar el PDF de la factura F2026-0001',
      );
      botones[1].click();
      await estable();

      expect(facturas.pdf).toHaveBeenCalledTimes(1);
      expect(facturas.pdf).toHaveBeenCalledWith(2);
      expect(descargas).toEqual(['F2026-0002.pdf']);
    });

    it('si falla, avisa con un snackbar y no descarga nada', async () => {
      facturas.pdf.mockReturnValue(throwError(() => http(500)));
      await crear();

      filas()[0].querySelector<HTMLButtonElement>('button[data-accion="descargar"]')!.click();
      await estable();

      expect(snack.open).toHaveBeenCalledWith(
        'No se pudo descargar la factura. Inténtalo de nuevo.',
        'Cerrar',
        { duration: 6000 },
      );
      expect(descargas).toEqual([]);
    });

    it('mientras se descarga una factura su botón se desactiva y no se pide dos veces', async () => {
      facturas.pdf.mockReturnValue(new Subject());
      await crear();
      const primero = filas()[0].querySelector<HTMLButtonElement>(
        'button[data-accion="descargar"]',
      )!;

      primero.click();
      await estable();
      primero.click();
      await estable();

      expect(facturas.pdf).toHaveBeenCalledTimes(1);
      expect(primero.disabled).toBe(true);
    });
  });

  describe('error', () => {
    it('muestra el mensaje y Reintentar repite la última consulta', async () => {
      facturas.delClub.mockReturnValueOnce(throwError(() => http(500)));
      await crear();

      expect(alerta()).toContain('No se pudieron cargar las facturas');
      expect(filas()).toHaveLength(0);

      boton('reintentar').click();
      await estable();

      expect(facturas.delClub).toHaveBeenCalledTimes(2);
      expect(filas()).toHaveLength(2);
      expect(alerta()).toBeUndefined();
    });

    it('un 400 del backend (fechas fuera de rango) enseña su mensaje', async () => {
      facturas.delClub.mockReturnValueOnce(
        throwError(() => http(400, { error: 'Las fechas deben estar entre 1970 y 2100' })),
      );
      await crear();

      expect(alerta()).toBe('Las fechas deben estar entre 1970 y 2100');
    });

    it('los filtros siguen visibles con el error (se puede corregir y volver a pedir)', async () => {
      facturas.delClub.mockReturnValueOnce(throwError(() => http(500)));
      await crear();

      expect(desde()).not.toBeNull();
      expect(tipo()).not.toBeNull();
    });

    it('recarga sola cuando la sesión deja de ser incierta si estaba en error', async () => {
      facturas.delClub.mockReturnValueOnce(throwError(() => http(0)));
      await crear();
      auth.sesionIncierta.set(true);
      await estable();

      auth.sesionIncierta.set(false);
      await estable();

      expect(facturas.delClub).toHaveBeenCalledTimes(2);
    });

    it('si la sesión se recupera sin error, no recarga', async () => {
      await crear();
      auth.sesionIncierta.set(true);
      await estable();

      auth.sesionIncierta.set(false);
      await estable();

      expect(facturas.delClub).toHaveBeenCalledTimes(1);
    });
  });
});
