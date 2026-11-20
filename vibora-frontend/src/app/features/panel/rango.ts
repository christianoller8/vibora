import { Granularidad, RangoMetricas } from '../../shared/models/metricas.model';

/** Fechas que acepta el backend (`LimitesFecha`). */
export const FECHA_MINIMA = '1970-01-01';
export const FECHA_MAXIMA = '2100-12-31';
/** Rango máximo del backend (`RangoFechas.MAX_DIAS`). */
export const MAX_DIAS = 366;

export const PRESETS = {
  SIETE: '7d',
  TREINTA: '30d',
  NOVENTA: '90d',
  MES: 'mes',
  PERSONALIZADO: 'personalizado',
} as const;
export type Preset = (typeof PRESETS)[keyof typeof PRESETS];
export type PresetFijo = Exclude<Preset, 'personalizado'>;

const MS_DIA = 86_400_000;

function aUtc(fecha: string): number {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return Date.UTC(anio, mes - 1, dia);
}

/** YYYY-MM-DD + `dias` días de calendario (aritmética en UTC: el cambio de hora no cuenta). */
export function sumarDias(fecha: string, dias: number): string {
  return new Date(aUtc(fecha) + dias * MS_DIA).toISOString().slice(0, 10);
}

/** Número de días de un rango, ambos extremos incluidos. */
export function diasDelRango(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / MS_DIA) + 1;
}

/** Rango de un preset terminando en `hoy` (YYYY-MM-DD en Madrid); "este mes" va del día 1 a hoy. */
export function rangoDePreset(preset: PresetFijo, hoy: string): RangoMetricas {
  switch (preset) {
    case '7d':
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case '30d':
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case '90d':
      return { desde: sumarDias(hoy, -89), hasta: hoy };
    case 'mes':
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  }
}

function esFechaReal(fecha: string): boolean {
  return new Date(aUtc(fecha)).toISOString().slice(0, 10) === fecha;
}

/**
 * Mensaje si el rango no se puede pedir al backend (entonces no se hace ninguna petición); null si vale. Un año de
 * más de 4 cifras, o uno a medio teclear (0002), también cae en el mensaje de 1970–2100.
 */
export function validarRango(desde: string, hasta: string): string | null {
  if (desde === '' || hasta === '') {
    return 'Elige la fecha inicial y la final';
  }
  for (const fecha of [desde, hasta]) {
    const fueraDeRango =
      !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < FECHA_MINIMA || fecha > FECHA_MAXIMA;
    if (fueraDeRango) {
      return 'Las fechas deben estar entre 1970 y 2100';
    }
  }
  if (!esFechaReal(desde) || !esFechaReal(hasta)) {
    return 'Elige la fecha inicial y la final';
  }
  if (desde > hasta) {
    return 'La fecha inicial no puede ser posterior a la final';
  }
  if (diasDelRango(desde, hasta) > MAX_DIAS) {
    return `El rango no puede superar los ${MAX_DIAS} días`;
  }
  return null;
}

/** Granularidad con la que el gráfico de ingresos queda legible: día hasta un mes, semana hasta ~4 meses, mes más allá. */
export function granularidadPorDefecto(dias: number): Granularidad {
  if (dias <= 31) {
    return 'DIA';
  }
  return dias <= 120 ? 'SEMANA' : 'MES';
}
