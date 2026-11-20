export type TipoFactura = 'ORIGINAL' | 'RECTIFICATIVA';

export interface EmisorFactura {
  razonSocial: string;
  nif: string;
  direccion: string;
}

export interface ReceptorFactura {
  nombre: string;
  nif: string | null;
  direccion: string | null;
}

/** Factura tal como la manda el backend. Las rectificativas llevan los importes en negativo. */
export interface Factura {
  id: number;
  serie: string;
  numero: number;
  /** "F2026-0001": lo que se enseña y lo que da nombre al PDF. */
  numeroCompleto: string;
  tipo: TipoFactura;
  /** Id de la factura original a la que corrige (solo en las rectificativas). */
  rectificaA: number | null;
  reservaId: number;
  /** Instante ISO-8601 (UTC). */
  emitidaEn: string;
  emisor: EmisorFactura;
  receptor: ReceptorFactura;
  concepto: string;
  base: number;
  /** Porcentaje (21 = 21 %). */
  tipoIva: number;
  cuotaIva: number;
  total: number;
}

export interface TotalesFacturas {
  cantidad: number;
  base: number;
  cuotaIva: number;
  total: number;
}

/** Una página de facturas del club y los totales de TODO el conjunto filtrado. */
export interface ListadoFacturasClub {
  facturas: Factura[];
  totales: TotalesFacturas;
  page: number;
  limit: number;
}

export interface FiltroFacturasClub {
  /** YYYY-MM-DD (día de Madrid, inclusivo). */
  desde?: string;
  hasta?: string;
  tipo?: TipoFactura;
  page?: number;
  limit?: number;
}

/** Datos del receptor al pedir una factura: todo es opcional (sin nombre se usa el del organizador). */
export interface ReceptorRequest {
  nombre?: string;
  nif?: string;
  direccion?: string;
}

export interface DatosFiscales {
  razonSocial: string | null;
  nif: string | null;
  direccionFiscal: string | null;
  tipoIva: number;
  configurado: boolean;
}

export interface DatosFiscalesRequest {
  razonSocial: string;
  nif: string;
  direccionFiscal: string;
  tipoIva: number;
}

/** Resultado de pedir una factura: `creada` es true con 201 y false si ya existía (200). */
export interface EmisionFactura {
  factura: Factura;
  creada: boolean;
}
