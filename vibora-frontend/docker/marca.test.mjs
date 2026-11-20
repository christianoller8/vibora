// Pruebas de la identidad de marca: iconos de la pestana, theme-color y la animacion de arranque del logo.
// Uso: node --test docker/marca.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const ruta = (r) => `${raiz}${r}`;
const leer = (r) => readFileSync(ruta(r), 'utf8');
const HTML = leer('src/index.html');
const TEMA = leer('src/styles/_tema.scss');

/** Valor de un token de Material en un bloque de tema: `background: #0b0c0a,` -> `#0b0c0a`. */
function token(bloqueInicio, nombre) {
  const desde = TEMA.indexOf(bloqueInicio);
  assert.ok(desde >= 0, `no existe el bloque ${bloqueInicio}`);
  const m = new RegExp(`(?<![\\w-])${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(TEMA.slice(desde));
  assert.ok(m, `no existe ${nombre} en ${bloqueInicio}`);
  return m[1].toLowerCase();
}

const etiquetas = (nombre) =>
  [...HTML.matchAll(new RegExp(`<${nombre}\\b[^>]*>`, 'g'))].map((m) => m[0]);
const atributo = (etiqueta, nombre) => new RegExp(`\\b${nombre}="([^"]*)"`).exec(etiqueta)?.[1];

test('index.html declara el favicon SVG, el PNG de 32, el .ico y el apple-touch-icon', () => {
  const links = etiquetas('link');
  const icono = (pred) => links.find((l) => pred(l));
  const svg = icono(
    (l) => atributo(l, 'rel') === 'icon' && atributo(l, 'type') === 'image/svg+xml',
  );
  assert.equal(atributo(svg ?? '', 'href'), 'favicon.svg');
  const png = icono((l) => atributo(l, 'rel') === 'icon' && atributo(l, 'type') === 'image/png');
  assert.equal(atributo(png ?? '', 'href'), 'favicon-32.png');
  assert.equal(atributo(png ?? '', 'sizes'), '32x32');
  const ico = icono(
    (l) => atributo(l, 'rel') === 'icon' && /\.ico$/.test(atributo(l, 'href') ?? ''),
  );
  assert.equal(atributo(ico ?? '', 'href'), 'favicon.ico');
  const apple = icono((l) => atributo(l, 'rel') === 'apple-touch-icon');
  assert.equal(atributo(apple ?? '', 'href'), 'apple-touch-icon.png');
  assert.equal(atributo(apple ?? '', 'sizes'), '180x180');
});

test('un solo theme-color, sin media (la app es oscura por defecto, no sigue al sistema), con los fondos de los tokens', () => {
  const metas = etiquetas('meta').filter((m) => atributo(m, 'name') === 'theme-color');
  assert.equal(metas.length, 1);
  assert.equal(atributo(metas[0], 'media'), undefined, 'sin media: el tema lo decide la app');
  const oscuro = token("html:not([data-theme='light'])", 'background');
  const claro = token("html[data-theme='light']", 'background');
  // el valor inicial es el del tema por defecto (oscuro); tema-inicial.js y TemaService leen de aqui el de cada tema
  assert.equal(atributo(metas[0], 'content')?.toLowerCase(), oscuro);
  assert.equal(atributo(metas[0], 'data-oscuro')?.toLowerCase(), oscuro);
  assert.equal(atributo(metas[0], 'data-claro')?.toLowerCase(), claro);
});

test('color-scheme declara oscuro y el theme-color va antes del script que lo actualiza', () => {
  const esquema = etiquetas('meta').find((m) => atributo(m, 'name') === 'color-scheme');
  assert.equal(atributo(esquema ?? '', 'content'), 'dark');
  assert.ok(HTML.indexOf('name="theme-color"') < HTML.indexOf('tema-inicial.js'));
});

test('los iconos existen y tienen las medidas anunciadas', () => {
  for (const f of ['favicon.svg', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png']) {
    assert.ok(existsSync(ruta(`public/${f}`)), `falta public/${f}`);
  }
  const dimensiones = (f) => {
    const b = readFileSync(ruta(`public/${f}`));
    assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${f} no es PNG`);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(dimensiones('favicon-32.png'), [32, 32]);
  assert.deepEqual(dimensiones('apple-touch-icon.png'), [180, 180]);

  const ico = readFileSync(ruta('public/favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const n = ico.readUInt16LE(4);
  const tamanos = Array.from({ length: n }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(tamanos, [16, 32, 48]);
});

test('favicon.svg usa la misma geometria que el componente y colores de los tokens', () => {
  const svg = leer('public/favicon.svg');
  const plantilla = leer('src/app/shared/components/logo/logo.html');
  const trazos = [...plantilla.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(trazos.length, 3, 'la marca son 2 colmillos y 1 escama');
  for (const d of trazos) {
    assert.ok(svg.includes(`d="${d}"`), `favicon.svg no contiene el trazo ${d}`);
  }
  const colores = [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
  const permitidos = [
    token("html:not([data-theme='light'])", 'primary'),
    token("html:not([data-theme='light'])", 'background'),
  ];
  assert.ok(colores.length >= 2);
  for (const c of colores) {
    assert.ok(permitidos.includes(c), `color ${c} fuera de los tokens`);
  }
  assert.ok(
    !/<(script|image|style)\b/.test(svg),
    'el favicon no lleva scripts, imagenes ni estilos',
  );
});

test('la animacion del logo dura 700 ms como maximo y se desactiva con prefers-reduced-motion', () => {
  const css = leer('src/app/shared/components/logo/logo.scss');
  const declaraciones = [...css.matchAll(/animation:\s*([^;]+);/g)]
    .map((m) => m[1])
    .filter((v) => v.trim() !== 'none');
  assert.ok(declaraciones.length >= 3, 'diamante, colmillos y nombre se animan');
  for (const d of declaraciones) {
    const [duracion, retraso = '0ms'] = [...d.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
    assert.ok(duracion + Number(retraso) <= 700, `animacion de mas de 700 ms: ${d}`);
    assert.ok(
      /\bbackwards\b/.test(d),
      'solo "backwards": al acabar el elemento queda en su estado normal',
    );
    assert.ok(!/\binfinite\b/.test(d));
  }
  const reducido = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\n\})\s*\n/.exec(
    css,
  );
  assert.ok(reducido, 'falta la media query prefers-reduced-motion: reduce');
  assert.match(reducido[1], /animation:\s*none/);
  assert.match(reducido[1], /\.animado/);
});

test('la animacion es solo CSS (sin setTimeout ni Web Animations) y no bloquea la interaccion', () => {
  const ts = leer('src/app/shared/components/logo/logo.ts');
  assert.ok(!/setTimeout|requestAnimationFrame|\.animate\(/.test(ts));
});
