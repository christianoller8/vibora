import { Factura } from '../models/factura.model';

/** La librería de tipos de TypeScript aún no conoce `useGrouping: 'always'` (sí lo implementa el navegador). */
type OpcionesImporte = Omit<Intl.NumberFormatOptions, 'useGrouping'> & { useGrouping: 'always' };

const opcionesImporte: OpcionesImporte = {
  style: 'currency',
  currency: 'EUR',
  // es-ES no agrupa los miles de un importe de 4 cifras ("1234,56 €"): en una factura siempre se agrupa
  useGrouping: 'always',
};

const formatoImporte = new Intl.NumberFormat(
  'es-ES',
  opcionesImporte as unknown as Intl.NumberFormatOptions,
);

/** "1.234,56 €"; un importe negativo (rectificativa) sale con signo menos. */
export function formatearImporte(importe: number): string {
  return formatoImporte.format(importe);
}

const formatoPorcentaje = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

/** "21 %", "10,5 %" (con espacio duro, como se escribe en español). */
export function formatearPorcentaje(valor: number): string {
  return `${formatoPorcentaje.format(valor)} %`;
}

/** "F2026-0001" → "F2026-0001.pdf". Solo [A-Za-z0-9._-]: el nombre sale de un dato del servidor. */
export function nombreFicheroFactura(numeroCompleto: string): string {
  const base = numeroCompleto.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${base === '' ? 'factura' : base}.pdf`;
}

/**
 * Entrega el PDF al usuario: URL de objeto + enlace temporal con `download`. La URL se revoca siempre (también si
 * el clic falla) y el enlace no queda en el documento.
 */
export function descargarPdf(blob: Blob, numeroCompleto: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreFicheroFactura(numeroCompleto);
  enlace.hidden = true;
  document.body.appendChild(enlace);
  try {
    enlace.click();
  } finally {
    enlace.remove();
    URL.revokeObjectURL(url);
  }
}

export function esRectificativa(factura: Factura): boolean {
  return factura.tipo === 'RECTIFICATIVA';
}

/** Número de la factura que corrige una rectificativa, si esa factura está en `facturas`; si no, null. */
export function numeroDeLaRectificada(factura: Factura, facturas: Factura[]): string | null {
  if (!esRectificativa(factura) || factura.rectificaA === null) {
    return null;
  }
  return facturas.find((f) => f.id === factura.rectificaA)?.numeroCompleto ?? null;
}

/** Primer y último día (YYYY-MM-DD) del mes de `hoy` (YYYY-MM-DD). */
export function rangoDelMes(hoy: string): { desde: string; hasta: string } {
  const [anio, mes] = hoy.split('-').map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const prefijo = `${anio}-${String(mes).padStart(2, '0')}`;
  return { desde: `${prefijo}-01`, hasta: `${prefijo}-${String(ultimo).padStart(2, '0')}` };
}
