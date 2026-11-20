import {
  CancelacionesMetricas,
  DiaSemana,
  Franja,
  FranjasMetricas,
  Granularidad,
  IngresosMetricas,
  OcupacionMetricas,
  ResumenMetricas,
} from '../../shared/models/metricas.model';
import { formatearImporte } from '../../shared/util/factura';

/*
 * Funciones puras: respuesta del backend -> lo que pinta el panel (series, tablas, textos). No dependen de Chart.js ni
 * del DOM: el gráfico, su tabla alternativa y su descripción accesible salen de la MISMA especificación, así no pueden
 * contar historias distintas.
 */

export type FormatoValor = 'euros' | 'entero' | 'porcentaje';
/** Ranura de color de la serie (el CSS las enlaza con la paleta; el color sigue a la entidad, no a su posición). */
export type ClaveSerie = 'serie1' | 'serie2';
export type TipoGrafico = 'columnas' | 'columnas-apiladas' | 'barras';

export interface SerieGrafico {
  clave: ClaveSerie;
  nombre: string;
  valores: (number | null)[];
  formato: FormatoValor;
}

export interface TablaGrafico {
  columnas: string[];
  filas: string[][];
}

export interface EspecGrafico {
  tipo: TipoGrafico;
  /** Etiquetas cortas del eje. */
  etiquetas: string[];
  /** Etiquetas completas para el tooltip. */
  etiquetasLargas: string[];
  series: SerieGrafico[];
  /** Resumen en texto del gráfico (aria-label). */
  descripcion: string;
  tabla: TablaGrafico;
}

export interface TarjetaKpi {
  clave: string;
  titulo: string;
  valor: string;
  detalle?: string;
}

/** Intl pone espacios duros (U+00A0 / U+202F) entre cifra y símbolo; el CSS ya impide el salto de línea. */
const normal = (texto: string): string => texto.replace(/[  ]/g, ' ');

const formatoEntero = new Intl.NumberFormat('es-ES', { useGrouping: true });
const formatoFraccion = new Intl.NumberFormat('es-ES', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const euros = (valor: number): string => normal(formatearImporte(valor));
const entero = (valor: number): string => normal(formatoEntero.format(valor));

/** Fracción 0..1 -> "45,7 %"; null (no calculable) -> "—", nunca 0 %. */
export function formatearFraccion(fraccion: number | null): string {
  return fraccion === null ? '—' : normal(formatoFraccion.format(fraccion));
}

export function formatearValor(valor: number | null, formato: FormatoValor): string {
  if (valor === null) {
    return '—';
  }
  switch (formato) {
    case 'euros':
      return euros(valor);
    case 'porcentaje':
      return formatearFraccion(valor);
    case 'entero':
      return entero(valor);
  }
}

const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];
const MESES_LARGOS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * Etiqueta de un periodo (su primer día, YYYY-MM-DD). Es calendario puro: se parte el texto, sin pasar por Date ni
 * por zonas horarias, así que el día no se desplaza en los domingos del cambio de hora.
 */
export function etiquetaPeriodo(
  periodo: string,
  granularidad: Granularidad,
  largo: boolean,
): string {
  const [anio, mes, dia] = periodo.split('-').map(Number);
  const mesCorto = MESES_CORTOS[mes - 1];
  switch (granularidad) {
    case 'DIA':
      return largo ? `${dia} ${mesCorto} ${anio}` : `${dia} ${mesCorto}`;
    case 'SEMANA':
      return largo ? `Semana del ${dia} ${mesCorto} ${anio}` : `${dia} ${mesCorto}`;
    case 'MES':
      return largo
        ? `${MESES_LARGOS[mes - 1]} de ${anio}`
        : `${mesCorto} ${String(anio).slice(-2)}`;
  }
}

const SUSTANTIVO: Record<Granularidad, string> = { DIA: 'día', SEMANA: 'semana', MES: 'mes' };

const suma = (valores: readonly number[]): number => valores.reduce((a, b) => a + b, 0);
const plural = (n: number, singular: string, pluralTexto: string): string =>
  `${entero(n)} ${n === 1 ? singular : pluralTexto}`;

function tabla(columnas: string[], etiquetas: string[], series: SerieGrafico[]): TablaGrafico {
  return {
    columnas,
    filas: etiquetas.map((etiqueta, i) => [
      etiqueta,
      ...series.map((s) => formatearValor(s.valores[i], s.formato)),
    ]),
  };
}

/** Ingresos por periodo (columnas). null si en todo el rango no hay ni ingresos ni reservas: el panel pinta "sin datos". */
export function especIngresos(datos: IngresosMetricas): EspecGrafico | null {
  const { serie, granularidad } = datos;
  if (serie.length === 0 || serie.every((p) => p.ingresos === 0 && p.reservas === 0)) {
    return null;
  }
  const largas = serie.map((p) => etiquetaPeriodo(p.periodo, granularidad, true));
  const series: SerieGrafico[] = [
    {
      clave: 'serie1',
      nombre: 'Ingresos',
      valores: serie.map((p) => p.ingresos),
      formato: 'euros',
    },
  ];
  const mejor = serie.reduce((m, p, i) => (p.ingresos > serie[m].ingresos ? i : m), 0);
  const nombre = SUSTANTIVO[granularidad];
  const descripcion =
    `Ingresos por ${nombre}: total ${euros(suma(serie.map((p) => p.ingresos)))} en ` +
    `${plural(serie.length, 'periodo', 'periodos')}, de ${largas[0]} a ${largas[largas.length - 1]}. ` +
    `El mejor ${nombre}: ${largas[mejor]} con ${euros(serie[mejor].ingresos)}.`;
  return {
    tipo: 'columnas',
    etiquetas: serie.map((p) => etiquetaPeriodo(p.periodo, granularidad, false)),
    etiquetasLargas: largas,
    series,
    descripcion,
    tabla: tabla(['Periodo', 'Ingresos'], largas, series),
  };
}

/** Ocupación por pista (barras horizontales, de más a menos ocupada). null si no se ofreció ninguna ranura. */
export function especOcupacion(datos: OcupacionMetricas): EspecGrafico | null {
  if (datos.ranurasOfrecidas === 0 || datos.pistas.length === 0) {
    return null;
  }
  const pistas = datos.pistas
    .map((p) => ({
      nombre: (p.pistaNombre ?? '').trim() === '' ? 'Pista sin nombre' : p.pistaNombre.trim(),
      ocupacion: p.ocupacion,
    }))
    .sort((a, b) => {
      if (a.ocupacion === null || b.ocupacion === null) {
        return a.ocupacion === b.ocupacion ? 0 : a.ocupacion === null ? 1 : -1;
      }
      return b.ocupacion - a.ocupacion || a.nombre.localeCompare(b.nombre, 'es');
    });
  const etiquetas = pistas.map((p) => p.nombre);
  const series: SerieGrafico[] = [
    {
      clave: 'serie1',
      nombre: 'Ocupación',
      valores: pistas.map((p) => p.ocupacion),
      formato: 'porcentaje',
    },
  ];
  const conDato = pistas.filter((p) => p.ocupacion !== null);
  let detalle = '';
  if (conDato.length > 0) {
    const mas = conDato[0];
    const menos = conDato[conDato.length - 1];
    detalle =
      conDato.length === 1
        ? ` ${mas.nombre} (${formatearFraccion(mas.ocupacion)}).`
        : ` Más ocupada: ${mas.nombre} (${formatearFraccion(mas.ocupacion)}); menos ocupada: ${menos.nombre} (${formatearFraccion(menos.ocupacion)}).`;
  }
  return {
    tipo: 'barras',
    etiquetas,
    etiquetasLargas: etiquetas,
    series,
    descripcion: `Ocupación por pista, global ${formatearFraccion(datos.ocupacionGlobal)}.${detalle}`,
    tabla: tabla(['Pista', 'Ocupación'], etiquetas, series),
  };
}

/** Reservas confirmadas y canceladas por periodo (columnas apiladas). null si no hay ninguna reserva en el rango. */
export function especCancelaciones(datos: CancelacionesMetricas): EspecGrafico | null {
  const { serie, granularidad } = datos;
  if (serie.every((p) => p.canceladas === 0 && p.confirmadas === 0)) {
    return null;
  }
  const largas = serie.map((p) => etiquetaPeriodo(p.periodo, granularidad, true));
  const series: SerieGrafico[] = [
    {
      clave: 'serie1',
      nombre: 'Confirmadas',
      valores: serie.map((p) => p.confirmadas),
      formato: 'entero',
    },
    {
      clave: 'serie2',
      nombre: 'Canceladas',
      valores: serie.map((p) => p.canceladas),
      formato: 'entero',
    },
  ];
  const confirmadas = suma(serie.map((p) => p.confirmadas));
  const canceladas = suma(serie.map((p) => p.canceladas));
  const tasa = canceladas / (canceladas + confirmadas);
  return {
    tipo: 'columnas-apiladas',
    etiquetas: serie.map((p) => etiquetaPeriodo(p.periodo, granularidad, false)),
    etiquetasLargas: largas,
    series,
    descripcion:
      `Reservas confirmadas y canceladas por ${SUSTANTIVO[granularidad]}: ` +
      `${plural(confirmadas, 'confirmada', 'confirmadas')}, ` +
      `${plural(canceladas, 'cancelada', 'canceladas')} (tasa de cancelación ${formatearFraccion(tasa)}).`,
    tabla: tabla(['Periodo', 'Confirmadas', 'Canceladas'], largas, series),
  };
}

/** Las tarjetas de cifras, solo con lo que devuelve el resumen (sin comparaciones inventadas con otros periodos). */
export function tarjetasKpi(resumen: ResumenMetricas): TarjetaKpi[] {
  const f = resumen.facturado;
  const factura = `Base ${euros(f.base)} + IVA ${euros(f.cuotaIva)} · ${plural(f.numeroFacturas, 'factura', 'facturas')}`;
  return [
    { clave: 'ingresos', titulo: 'Ingresos', valor: euros(resumen.ingresos) },
    {
      clave: 'confirmadas',
      titulo: 'Reservas confirmadas',
      valor: entero(resumen.reservasConfirmadas),
    },
    {
      clave: 'canceladas',
      titulo: 'Reservas canceladas',
      valor: entero(resumen.reservasCanceladas),
    },
    {
      clave: 'tasa',
      titulo: 'Tasa de cancelación',
      valor: formatearFraccion(resumen.tasaCancelacion),
    },
    {
      clave: 'ticket',
      titulo: 'Ticket medio',
      valor: resumen.ticketMedio === null ? '—' : euros(resumen.ticketMedio),
    },
    {
      clave: 'perdidos',
      titulo: 'Ingresos perdidos por cancelación',
      valor: euros(resumen.ingresosPerdidosPorCancelacion),
    },
    {
      clave: 'ocupacion',
      titulo: 'Ocupación global',
      valor: formatearFraccion(resumen.ocupacionGlobal),
    },
    {
      clave: 'facturado',
      titulo: 'Facturado',
      valor: euros(f.total),
      detalle:
        f.numeroRectificativas > 0
          ? `${factura}, ${plural(f.numeroRectificativas, 'rectificativa', 'rectificativas')}`
          : factura,
    },
  ];
}

/* ---------- Mapa de calor de franjas ---------- */

/** Cubos de la escala secuencial del mapa de calor (nivel 0 = el más claro). */
export const NIVELES_CALOR = 5;
const UMBRALES_CALOR = [0.2, 0.4, 0.6, 0.8];

/** Cubo de la escala para una ocupación 0..1 (más de 1 no sale de la escala); null si no hay dato. */
export function nivelOcupacion(ocupacion: number | null): number | null {
  if (ocupacion === null) {
    return null;
  }
  return UMBRALES_CALOR.filter((umbral) => ocupacion >= umbral).length;
}

/** Texto de la leyenda de cada cubo (en el mismo orden que los niveles). */
export const RANGOS_CALOR: readonly string[] = [
  '0–20 %',
  '20–40 %',
  '40–60 %',
  '60–80 %',
  '80–100 %',
];

export interface DiaColumna {
  clave: DiaSemana;
  nombre: string;
  corto: string;
}

export const DIAS_SEMANA: readonly DiaColumna[] = [
  { clave: 'MONDAY', nombre: 'lunes', corto: 'L' },
  { clave: 'TUESDAY', nombre: 'martes', corto: 'M' },
  { clave: 'WEDNESDAY', nombre: 'miércoles', corto: 'X' },
  { clave: 'THURSDAY', nombre: 'jueves', corto: 'J' },
  { clave: 'FRIDAY', nombre: 'viernes', corto: 'V' },
  { clave: 'SATURDAY', nombre: 'sábado', corto: 'S' },
  { clave: 'SUNDAY', nombre: 'domingo', corto: 'D' },
];

export interface CeldaFranja {
  /** No hubo ninguna ranura ofrecida a ese día y hora. */
  vacia: boolean;
  nivel: number | null;
  /** Texto dentro de la celda: el color nunca es el único canal. */
  texto: string;
  /** Texto completo para lectores de pantalla. */
  etiqueta: string;
}

export interface MatrizCalor {
  dias: readonly DiaColumna[];
  horas: string[];
  /** Una fila por hora, una celda por día (en el orden de `dias`). */
  celdas: CeldaFranja[][];
}

export interface FilaRentable {
  franja: string;
  reservas: string;
  ingresos: string;
  ocupacion: string;
}

/** Las franjas más rentables (el backend ya las manda ordenadas por ingresos y luego reservas). */
export function franjasRentables(datos: FranjasMetricas): FilaRentable[] {
  return datos.masRentables.map((f) => ({
    franja: `${DIAS_SEMANA.find((d) => d.clave === f.diaSemana)?.nombre ?? f.diaSemana} ${f.hora}`,
    reservas: entero(f.reservas),
    ingresos: euros(f.ingresos),
    ocupacion: formatearFraccion(f.ocupacion),
  }));
}

function celda(dia: DiaColumna, hora: string, franja: Franja | undefined): CeldaFranja {
  if (franja === undefined || franja.ocupacion === null) {
    return {
      vacia: true,
      nivel: null,
      texto: '',
      etiqueta: `${dia.nombre} ${hora}: sin ranuras ofrecidas`,
    };
  }
  return {
    vacia: false,
    nivel: nivelOcupacion(franja.ocupacion),
    texto: `${Math.round(franja.ocupacion * 100)} %`,
    etiqueta:
      `${dia.nombre} ${hora}: ${formatearFraccion(franja.ocupacion)} de ocupación, ` +
      `${plural(franja.reservas, 'reserva', 'reservas')}, ${euros(franja.ingresos)}`,
  };
}

/** Matriz día x hora de la ocupación semanal; solo salen las horas en las que hubo alguna ranura ofrecida. */
export function mapaFranjas(datos: FranjasMetricas): MatrizCalor {
  const horas = [...new Set(datos.matriz.map((f) => f.hora))].sort();
  const porClave = new Map(datos.matriz.map((f) => [`${f.diaSemana}|${f.hora}`, f]));
  return {
    dias: DIAS_SEMANA,
    horas,
    celdas: horas.map((hora) =>
      DIAS_SEMANA.map((dia) => celda(dia, hora, porClave.get(`${dia.clave}|${hora}`))),
    ),
  };
}
