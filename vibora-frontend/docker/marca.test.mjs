// Pruebas de la identidad de marca: iconos de la pestana, theme-color y la animacion de arranque del logo.
// Uso: node --test docker/marca.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const ruta = (r) => `${raiz}${r}`;
const leer = (r) => readFileSync(ruta(r), 'utf8');
const HTML = leer('src/index.html');
const TEMA = leer('src/styles/_tema.scss');

/** Valor de un token de Material en un bloque de tema: `background: #1c2124,` -> `#1c2124`. */
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
  // paleta carbón + lima (DESIGN.md): página oscura y gris suave clara
  assert.equal(oscuro, '#1c2124');
  assert.equal(claro, '#ecedea');
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

/** Decodifica un PNG de 8 bits (RGB o RGBA, sin entrelazado) y devuelve su ancho, alto y una función de píxel [r, g, b, a]. */
function decodificarPng(b) {
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'no es PNG');
  let pos = 8;
  let ancho = 0;
  let alto = 0;
  let tipoColor = 0;
  const datos = [];
  while (pos < b.length) {
    const largo = b.readUInt32BE(pos);
    const tipo = b.toString('latin1', pos + 4, pos + 8);
    const cuerpo = b.subarray(pos + 8, pos + 8 + largo);
    if (tipo === 'IHDR') {
      ancho = cuerpo.readUInt32BE(0);
      alto = cuerpo.readUInt32BE(4);
      tipoColor = cuerpo[9];
      assert.equal(cuerpo[8], 8, 'solo 8 bits por canal');
      assert.equal(cuerpo[12], 0, 'sin entrelazado');
    }
    if (tipo === 'IDAT') datos.push(cuerpo);
    pos += 12 + largo;
  }
  assert.ok(tipoColor === 2 || tipoColor === 6, 'solo RGB o RGBA');
  const bpp = tipoColor === 6 ? 4 : 3;
  const crudo = inflateSync(Buffer.concat(datos));
  const fila = ancho * bpp;
  const pixeles = Buffer.alloc(fila * alto);
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[y * (fila + 1)];
    for (let i = 0; i < fila; i++) {
      const x = crudo[y * (fila + 1) + 1 + i];
      const izq = i >= bpp ? pixeles[y * fila + i - bpp] : 0;
      const arr = y > 0 ? pixeles[(y - 1) * fila + i] : 0;
      const arrIzq = y > 0 && i >= bpp ? pixeles[(y - 1) * fila + i - bpp] : 0;
      const paeth = () => {
        const p = izq + arr - arrIzq;
        const [pa, pb, pc] = [Math.abs(p - izq), Math.abs(p - arr), Math.abs(p - arrIzq)];
        return pa <= pb && pa <= pc ? izq : pb <= pc ? arr : arrIzq;
      };
      const previo = [0, izq, arr, (izq + arr) >> 1, paeth()][filtro];
      pixeles[y * fila + i] = (x + previo) & 255;
    }
  }
  const pixel = (x, y) => {
    const o = y * fila + x * bpp;
    return [pixeles[o], pixeles[o + 1], pixeles[o + 2], bpp === 4 ? pixeles[o + 3] : 255];
  };
  return { ancho, alto, pixel };
}

const hex = ([r, g, b]) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

test('los iconos rasterizados usan el color de la baldosa del favicon.svg (no el de una paleta antigua)', () => {
  const baldosa = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(leer('public/favicon.svg'))?.[1].toLowerCase();
  assert.equal(baldosa, token("html:not([data-theme='light'])", 'background'));
  // Las esquinas son redondeadas (casi transparentes); el color de la baldosa se lee en el borde superior, al centro.
  const comprobar = (png, etiqueta) => {
    assert.ok(png.pixel(0, 0)[3] < 128, `${etiqueta}: la esquina redondeada debe quedar casi transparente`);
    const [r, g, b, a] = png.pixel(png.ancho >> 1, 1);
    assert.equal(hex([r, g, b]), baldosa, `${etiqueta}: color de la baldosa`);
    assert.equal(a, 255, `${etiqueta}: baldosa opaca`);
  };
  comprobar(decodificarPng(readFileSync(ruta('public/favicon-32.png'))), 'favicon-32.png');
  comprobar(decodificarPng(readFileSync(ruta('public/apple-touch-icon.png'))), 'apple-touch-icon.png');

  const ico = readFileSync(ruta('public/favicon.ico'));
  const n = ico.readUInt16LE(4);
  assert.equal(n, 3);
  for (let i = 0; i < n; i++) {
    const lado = ico[6 + i * 16] || 256;
    const largo = ico.readUInt32LE(6 + i * 16 + 8);
    const desde = ico.readUInt32LE(6 + i * 16 + 12);
    const png = decodificarPng(ico.subarray(desde, desde + largo));
    assert.deepEqual([png.ancho, png.alto], [lado, lado], `favicon.ico: entrada de ${lado}`);
    comprobar(png, `favicon.ico ${lado}`);
  }
});
