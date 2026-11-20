// Guarda contra colores literales: ningun componente debe llevar colores fijos, todo sale de los tokens de
// src/styles/_tema.scss. Uso (desde vibora-frontend): npm run test:colores
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, buscarColores, escanear } from './colores.mjs';

const hay = (texto, extension) => buscarColores(texto, extension).length > 0;
const tipos = (texto, extension) => buscarColores(texto, extension).map((h) => h.tipo);

test('SCSS: detecta hexadecimales de 3, 4, 6 y 8 digitos, en mayusculas o minusculas', () => {
  for (const valor of ['#fff', '#FFFA', '#2a78d6', '#2A78D6FF']) {
    assert.ok(hay(`.a { color: ${valor}; }`, '.scss'), valor);
  }
});

test('SCSS: detecta funciones de color con literales', () => {
  for (const valor of [
    'rgb(1, 2, 3)',
    'rgba(0 0 0 / 50%)',
    'hsl(10 20% 30%)',
    'hsla(10, 20%, 30%, 0.5)',
    'oklch(70% 0.2 120)',
    'light-dark(#fff, #000)',
    'color(srgb 1 0 0)',
  ]) {
    assert.ok(hay(`.a { background: ${valor}; }`, '.scss'), valor);
  }
});

test('SCSS: detecta colores con nombre en propiedades de color, tambien en abreviaturas', () => {
  assert.ok(hay('.a { color: white; }', '.scss'));
  assert.ok(hay('.a { background-color: Black; }', '.scss'));
  assert.ok(hay('.a { border: 1px solid red; }', '.scss'));
  assert.ok(hay('.a { box-shadow: 0 1px 2px rebeccapurple; }', '.scss'));
  assert.ok(hay('.a { fill: crimson; }', '.scss'));
  assert.ok(hay('.a { --mi-color: tomato; }', '.scss'));
  assert.ok(hay('$rojo: red;', '.scss'));
});

test('SCSS: detecta paletas y funciones de color de Material fuera de los tokens', () => {
  assert.ok(hay("@use '@angular/material' as mat;\n.a { --x: #{mat.$azure-palette}; }", '.scss'));
  assert.ok(hay('html { @include mat.theme((color: (primary: mat.$violet-palette))); }', '.scss'));
});

test('SCSS: detecta colores dentro de un data URI', () => {
  assert.ok(
    hay('.a { background: url("data:image/svg+xml,<svg fill=\'%23ff0000\'/>"); }', '.scss'),
  );
});

test('SCSS: un hexadecimal dentro de un mapa de Sass tambien cuenta', () => {
  assert.ok(hay('@include mat.theme-overrides((surface: #0b0c0a,\n primary: #d4f25a));', '.scss'));
});

test('SCSS: NO confunde selectores de id ni at-rules con colores', () => {
  for (const css of [
    '#add { color: var(--mat-sys-primary); }',
    '#face .x, #fade { margin: 0; }',
    'a#bad:hover { margin: 0; }',
    '#cafe {\n  padding: 0;\n}',
    '@if $x == 1 { .a { margin: 0; } }',
    '.a { margin: 0 !important; }',
    '.red { margin: 0; }',
    '.white-space { margin: 0; }',
  ]) {
    assert.deepEqual(buscarColores(css, '.scss'), [], css);
  }
});

test('SCSS: NO marca tokens, palabras clave ni propiedades que contienen un color en el nombre', () => {
  for (const css of [
    '.a { color: var(--mat-sys-primary); }',
    '.a { background: var(--mat-sys-surface, var(--mat-sys-surface-container)); }',
    '.a { border: 1px solid var(--mat-sys-outline-variant); }',
    '.a { background: transparent; color: inherit; border-color: currentColor; }',
    '.a { white-space: nowrap; }',
    '.a { box-shadow: var(--mat-sys-level2); outline: 2px solid var(--mat-sys-primary); }',
    '.a { --mat-chip-label-text-color: var(--mat-sys-on-error); }',
    '.a { fill: none; background: none; }',
    '.a { color: color-mix(in srgb, var(--mat-sys-primary) 40%, transparent); }',
    'html { @include mat.theme((typography: Roboto, density: 0)); }',
  ]) {
    assert.deepEqual(buscarColores(css, '.scss'), [], css);
  }
});

test('ignora los colores que solo aparecen en comentarios', () => {
  assert.deepEqual(
    buscarColores('/* antes era #fff */\n// y rgb(0,0,0)\n.a { margin: 0; }', '.scss'),
    [],
  );
  assert.deepEqual(buscarColores('<!-- #fff -->\n<p>hola</p>', '.html'), []);
  assert.deepEqual(buscarColores('// #fff rojo\nconst a = 1; /* rgb(0,0,0) */', '.ts'), []);
});

test('HTML: detecta colores en atributos style, bindings de estilo y atributos de dibujo', () => {
  assert.ok(hay('<p style="color: red">x</p>', '.html'));
  assert.ok(hay('<p style="background:#fff">x</p>', '.html'));
  assert.ok(hay('<p [style.color]="\'#ff0000\'">x</p>', '.html'));
  assert.ok(hay("<p [style.background-color]=\"activo ? 'white' : 'black'\">x</p>", '.html'));
  assert.ok(hay('<p [ngStyle]="{ color: \'red\' }">x</p>', '.html'));
  assert.ok(hay('<svg><path fill="white" /></svg>', '.html'));
  assert.ok(hay('<svg><path stroke="#000" /></svg>', '.html'));
  assert.ok(hay('<p style="color: rgb(1, 2, 3)">x</p>', '.html'));
  assert.ok(hay('<style>.a { color: red; }</style>', '.html'));
});

test('HTML: NO marca anclas, ids, control de flujo ni el atributo color de Material', () => {
  for (const html of [
    '<a href="#cabeza">ir</a>',
    '<a [routerLink]="[\'/x\']" fragment="face">ir</a>',
    '<div id="add" class="red white"></div>',
    '@if (a) { <p>x</p> } @else { <p>y</p> }',
    '<mat-toolbar color="primary"></mat-toolbar>',
    '<button mat-button color="warn">x</button>',
    '<p style="margin: 0; white-space: nowrap">x</p>',
    '<p [style.color]="\'var(--mat-sys-error)\'">x</p>',
    '<svg><path fill="currentColor" /></svg>',
  ]) {
    assert.deepEqual(buscarColores(html, '.html'), [], html);
  }
});

test('TS: detecta cadenas de color hexadecimal, funciones y colores con nombre bajo una clave de color', () => {
  assert.ok(hay("const A = { serie1: '#2a78d6' };", '.ts'));
  assert.ok(hay('const A = "#FFF";', '.ts'));
  assert.ok(hay("const A = 'light-dark(#c4c6d0, #44474e)';", '.ts'));
  assert.ok(hay("el.style.color = 'rgb(1, 2, 3)';", '.ts'));
  assert.ok(hay("const o = { backgroundColor: 'white' };", '.ts'));
  assert.ok(hay('const o = { borderColor: "black" };', '.ts'));
  assert.ok(hay("el.style.setProperty('color', 'red');", '.ts'));
  assert.ok(hay("el.style.backgroundColor = 'tomato';", '.ts'));
});

test('TS: detecta colores dentro de estilos en linea de un componente', () => {
  assert.ok(hay('@Component({ styles: `.a { color: #123456; }` })\nclass A {}', '.ts'));
  assert.ok(hay('@Component({ template: `<p style="color: red">x</p>` })\nclass A {}', '.ts'));
});

test('TS: NO marca ids, texto, comparaciones ni tokens', () => {
  for (const ts of [
    "const el = document.querySelector('#main');",
    "const url = 'https://example.com/#cabeza';",
    "const nombre = 'red';",
    "const rojo = 'Se ha puesto en red';",
    "if (color === 'primary') { return; }",
    "el.style.color = 'var(--mat-sys-error)';",
    "const x = css.getPropertyValue('--viz-serie-1');",
    'const r = /light-dark\\(|var\\(|color-mix\\(/.test(valor);',
    'const a = { fill: "both" };',
  ]) {
    assert.deepEqual(buscarColores(ts, '.ts'), [], ts);
  }
});

test('un color plantado en un componente se detecta en el escaneo, y desaparece al quitarlo', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'colores-'));
  try {
    mkdirSync(join(raiz, 'src', 'app'), { recursive: true });
    const archivo = join(raiz, 'src', 'app', 'plantado.scss');

    writeFileSync(archivo, '.a { color: var(--mat-sys-primary); }\n');
    assert.deepEqual(escanear(raiz, []), []);

    writeFileSync(archivo, '.a { color: var(--mat-sys-primary); }\n.b { color: #ff00aa; }\n');
    const hallazgos = escanear(raiz, []);
    assert.equal(hallazgos.length, 1);
    assert.equal(hallazgos[0].archivo, 'src/app/plantado.scss');
    assert.equal(hallazgos[0].linea, 2);

    writeFileSync(archivo, '.a { color: var(--mat-sys-primary); }\n');
    assert.deepEqual(escanear(raiz, []), []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('la lista de excepciones evita un archivo concreto y solo ese', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'colores-'));
  try {
    mkdirSync(join(raiz, 'src', 'styles'), { recursive: true });
    writeFileSync(join(raiz, 'src', 'styles', '_tema.scss'), 'html { --x: #fff; }\n');
    writeFileSync(join(raiz, 'src', 'styles', '_otro.scss'), 'html { --x: #fff; }\n');
    const hallazgos = escanear(raiz, ['src/styles/_tema.scss']);
    assert.deepEqual(
      hallazgos.map((h) => h.archivo),
      ['src/styles/_otro.scss'],
    );
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('la lista de excepciones real solo contiene los archivos de tokens y los specs', () => {
  assert.deepEqual(ALLOWLIST, [
    'src/styles/_tema.scss',
    'src/styles/_theme-colors.scss',
    /\.spec\.ts$/,
  ]);
});

test('el codigo de la aplicacion no lleva ningun color literal fuera de la lista de excepciones', () => {
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const hallazgos = escanear(raiz, ALLOWLIST);
  assert.deepEqual(
    hallazgos.map((h) => `${h.archivo}:${h.linea} [${h.tipo}] ${h.texto}`),
    [],
  );
});
