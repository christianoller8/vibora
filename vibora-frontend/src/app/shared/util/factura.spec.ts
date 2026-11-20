import { simularObjectUrls } from '../../testing/test-utils';
import { Factura } from '../models/factura.model';
import {
  descargarPdf,
  esRectificativa,
  formatearImporte,
  formatearPorcentaje,
  nombreFicheroFactura,
  numeroDeLaRectificada,
  rangoDelMes,
} from './factura';

function factura(cambios: Partial<Factura> = {}): Factura {
  return {
    id: 1,
    serie: 'F2026',
    numero: 1,
    numeroCompleto: 'F2026-0001',
    tipo: 'ORIGINAL',
    rectificaA: null,
    reservaId: 7,
    emitidaEn: '2026-07-15T16:00:00Z',
    emisor: { razonSocial: 'Club Víbora SL', nif: 'B12345674', direccion: 'Calle Mayor 1' },
    receptor: { nombre: 'Ana García', nif: null, direccion: null },
    concepto: 'Alquiler de pista',
    base: 24.79,
    tipoIva: 21,
    cuotaIva: 5.21,
    total: 30,
    ...cambios,
  };
}

describe('formatearImporte', () => {
  const normal = (n: number): string => formatearImporte(n).replace(/ /g, ' ');

  it('usa el formato es-ES: coma decimal, punto de millares y el símbolo detrás', () => {
    expect(normal(1234.56)).toBe('1.234,56 €');
    expect(normal(1234567.8)).toBe('1.234.567,80 €');
    expect(normal(999.5)).toBe('999,50 €');
    expect(normal(0)).toBe('0,00 €');
  });

  it('un importe negativo (rectificativa) lleva el signo menos', () => {
    expect(normal(-30)).toBe('-30,00 €');
    expect(normal(-1234.5)).toBe('-1.234,50 €');
  });
});

describe('formatearPorcentaje', () => {
  it.each([
    [21, '21 %'],
    [10.5, '10,5 %'],
    [0, '0 %'],
    [4, '4 %'],
    [99.99, '99,99 %'],
  ])('%s se muestra como "%s"', (valor, esperado) => {
    expect(formatearPorcentaje(valor).replace(/ /g, ' ')).toBe(esperado);
  });
});

describe('nombreFicheroFactura', () => {
  it('es el número completo con la extensión .pdf', () => {
    expect(nombreFicheroFactura('F2026-0001')).toBe('F2026-0001.pdf');
  });

  it('sustituye por "_" todo lo que no sea [A-Za-z0-9._-] (sin rutas ni caracteres raros)', () => {
    expect(nombreFicheroFactura('F2026/0001')).toBe('F2026_0001.pdf');
    expect(nombreFicheroFactura('../../etc/pass wd')).toBe('.._.._etc_pass_wd.pdf');
    expect(nombreFicheroFactura('R 2026ñ"<>:|?*\\')).toBe('R_2026_________.pdf');
  });

  it('un número vacío da un nombre usable', () => {
    expect(nombreFicheroFactura('')).toBe('factura.pdf');
  });
});

describe('descargarPdf', () => {
  let urls: ReturnType<typeof simularObjectUrls>;
  let enlaces: { download: string; href: string; enDom: boolean; atributo: string | null }[];

  beforeEach(() => {
    urls = simularObjectUrls();
    enlaces = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      enlaces.push({
        download: this.download,
        href: this.getAttribute('href') ?? '',
        enDom: document.body.contains(this),
        atributo: this.getAttribute('download'),
      });
    });
  });

  afterEach(() => {
    urls.restaurar();
    vi.restoreAllMocks();
  });

  it('crea una URL de objeto del blob y pulsa un enlace temporal con el nombre saneado', () => {
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

    descargarPdf(blob, 'F2026/0001');

    expect(urls.crear).toHaveBeenCalledWith(blob);
    expect(enlaces).toEqual([
      {
        download: 'F2026_0001.pdf',
        href: 'blob:prueba/1',
        enDom: true,
        atributo: 'F2026_0001.pdf',
      },
    ]);
  });

  it('retira el enlace del documento y revoca la URL de objeto', () => {
    descargarPdf(new Blob(['x']), 'F2026-0001');

    expect(document.querySelector('a[download]')).toBeNull();
    expect(urls.revocar).toHaveBeenCalledTimes(1);
    expect(urls.revocar).toHaveBeenCalledWith('blob:prueba/1');
  });

  it('revoca la URL y retira el enlace aunque el clic falle', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('bloqueado');
    });

    expect(() => descargarPdf(new Blob(['x']), 'F2026-0001')).toThrow('bloqueado');

    expect(document.querySelector('a[download]')).toBeNull();
    expect(urls.revocar).toHaveBeenCalledWith('blob:prueba/1');
  });
});

describe('esRectificativa', () => {
  it('distingue las rectificativas de las originales', () => {
    expect(esRectificativa(factura())).toBe(false);
    expect(esRectificativa(factura({ tipo: 'RECTIFICATIVA', rectificaA: 1 }))).toBe(true);
  });
});

describe('numeroDeLaRectificada', () => {
  const original = factura({ id: 1, numeroCompleto: 'F2026-0001' });
  const rectificativa = factura({
    id: 2,
    numero: 2,
    numeroCompleto: 'F2026-0002',
    tipo: 'RECTIFICATIVA',
    rectificaA: 1,
    total: -30,
  });

  it('devuelve el número de la original si está en la lista', () => {
    expect(numeroDeLaRectificada(rectificativa, [rectificativa, original])).toBe('F2026-0001');
  });

  it('devuelve null si la original no está en la lista (otra página o filtro)', () => {
    expect(numeroDeLaRectificada(rectificativa, [rectificativa])).toBeNull();
  });

  it('devuelve null para una factura original', () => {
    expect(numeroDeLaRectificada(original, [original])).toBeNull();
  });
});

describe('rangoDelMes', () => {
  it.each([
    ['2026-07-15', '2026-07-01', '2026-07-31'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2028-02-29', '2028-02-01', '2028-02-29'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
    ['2026-01-01', '2026-01-01', '2026-01-31'],
    ['2026-04-30', '2026-04-01', '2026-04-30'],
  ])('el mes de %s va de %s a %s', (hoy, desde, hasta) => {
    expect(rangoDelMes(hoy)).toEqual({ desde, hasta });
  });
});
