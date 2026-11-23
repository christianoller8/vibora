// Guarda de la paleta (DESIGN.md): valores clave de los dos temas y contraste WCAG de los pares que importan.
// Lee src/styles/_tema.scss tal cual (no compila Sass). Uso (desde vibora-frontend): npm run test:paleta
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const TEMA = readFileSync(`${raiz}src/styles/_tema.scss`, 'utf8');

/**
 * Bloque de CSS entero (con sus llaves) que abre el selector indicado. Si el selector se repite (`html {`), se queda con
 * el primero cuyo cuerpo contiene `contiene`. Emparejar llaves evita depender de comentarios o del orden del archivo.
 */
function bloque(selector, contiene = '') {
  const apertura = `${selector} {`;
  let desde = TEMA.indexOf(apertura);
  while (desde >= 0) {
    let profundidad = 0;
    let fin = -1;
    for (let i = desde + apertura.length - 1; i < TEMA.length; i++) {
      if (TEMA[i] === '{') profundidad++;
      if (TEMA[i] === '}' && --profundidad === 0) {
        fin = i + 1;
        break;
      }
    }
    assert.ok(fin > desde, `bloque sin cerrar: ${selector}`);
    const cuerpo = TEMA.slice(desde, fin);
    if (cuerpo.includes(contiene)) return cuerpo;
    desde = TEMA.indexOf(apertura, fin);
  }
  return assert.fail(`no se encuentra el bloque ${selector} que contenga ${contiene}`);
}

const OSCURO = bloque("html:not([data-theme='light'])");
const CLARO = bloque("html[data-theme='light']");
const MARCA = bloque('html', '--marca-fondo');

/** Valor hexadecimal de un token (`primary: #xxxxxx` o `--app-foco: #xxxxxx`) dentro de un bloque. */
function t(bloqueTema, nombre) {
  const m = new RegExp(`(?<![\\w-])${nombre}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(bloqueTema);
  assert.ok(m, `falta el token ${nombre}`);
  return m[1].toLowerCase();
}

function luminancia(hex) {
  const canal = (i) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function exigir(bloqueTema, pares, minimo, etiqueta) {
  for (const [fg, bg] of pares) {
    const colorFg = fg.startsWith('#') ? fg : t(bloqueTema, fg);
    const colorBg = bg.startsWith('#') ? bg : t(bloqueTema, bg);
    const r = contraste(colorFg, colorBg);
    assert.ok(r >= minimo, `${etiqueta}: ${fg} (${colorFg}) sobre ${bg} (${colorBg}) = ${r.toFixed(2)} < ${minimo}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Valores exactos (DESIGN.md, "Mapping to _tema.scss")
// ---------------------------------------------------------------------------------------------------------------
test('oscuro: superficies, texto y contornos del carbon con tinte frio', () => {
  const esperado = {
    background: '#1c2124',
    surface: '#1c2124',
    'surface-container-lowest': '#171c1f',
    'surface-container-low': '#20262a',
    'surface-container': '#262c30',
    'surface-container-high': '#2f363b',
    'surface-container-highest': '#384046',
    'on-surface': '#f1f3ee',
    'on-surface-variant': '#a9b2b7',
    outline: '#78838a',
    'outline-variant': '#363d42',
    primary: '#d4f25a',
    'on-primary': '#161b00',
    'inverse-surface': '#e8ebe6',
    'inverse-on-surface': '#1c2124',
    'inverse-primary': '#4a5a00',
    '--app-foco': '#d4f25a',
    '--app-info': '#7fd0c4',
    '--app-info-contenedor': '#0f3f3a',
    '--app-sobre-info-contenedor': '#c4f0e8',
    '--app-sobre-info': '#06231f',
    '--app-pale': '#e2f37a',
    '--app-sobre-pale': '#1c2124',
    '--app-bloque': '#171c1f',
    '--app-sobre-bloque': '#f1f3ee',
    '--viz-serie-1': '#d4f25a',
    '--viz-serie-2': '#f0834a',
    '--viz-serie-3': '#5cc7b5',
    '--viz-serie-4': '#a9b2b7',
  };
  for (const [nombre, valor] of Object.entries(esperado)) {
    assert.equal(t(OSCURO, nombre), valor, `oscuro ${nombre}`);
  }
  ['#2a3410', '#46590f', '#a6c93a', '#d4f25a', '#e2f37a'].forEach((v, i) =>
    assert.equal(t(OSCURO, `--viz-calor-${i}`), v, `oscuro calor ${i}`),
  );
  ['#ffffff', '#ffffff', '#161b00', '#161b00', '#1c2124'].forEach((v, i) =>
    assert.equal(t(OSCURO, `--viz-calor-texto-${i}`), v, `oscuro calor texto ${i}`),
  );
});

test('claro: gris suave, tarjetas blancas, oliva para el texto y lima solo como relleno', () => {
  const esperado = {
    background: '#ecedea',
    surface: '#ecedea',
    'surface-container-lowest': '#ffffff',
    'surface-container-low': '#ffffff',
    'surface-container': '#f5f6f3',
    'surface-container-high': '#e2e4e0',
    'surface-container-highest': '#d9dcd7',
    'surface-variant': '#e2e4e0',
    'surface-dim': '#d9dcd7',
    'on-surface': '#1c2124',
    'on-surface-variant': '#4a5358',
    outline: '#6b7378',
    'outline-variant': '#cbcfcb',
    primary: '#4a5a00',
    'surface-tint': '#4a5a00',
    'primary-container': '#d4f25a',
    'on-primary-container': '#1c2124',
    'secondary-container': '#b8c093',
    'on-secondary-container': '#1c2124',
    'inverse-surface': '#1c2124',
    'inverse-on-surface': '#f1f3ee',
    'inverse-primary': '#d4f25a',
    error: '#b3261e',
    '--app-foco': '#4a5a00',
    '--app-info': '#1b6b63',
    '--app-info-contenedor': '#c4eee8',
    '--app-sobre-info-contenedor': '#00201d',
    '--app-pale': '#e2f37a',
    '--app-sobre-pale': '#1c2124',
    '--app-bloque': '#1c2124',
    '--app-sobre-bloque': '#f1f3ee',
    '--viz-serie-1': '#5e7000',
    '--viz-serie-2': '#c2501c',
    '--viz-serie-3': '#1b7a6e',
    '--viz-serie-4': '#5e676c',
  };
  for (const [nombre, valor] of Object.entries(esperado)) {
    assert.equal(t(CLARO, nombre), valor, `claro ${nombre}`);
  }
  ['#eaf3bd', '#cfe57a', '#9dbb2e', '#5e7000', '#33400a'].forEach((v, i) =>
    assert.equal(t(CLARO, `--viz-calor-${i}`), v, `claro calor ${i}`),
  );
  ['#161b00', '#161b00', '#161b00', '#ffffff', '#ffffff'].forEach((v, i) =>
    assert.equal(t(CLARO, `--viz-calor-texto-${i}`), v, `claro calor texto ${i}`),
  );
});

test('claro: los botones rellenos usan la lima del contenedor primario con texto carbon', () => {
  const m = /mat\.button-overrides\(([\s\S]*?)\n\s*\)\s*\n?\s*\);/.exec(CLARO);
  assert.ok(m, 'falta mat.button-overrides en el tema claro');
  assert.match(m[1], /filled-container-color:\s*var\(--mat-sys-primary-container\)/);
  assert.match(m[1], /filled-label-text-color:\s*var\(--mat-sys-on-primary-container\)/);
  assert.ok(!OSCURO.includes('mat.button-overrides'), 'el oscuro usa los botones de Material tal cual');
});

test('el panel de marca sigue oscuro en ambos temas con la base carbon', () => {
  assert.equal(t(MARCA, '--marca-fondo'), '#1c2124');
  assert.equal(t(MARCA, '--marca-texto'), '#f1f3ee');
  assert.equal(t(MARCA, '--marca-texto-suave'), '#a9b2b7');
  assert.equal(t(MARCA, '--marca-acento'), '#d4f25a');
  assert.ok(!TEMA.includes('--marca-degradado'), 'el degradado vuelve con la landing');
});

// ---------------------------------------------------------------------------------------------------------------
// Contraste
// ---------------------------------------------------------------------------------------------------------------
test('oscuro: texto sobre pagina, tarjeta y elevadas >= 4.5', () => {
  const fondos = ['surface', 'surface-container-low', 'surface-container', 'surface-container-high'];
  exigir(OSCURO, fondos.map((f) => ['on-surface', f]), 4.5, 'texto');
  exigir(OSCURO, fondos.map((f) => ['on-surface-variant', f]), 4.5, 'texto secundario');
  exigir(OSCURO, ['surface', 'surface-container'].map((f) => ['primary', f]), 4.5, 'acento lima');
});

test('oscuro: texto sobre lima, pale y bloques >= 4.5', () => {
  exigir(OSCURO, [['on-primary', 'primary'], ['--app-sobre-pale', '--app-pale'], ['--app-sobre-bloque', '--app-bloque']], 4.5, 'sobre relleno');
  exigir(OSCURO, [['on-primary-container', 'primary-container'], ['on-secondary-container', 'secondary-container'], ['on-error-container', 'error-container'], ['inverse-on-surface', 'inverse-surface']], 4.5, 'contenedores');
});

test('oscuro: contorno >= 3 en pagina, tarjeta y elevadas (dialogos, menus); foco >= 3', () => {
  exigir(OSCURO, ['surface', 'surface-container', 'surface-container-high'].map((f) => ['outline', f]), 3, 'contorno');
  exigir(OSCURO, ['surface', 'surface-container'].map((f) => ['--app-foco', f]), 3, 'foco');
});

test('oscuro: error y contenedor de error >= 4.5', () => {
  exigir(OSCURO, [['on-error', 'error'], ['on-error-container', 'error-container'], ['error', 'surface-container']], 4.5, 'error oscuro');
});

test('inverse-primary (accion del snackbar) >= 4.5 sobre inverse-surface en ambos temas', () => {
  exigir(OSCURO, [['inverse-primary', 'inverse-surface']], 4.5, 'accion del snackbar oscuro');
  exigir(CLARO, [['inverse-primary', 'inverse-surface']], 4.5, 'accion del snackbar claro');
});

test('oscuro: estados semanticos, series y escala de calor', () => {
  for (const e of ['exito', 'aviso', 'info']) {
    exigir(OSCURO, [[`--app-${e}`, 'surface-container'], [`--app-sobre-${e}`, `--app-${e}`], [`--app-sobre-${e}-contenedor`, `--app-${e}-contenedor`]], 4.5, e);
  }
  exigir(OSCURO, [1, 2, 3, 4].map((n) => [`--viz-serie-${n}`, 'surface-container']), 3, 'series');
  exigir(OSCURO, [0, 1, 2, 3, 4].map((n) => [`--viz-calor-texto-${n}`, `--viz-calor-${n}`]), 4.5, 'calor');
});

test('claro: texto sobre pagina, tarjeta y gris de slot ocupado >= 4.5', () => {
  const fondos = ['surface', 'surface-container-lowest', 'surface-container', 'surface-container-high'];
  exigir(CLARO, fondos.map((f) => ['on-surface', f]), 4.5, 'texto');
  exigir(CLARO, fondos.map((f) => ['on-surface-variant', f]), 4.5, 'texto secundario');
});

test('claro: el oliva de acento (enlaces, texto, foco) sobre pagina y tarjeta >= 4.5', () => {
  exigir(CLARO, ['surface', 'surface-container-lowest'].map((f) => ['primary', f]), 4.5, 'oliva');
  exigir(CLARO, ['surface', 'surface-container-lowest'].map((f) => ['--app-foco', f]), 4.5, 'foco');
});

test('claro: texto sobre lima, pale y bloque >= 4.5', () => {
  exigir(CLARO, [['on-primary', 'primary'], ['on-primary-container', 'primary-container'], ['on-secondary-container', 'secondary-container'], ['--app-sobre-pale', '--app-pale'], ['--app-sobre-bloque', '--app-bloque'], ['inverse-on-surface', 'inverse-surface'], ['on-error', 'error']], 4.5, 'sobre relleno');
  // la lima sobre el bloque carbon (acento) tambien lee como texto
  exigir(CLARO, [['primary-container', 'inverse-surface']], 4.5, 'lima sobre bloque');
});

test('claro: el contenedor secundario (tonal) se separa >= 1.4 de la lima rellena; el pale queda solo como token', () => {
  exigir(CLARO, [['primary-container', 'secondary-container']], 1.4, 'relleno frente a tonal');
  assert.notEqual(t(CLARO, 'secondary-container'), t(CLARO, '--app-pale'));
});

test('claro: contorno de controles >= 3 sobre pagina, tarjeta y elevadas', () => {
  exigir(CLARO, ['surface', 'surface-container-lowest', 'surface-container-high'].map((f) => ['outline', f]), 3, 'contorno');
});

test('claro: estados semanticos, series y escala de calor', () => {
  for (const e of ['exito', 'aviso', 'info']) {
    exigir(CLARO, [[`--app-${e}`, 'surface-container-lowest'], [`--app-sobre-${e}`, `--app-${e}`], [`--app-sobre-${e}-contenedor`, `--app-${e}-contenedor`]], 4.5, e);
  }
  exigir(CLARO, [['error', 'surface-container-lowest'], ['on-error-container', 'error-container']], 4.5, 'error');
  exigir(CLARO, [1, 2, 3, 4].map((n) => [`--viz-serie-${n}`, 'surface-container-lowest']), 4.5, 'series');
  exigir(CLARO, [0, 1, 2, 3, 4].map((n) => [`--viz-calor-texto-${n}`, `--viz-calor-${n}`]), 4.5, 'calor');
});

test('claro: la lima nunca es texto sobre fondo claro', () => {
  const LIMAS = new Set(['#d4f25a', '#e2f37a', '#eaf3bd', '#cfe57a']);
  for (const nombre of ['on-surface', 'on-background', 'on-surface-variant', 'primary', 'surface-tint', '--app-foco']) {
    assert.ok(!LIMAS.has(t(CLARO, nombre)), `claro ${nombre} no puede ser lima`);
  }
});

test('marca: texto, texto suave y acento sobre el fondo del panel >= 4.5', () => {
  exigir(MARCA, [['--marca-texto', '--marca-fondo'], ['--marca-texto-suave', '--marca-fondo'], ['--marca-acento', '--marca-fondo']], 4.5, 'marca');
});

// ---------------------------------------------------------------------------------------------------------------
// La paleta anterior no puede sobrevivir en ningun sitio
// ---------------------------------------------------------------------------------------------------------------
function archivosDeTexto(dir) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = `${dir}/${nombre}`;
    if (statSync(ruta).isDirectory()) salida.push(...archivosDeTexto(ruta));
    else if (/\.(ts|html|scss|css|js|mjs|json|svg|webmanifest|txt|md)$/i.test(nombre)) salida.push(ruta);
  }
  return salida;
}

test('los hex de la paleta anterior no aparecen en src ni en public', () => {
  const viejos = ['#0b0c0a', '#fafbf3', '#3987e5', '#546500', '#10120d'];
  const archivos = [...archivosDeTexto(`${raiz}src`), ...archivosDeTexto(`${raiz}public`)];
  assert.ok(archivos.length > 10, 'el escaneo debe encontrar los archivos');
  for (const f of archivos) {
    // La paleta tonal generada por Material (_theme-colors.scss) contiene los tonos matemáticos de la semilla; no son decisiones de diseño.
    if (f.endsWith('_theme-colors.scss')) continue;
    const texto = readFileSync(f, 'utf8').toLowerCase();
    for (const v of viejos) assert.ok(!texto.includes(v), `${f} conserva el color antiguo ${v}`);
  }
});
