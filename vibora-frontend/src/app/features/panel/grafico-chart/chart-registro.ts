/*
 * Único sitio que importa Chart.js, y solo se carga con `import()` dinámico (ver cargador-chart.ts). Se registra
 * SOLO lo que usan los tres gráficos del panel (barras con eje de categorías y eje lineal, y tooltip): nunca
 * `chart.js/auto`, que registra todo y multiplica el tamaño del chunk.
 */
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export { Chart };
