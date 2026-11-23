// Pruebas del script bloqueante que aplica el tema antes del primer pintado. Uso: node --test docker/tema-inicial.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { construirPolitica } from './csp.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const leer = (ruta) => readFileSync(`${raiz}${ruta}`, 'utf8');
const SCRIPT = leer('public/tema-inicial.js');

const META_HTML = /<meta\b[^>]*\bname="theme-color"[^>]*>/.exec(leer('src/index.html'))?.[0] ?? '';
const dato = (nombre) => new RegExp(`\\b${nombre}="([^"]*)"`).exec(META_HTML)?.[1];
const OSCURO = dato('data-oscuro');
const CLARO = dato('data-claro');

/**
 * Ejecuta el script con un documento y un localStorage falsos y devuelve lo que dejó en <html> y en el meta
 * theme-color (que arranca tal como está en index.html).
 */
function ejecutar({
  guardado,
  almacenamientoLanza = false,
  accesoLanza = false,
  sinMeta = false,
} = {}) {
  const atributos = {};
  const estilo = {};
  const meta = { content: dato('content'), 'data-oscuro': OSCURO, 'data-claro': CLARO };
  const contexto = {
    document: {
      documentElement: {
        setAttribute: (nombre, valor) => (atributos[nombre] = valor),
        style: estilo,
      },
      querySelector: (selector) =>
        !sinMeta && selector === 'meta[name="theme-color"]'
          ? {
              getAttribute: (nombre) => meta[nombre] ?? null,
              setAttribute: (nombre, valor) => (meta[nombre] = valor),
            }
          : null,
    },
  };
  Object.defineProperty(contexto, 'localStorage', {
    get() {
      if (accesoLanza) {
        throw new Error('SecurityError');
      }
      return {
        getItem: (clave) => {
          if (almacenamientoLanza) {
            throw new Error('bloqueado');
          }
          assert.equal(clave, 'vibora.tema');
          return guardado ?? null;
        },
      };
    },
  });
  vm.runInNewContext(SCRIPT, contexto);
  return {
    tema: atributos['data-theme'],
    colorScheme: estilo.colorScheme,
    themeColor: meta.content,
  };
}

const OSC = { tema: 'dark', colorScheme: 'dark', themeColor: OSCURO };
const CLA = { tema: 'light', colorScheme: 'light', themeColor: CLARO };

test('sin elección guardada aplica el tema oscuro', () => {
  assert.deepEqual(ejecutar(), OSC);
});

test('aplica la elección guardada', () => {
  assert.deepEqual(ejecutar({ guardado: 'light' }), CLA);
  assert.deepEqual(ejecutar({ guardado: 'dark' }), OSC);
});

test('un valor guardado que no es un tema se ignora', () => {
  assert.deepEqual(ejecutar({ guardado: 'solarizado' }), OSC);
});

test('si localStorage lanza (al leer o al acceder) aplica el oscuro y no propaga el error', () => {
  assert.deepEqual(ejecutar({ almacenamientoLanza: true }), OSC);
  assert.deepEqual(ejecutar({ accesoLanza: true }), OSC);
});

test('el theme-color del navegador sigue al tema elegido y no al del sistema operativo', () => {
  assert.ok(OSCURO && CLARO && OSCURO !== CLARO, 'index.html lleva un color por tema');
  assert.equal(OSCURO.toLowerCase(), '#1c2124', 'sin destello del color antiguo en oscuro');
  assert.equal(CLARO.toLowerCase(), '#ecedea', 'sin destello del color antiguo en claro');
  assert.equal(ejecutar({ guardado: 'light' }).themeColor, CLARO);
  assert.equal(ejecutar({ guardado: 'dark' }).themeColor, OSCURO);
  assert.equal(ejecutar().themeColor, OSCURO);
});

test('sin meta theme-color el script sigue aplicando el tema y no lanza', () => {
  const r = ejecutar({ guardado: 'light', sinMeta: true });
  assert.equal(r.tema, 'light');
  assert.equal(r.colorScheme, 'light');
});

test('usa la misma clave de almacenamiento que el TemaService', () => {
  const servicio = leer('src/app/core/tema/tema.service.ts');
  const clave = /CLAVE_TEMA = '([^']+)'/.exec(servicio)?.[1];
  assert.equal(clave, 'vibora.tema');
  assert.ok(SCRIPT.includes(`'${clave}'`));
});

test('index.html lo carga como script externo, bloqueante, antes de las hojas de estilo', () => {
  const html = leer('src/index.html');
  const etiqueta = /<script\b[^>]*\bsrc="tema-inicial\.js"[^>]*><\/script>/.exec(html);
  assert.ok(etiqueta, 'falta <script src="tema-inicial.js"> en index.html');
  assert.ok(!/\b(async|defer|type=)/.test(etiqueta[0]), 'debe ser un script clasico y bloqueante');
  const cabecera = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.ok(cabecera.includes(etiqueta[0]), 'debe estar en <head>');
  const primeraHoja = html.indexOf('<link');
  assert.ok(html.indexOf(etiqueta[0]) < primeraHoja, 'debe ir antes de cualquier <link>');
});

test('con la CSP de produccion el script externo no necesita hash ni unsafe-inline', () => {
  const html = leer('src/index.html');
  const politica = construirPolitica(html);
  const scriptSrc = politica.split('; ').find((d) => d.startsWith('script-src'));
  assert.equal(scriptSrc, "script-src 'self'");
  assert.ok(!/<script>/.test(html), 'index.html no debe llevar scripts en linea');
});

test('el script no contiene colores ni depende de nada externo', () => {
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(SCRIPT));
  assert.ok(!/\b(fetch|XMLHttpRequest|import|eval)\b/.test(SCRIPT));
});
