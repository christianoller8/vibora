// Detector de colores literales en scss/html/ts. Lo usa scripts/colores.test.mjs (npm run test:colores).
//
// Regla: los colores viven SOLO en src/styles/_tema.scss (tokens de los dos temas) y en la paleta generada
// _theme-colors.scss. Todo lo demas usa `var(--mat-sys-*)` o los tokens `--app-*` / `--viz-*`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Archivos exentos: las definiciones de tokens y los specs (datos de prueba, no estilos). Ruta exacta o RegExp. */
export const ALLOWLIST = ['src/styles/_tema.scss', 'src/styles/_theme-colors.scss', /\.spec\.ts$/];

const EXTENSIONES = new Set(['.scss', '.css', '.html', '.ts']);

// `transparent`, `currentcolor` y las palabras globales NO son colores literales: no estan en la lista.
const NOMBRES = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
   cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
   darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
   darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
   firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
   hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
   lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
   lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
   mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
   midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
   palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
   rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
   slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
   whitesmoke yellow yellowgreen`.split(/\s+/),
);

/** Propiedades CSS cuyo valor puede llevar un color. Las propiedades personalizadas (--x) y las variables Sass ($x) tambien. */
const PROPIEDAD_COLOR =
  /^(color|background|background-color|background-image|border|border-(top|right|bottom|left|inline|block)(-(start|end))?|border(-(top|right|bottom|left|inline|block)(-(start|end))?)?-color|outline|outline-color|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration|text-decoration-color|column-rule|column-rule-color|scrollbar-color|stop-color|flood-color|lighting-color|filter|mask-image)$/;

/** Claves de objeto / propiedades de `element.style` de TypeScript que llevan un color. */
const CLAVE_TS =
  '(?:[a-zA-Z]*Color|color|background|border|outline|fill|stroke|boxShadow|textShadow|shadowColor|stopColor|floodColor)';

/** Atributos HTML/SVG cuyo valor es un color. */
const ATRIBUTO_COLOR =
  /^(?:\[attr\.)?(fill|stroke|color|bgcolor|stop-color|flood-color|lighting-color|text|link|vlink|alink)\]?$/;

function blanquear(fragmento) {
  return fragmento.replace(/[^\n]/g, ' ');
}

/** Quita los comentarios sin mover nada de sitio (se sustituyen por espacios) para conservar los numeros de linea. */
function quitarComentarios(texto, extension) {
  let t = texto.replace(/\/\*[\s\S]*?\*\//g, blanquear);
  if (extension === '.html') {
    t = t.replace(/<!--[\s\S]*?-->/g, blanquear);
  } else {
    t = t.replace(
      /(^|[^:\\'"`])\/\/[^\n]*/g,
      (m, previo) => previo + blanquear(m.slice(previo.length)),
    );
  }
  return t;
}

/** Palabras de un valor que son nombres de color; ignora lo que va dentro de var(), url() y las cadenas. */
function nombresDeColor(valor, { conservarCadenas = false } = {}) {
  let v = valor;
  for (let i = 0; i < 4; i += 1) {
    v = v.replace(/var\([^()]*\)/gi, ' ');
  }
  v = v.replace(/url\([^)]*\)/gi, ' ');
  if (!conservarCadenas) {
    v = v.replace(/"[^"]*"|'[^']*'/g, ' ');
  }
  return [...v.matchAll(/(?<![\w$.#%-])([a-z]+)(?![\w(-])/gi)]
    .map((m) => ({ nombre: m[1].toLowerCase(), indice: m.index }))
    .filter((p) => NOMBRES.has(p.nombre));
}

const HEX = /(?<![\w&#$-])#([0-9a-fA-F]{3,8})(?![\w-])/g;
const FUNCION =
  /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*(?!var\(|from\s)|(?<![\w-])color\(\s*(srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz)/gi;
const PALETA = /\bmat\.(\$[\w-]+-palette|m2-define-[\w-]+|define-[\w-]*palette)/g;
const DATA_URI = /%23[0-9a-fA-F]{3,8}(?![\w-])/g;

/** Escanea un trozo de texto buscando hexadecimales validos (3, 4, 6 u 8 digitos) fuera de selectores. */
function buscarHex(s, base, hallazgos, { esScss }) {
  for (const m of s.matchAll(HEX)) {
    if (![3, 4, 6, 8].includes(m[1].length)) {
      continue;
    }
    if (esScss) {
      // un selector de id como `#add {` o `#face .x {` no es un color: la sentencia acaba en `{`
      const ini = Math.max(
        s.lastIndexOf(';', m.index),
        s.lastIndexOf('{', m.index),
        s.lastIndexOf('}', m.index),
      );
      const fin = [s.indexOf(';', m.index), s.indexOf('{', m.index), s.indexOf('}', m.index)]
        .filter((i) => i >= 0)
        .reduce((a, b) => Math.min(a, b), Infinity);
      const sentencia = s.slice(ini + 1, Number.isFinite(fin) ? fin : s.length);
      if (s[fin] === '{' && !/^\s*@include/.test(sentencia)) {
        continue;
      }
    }
    hallazgos.push({ tipo: 'hex', indice: base + m.index, texto: m[0] });
  }
}

function buscarFunciones(s, base, hallazgos) {
  for (const m of s.matchAll(FUNCION)) {
    hallazgos.push({ tipo: 'funcion', indice: base + m.index, texto: m[0] });
  }
}

/** Declaraciones `propiedad: valor` de CSS (en un .scss, en un <style>, en un style="" o en un template de TS). */
function buscarNombresEnDeclaraciones(s, base, hallazgos) {
  const re = /(?<![\w$-])(--[\w-]+|\$[\w-]+|[a-z][a-z-]*)\s*:\s*([^;{}]+)(?=[;}])/gi;
  for (const m of s.matchAll(re)) {
    const nombre = m[1].toLowerCase();
    if (!(nombre.startsWith('--') || nombre.startsWith('$') || PROPIEDAD_COLOR.test(nombre))) {
      continue;
    }
    const inicioValor = m.index + m[0].length - m[2].length;
    for (const p of nombresDeColor(m[2])) {
      hallazgos.push({ tipo: 'nombre', indice: base + inicioValor + p.indice, texto: p.nombre });
    }
  }
}

/** Atributos HTML con color: style, bindings de estilo, [ngStyle] y atributos de dibujo SVG. */
function buscarEnAtributos(s, base, hallazgos) {
  const re = /([\[(]?[\w.:-]+[\])]?)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const m of s.matchAll(re)) {
    const nombre = m[1];
    const valor = m[2] ?? m[3];
    const inicio = base + m.index + m[0].length - valor.length - 1;
    if (nombre === 'style') {
      buscarHex(valor, inicio, hallazgos, { esScss: false });
      buscarFunciones(valor, inicio, hallazgos);
      buscarNombresEnDeclaraciones(`${valor};`, inicio, hallazgos);
    } else if (/^\[style(\.|\])/.test(nombre) || nombre === '[ngStyle]') {
      buscarHex(valor, inicio, hallazgos, { esScss: false });
      buscarFunciones(valor, inicio, hallazgos);
      for (const p of nombresDeColor(valor, { conservarCadenas: true })) {
        hallazgos.push({ tipo: 'nombre', indice: inicio + p.indice, texto: p.nombre });
      }
    } else if (ATRIBUTO_COLOR.test(nombre)) {
      buscarHex(valor, inicio, hallazgos, { esScss: false });
      for (const p of nombresDeColor(valor, { conservarCadenas: true })) {
        hallazgos.push({ tipo: 'nombre', indice: inicio + p.indice, texto: p.nombre });
      }
    }
  }
}

/** TypeScript: cadenas que son un color entero, claves de color con valor literal y estilos en linea de plantillas. */
function buscarEnTs(t, hallazgos) {
  for (const m of t.matchAll(/(['"`])\s*(#[0-9a-fA-F]{3,8})\s*\1/g)) {
    if ([4, 5, 7, 9].includes(m[2].length)) {
      hallazgos.push({ tipo: 'hex', indice: m.index, texto: m[2] });
    }
  }
  // hexadecimal como argumento de una funcion CSS dentro de una cadena: `light-dark(#fff, #000)`, `linear-gradient(...)`
  for (const m of t.matchAll(/(?<=[(,]\s{0,3})#([0-9a-fA-F]{3,8})(?![\w-])/g)) {
    if ([3, 4, 6, 8].includes(m[1].length)) {
      hallazgos.push({ tipo: 'hex', indice: m.index, texto: m[0] });
    }
  }
  const clave = new RegExp(`(?<![\\w$-])${CLAVE_TS}\\s*[:=]\\s*(['"\`])([^'"\`\\n]*)\\1`, 'g');
  for (const m of t.matchAll(clave)) {
    const valor = m[2];
    const inicio = m.index + m[0].length - valor.length - 1;
    buscarHex(valor, inicio, hallazgos, { esScss: false });
    buscarFunciones(valor, inicio, hallazgos);
    for (const p of nombresDeColor(valor, { conservarCadenas: true })) {
      hallazgos.push({ tipo: 'nombre', indice: inicio + p.indice, texto: p.nombre });
    }
  }
  const setProperty =
    /setProperty\(\s*(['"])(color|background(?:-color)?|border[\w-]*|outline[\w-]*|fill|stroke|--[\w-]+)\1\s*,\s*(['"`])([^'"`\n]*)\3/g;
  for (const m of t.matchAll(setProperty)) {
    const inicio = m.index + m[0].length - m[4].length - 1;
    buscarHex(m[4], inicio, hallazgos, { esScss: false });
    buscarFunciones(m[4], inicio, hallazgos);
    for (const p of nombresDeColor(m[4], { conservarCadenas: true })) {
      hallazgos.push({ tipo: 'nombre', indice: inicio + p.indice, texto: p.nombre });
    }
  }
  // estilos y plantillas dentro de un template literal (`styles: \`...\``, `template: \`...\``)
  for (const m of t.matchAll(/`([^`]*)`/g)) {
    const base = m.index + 1;
    if (/[:]\s*[^;{}]+[;}]/.test(m[1])) {
      buscarHex(m[1], base, hallazgos, { esScss: true });
      buscarNombresEnDeclaraciones(m[1], base, hallazgos);
    }
    if (/<[a-z][^>]*=/.test(m[1])) {
      buscarEnAtributos(m[1], base, hallazgos);
    }
  }
}

/** Devuelve los colores literales de un texto: `[{ linea, texto, tipo }]`, ordenados por linea. */
export function buscarColores(texto, extension) {
  const t = quitarComentarios(texto, extension);
  const bruto = [];

  for (const m of t.matchAll(PALETA)) {
    bruto.push({ tipo: 'paleta', indice: m.index, texto: m[0] });
  }
  for (const m of t.matchAll(DATA_URI)) {
    bruto.push({ tipo: 'datauri', indice: m.index, texto: m[0] });
  }

  if (extension === '.scss' || extension === '.css') {
    buscarHex(t, 0, bruto, { esScss: true });
    buscarFunciones(t, 0, bruto);
    buscarNombresEnDeclaraciones(t, 0, bruto);
  } else if (extension === '.html') {
    buscarFunciones(t, 0, bruto);
    buscarEnAtributos(t, 0, bruto);
    for (const m of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      buscarHex(m[1], m.index + m[0].indexOf(m[1]), bruto, { esScss: true });
      buscarNombresEnDeclaraciones(m[1], m.index + m[0].indexOf(m[1]), bruto);
    }
  } else {
    buscarFunciones(t, 0, bruto);
    buscarEnTs(t, bruto);
  }

  const vistos = new Set();
  const lineas = texto.split('\n');
  return bruto
    .filter((h) => {
      const clave = `${h.tipo}:${h.indice}`;
      return vistos.has(clave) ? false : (vistos.add(clave), true);
    })
    .map((h) => {
      const linea = texto.slice(0, h.indice).split('\n').length;
      return { linea, tipo: h.tipo, texto: `${h.texto} :: ${lineas[linea - 1].trim()}` };
    })
    .sort((a, b) => a.linea - b.linea);
}

function archivos(dir, acumulado = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      archivos(ruta, acumulado);
    } else if (EXTENSIONES.has(extname(nombre))) {
      acumulado.push(ruta);
    }
  }
  return acumulado;
}

function exento(rutaRelativa, excepciones) {
  return excepciones.some((e) => (e instanceof RegExp ? e.test(rutaRelativa) : e === rutaRelativa));
}

/** Escanea `<raiz>/src` y devuelve `[{ archivo, linea, tipo, texto }]` de los archivos no exentos. */
export function escanear(raiz, excepciones) {
  const resultado = [];
  for (const ruta of archivos(join(raiz, 'src'))) {
    const relativa = ruta.slice(raiz.length).replace(/\\/g, '/').replace(/^\//, '');
    if (exento(relativa, excepciones)) {
      continue;
    }
    for (const h of buscarColores(readFileSync(ruta, 'utf8'), extname(ruta))) {
      resultado.push({ archivo: relativa, ...h });
    }
  }
  return resultado;
}
