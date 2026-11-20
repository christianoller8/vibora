import type { ChartConfiguration } from 'chart.js';
import { ClaveSerie, EspecGrafico, formatearValor } from '../mapeo';

/** Colores y preferencias con las que se pinta un gráfico (se leen del CSS en tiempo de ejecución). */
export interface EstiloGrafico {
  series: Record<ClaveSerie, string>;
  texto: string;
  rejilla: string;
  eje: string;
  superficie: string;
  sinAnimacion: boolean;
}

/** Reserva por si faltan las variables CSS (paleta de datos validada, tema claro). */
const RESERVA = {
  serie1: '#2a78d6',
  serie2: '#eb6834',
  texto: '#52514e',
  rejilla: '#e1e0d9',
  eje: '#c3c2b7',
  superficie: '#fcfcfb',
} as const;

/**
 * Los tokens de Material llegan como `light-dark(#c4c6d0, #44474e)` y el canvas de Chart.js no entiende esa función
 * (pinta negro). Un elemento sonda deja que el navegador resuelva el color a `rgb(...)`; un valor simple pasa tal cual.
 */
function resolverColor(contenedor: HTMLElement, valor: string, reserva: string): string {
  if (!/light-dark\(|var\(|color-mix\(/.test(valor)) {
    return valor;
  }
  const sonda = document.createElement('span');
  sonda.style.color = valor;
  contenedor.appendChild(sonda);
  try {
    const resuelto = getComputedStyle(sonda).color;
    return resuelto === '' ? reserva : resuelto;
  } finally {
    sonda.remove();
  }
}

/**
 * Lee los colores de las variables CSS `--viz-*` del elemento (así un tema oscuro solo cambia el CSS) y la
 * preferencia `prefers-reduced-motion`.
 */
export function leerEstilo(elemento: HTMLElement): EstiloGrafico {
  const css = getComputedStyle(elemento);
  const variable = (nombre: string, reserva: string): string => {
    const valor = css.getPropertyValue(nombre).trim();
    return valor === '' ? reserva : resolverColor(elemento, valor, reserva);
  };
  const sinAnimacion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    series: {
      serie1: variable('--viz-serie-1', RESERVA.serie1),
      serie2: variable('--viz-serie-2', RESERVA.serie2),
    },
    texto: variable('--viz-texto', RESERVA.texto),
    rejilla: variable('--viz-rejilla', RESERVA.rejilla),
    eje: variable('--viz-eje', RESERVA.eje),
    superficie: variable('--viz-superficie', RESERVA.superficie),
    sinAnimacion,
  };
}

/** Configuración de Chart.js (siempre de barras) para una especificación; sin dependencias de DOM ni del runtime. */
export function construirConfig(
  espec: EspecGrafico,
  estilo: EstiloGrafico,
): ChartConfiguration<'bar'> {
  const horizontal = espec.tipo === 'barras';
  const apilado = espec.tipo === 'columnas-apiladas';
  const formato = espec.series[0].formato;

  const datasets = espec.series.map((serie) => ({
    label: serie.nombre,
    data: serie.valores,
    backgroundColor: estilo.series[serie.clave],
    maxBarThickness: 28,
    // marcas finas: el extremo del dato redondeado, anclado a la línea base; apiladas, un hueco de 2 px de superficie
    ...(apilado
      ? { borderColor: estilo.superficie, borderWidth: 2 }
      : { borderRadius: 4, borderSkipped: 'start' as const }),
  }));

  const ejeValores = {
    beginAtZero: true,
    ...(formato === 'porcentaje' ? { min: 0, max: 1 } : {}),
    ...(apilado ? { stacked: true } : {}),
    grid: { color: estilo.rejilla, lineWidth: 1 },
    border: { color: estilo.eje, display: false },
    ticks: {
      color: estilo.texto,
      ...(formato === 'entero' ? { precision: 0 } : {}),
      callback: (valor: string | number): string => formatearValor(Number(valor), formato),
    },
  };
  const ejeCategorias = {
    ...(apilado ? { stacked: true } : {}),
    grid: { display: false },
    border: { color: estilo.eje },
    ticks: { color: estilo.texto, autoSkip: true, maxRotation: 0 },
  };

  return {
    type: 'bar',
    data: { labels: espec.etiquetas, datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      animation: estilo.sinAnimacion ? false : undefined,
      scales: horizontal
        ? { x: ejeValores, y: ejeCategorias }
        : { x: ejeCategorias, y: ejeValores },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => espec.etiquetasLargas[items[0].dataIndex],
            label: (item) => {
              const serie = espec.series[item.datasetIndex];
              return `${serie.nombre}: ${formatearValor(serie.valores[item.dataIndex], serie.formato)}`;
            },
          },
        },
      },
    },
  };
}
