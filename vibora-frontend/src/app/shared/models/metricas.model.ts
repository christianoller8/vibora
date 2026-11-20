/** Contratos de `/api/clubes/{id}/metricas/*` (paquete `com.vibora.metricas`). Fechas YYYY-MM-DD, dinero en euros. */

export const GRANULARIDAD = { DIA: 'DIA', SEMANA: 'SEMANA', MES: 'MES' } as const;
export type Granularidad = (typeof GRANULARIDAD)[keyof typeof GRANULARIDAD];

export type DiaSemana =
  'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

/** Rango de días locales del club, ambos extremos incluidos. */
export interface RangoMetricas {
  desde: string;
  hasta: string;
}

export interface Facturado {
  base: number;
  cuotaIva: number;
  total: number;
  numeroFacturas: number;
  numeroRectificativas: number;
}

/** Porcentajes (tasa y ocupación) como fracción 0..1; nulos si no se pueden calcular. */
export interface ResumenMetricas {
  desde: string;
  hasta: string;
  ingresos: number;
  reservasConfirmadas: number;
  reservasCanceladas: number;
  tasaCancelacion: number | null;
  ticketMedio: number | null;
  ingresosPerdidosPorCancelacion: number;
  ocupacionGlobal: number | null;
  facturado: Facturado;
}

export interface PuntoIngresos {
  periodo: string;
  ingresos: number;
  reservas: number;
}

export interface IngresosMetricas {
  desde: string;
  hasta: string;
  granularidad: Granularidad;
  serie: PuntoIngresos[];
}

export interface PistaOcupacion {
  pistaId: number;
  pistaNombre: string;
  ranurasOfrecidas: number;
  ranurasOcupadas: number;
  ocupacion: number | null;
  ingresos: number;
}

export interface OcupacionMetricas {
  desde: string;
  hasta: string;
  ocupacionGlobal: number | null;
  ranurasOfrecidas: number;
  ranurasOcupadas: number;
  pistas: PistaOcupacion[];
}

export interface Franja {
  diaSemana: DiaSemana;
  hora: string;
  reservas: number;
  ingresos: number;
  ranurasOfrecidas: number;
  ocupacion: number | null;
}

export interface FranjasMetricas {
  desde: string;
  hasta: string;
  limit: number;
  masRentables: Franja[];
  matriz: Franja[];
}

export interface PuntoCancelaciones {
  periodo: string;
  canceladas: number;
  confirmadas: number;
  tasa: number | null;
}

export interface CancelacionesPista {
  pistaId: number;
  pistaNombre: string;
  canceladas: number;
  ingresosPerdidos: number;
}

export interface CancelacionesMetricas {
  desde: string;
  hasta: string;
  granularidad: Granularidad;
  serie: PuntoCancelaciones[];
  porPista: CancelacionesPista[];
}

/** Todo lo que pinta el panel para un rango, pedido en paralelo. */
export interface DatosPanel {
  resumen: ResumenMetricas;
  ingresos: IngresosMetricas;
  ocupacion: OcupacionMetricas;
  franjas: FranjasMetricas;
  cancelaciones: CancelacionesMetricas;
}
