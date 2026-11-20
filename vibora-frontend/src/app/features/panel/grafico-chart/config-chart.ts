import type { ChartConfiguration } from 'chart.js';
import { ClaveSerie, EspecGrafico, formatearValor } from '../mapeo';

/** Colores y preferencias con las que se pinta un gráfico (se leen del CSS en tiempo de ejecución). */
export interface EstiloGrafico {
  series: Record<ClaveSerie, string>;
  texto: string;
  rejilla: string;
  eje: string;
  superficie: string;
  tooltipFondo: string;
  tooltipTexto: string;
  tooltipBorde: string;
  sinAnimacion: boolean;
}

/**
 * Último recurso si ni siquiera el elemento tiene color calculado: el color de texto del sistema. Los colores de los
 * gráficos viven en los tokens `--viz-*` de styles/_tema.scss (uno por tema); aquí no hay ninguno escrito.
 */
const RESERVA_SISTEMA = 'CanvasText';

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
 * Lee los colores de las variables CSS `--viz-*` del elemento (así cada tema solo cambia el CSS) y la preferencia
 * `prefers-reduced-motion`. Si falta una variable se usa el color de texto calculado del elemento (el del tema activo).
 */
export function leerEstilo(elemento: HTMLElement): EstiloGrafico {
  const css = getComputedStyle(elemento);
  const base = css.color ? css.color : RESERVA_SISTEMA;
  const variable = (nombre: string): string => {
    const valor = css.getPropertyValue(nombre).trim();
    return valor === '' ? base : resolverColor(elemento, valor, base);
  };
  const sinAnimacion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    series: {
      serie1: variable('--viz-serie-1'),
      serie2: variable('--viz-serie-2'),
    },
    texto: variable('--viz-texto'),
    rejilla: variable('--viz-rejilla'),
    eje: variable('--viz-eje'),
    superficie: variable('--viz-superficie'),
    tooltipFondo: variable('--viz-tooltip-fondo'),
    tooltipTexto: variable('--viz-tooltip-texto'),
    tooltipBorde: variable('--viz-tooltip-borde'),
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
          // sin esto Chart.js pinta negro al 80 % con texto blanco, ajeno al tema (apenas se separa de la tarjeta oscura)
          backgroundColor: estilo.tooltipFondo,
          titleColor: estilo.tooltipTexto,
          bodyColor: estilo.tooltipTexto,
          borderColor: estilo.tooltipBorde,
          borderWidth: 1,
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
