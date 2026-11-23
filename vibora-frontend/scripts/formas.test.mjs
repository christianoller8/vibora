// Guarda de las formas (DESIGN.md, "Radii and spacing" y "Components"): radios --r-*, esquinas de Material, tarjetas,
// botones de 44 px, foco de 2 px y la barra superior en píldora. Lee los SCSS tal cual (no compila Sass).
// Uso (desde vibora-frontend): npm run test:formas
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const leer = (ruta) => readFileSync(`${raiz}${ruta}`, 'utf8');
const TEMA = leer('src/styles/_tema.scss');
const AUTH = leer('src/app/core/layout/auth-layout/auth-layout.scss');
const LAYOUT = leer('src/app/core/layout/main-layout/main-layout.scss');
const LAYOUT_TS = leer('src/app/core/layout/main-layout/main-layout.ts');
const BARRA = leer('src/styles/_barra.scss');
const STYLES = leer('src/styles.scss');

/** Cuerpo de la primera regla `selector { ... }` (llaves emparejadas). */
function regla(texto, selector) {
  const inicio = texto.indexOf(`${selector} {`);
  assert.ok(inicio >= 0, `no se encuentra la regla ${selector}`);
  let profundidad = 0;
  for (let i = inicio + selector.length + 1; i < texto.length; i++) {
    if (texto[i] === '{') profundidad++;
    if (texto[i] === '}' && --profundidad === 0) return texto.slice(inicio, i + 1);
  }
  return assert.fail(`regla sin cerrar: ${selector}`);
}

/**
 * Argumentos de la primera llamada `@include nombre( ... )` (paréntesis emparejados). Acota cada aserción a su propio
 * `@include`: un `border-width: 2px` suelto en otro sitio no puede dar por bueno el anillo de foco.
 */
function incluir(texto, nombre) {
  const apertura = `@include ${nombre}(`;
  const inicio = texto.indexOf(apertura);
  assert.ok(inicio >= 0, `no se encuentra @include ${nombre}`);
  let profundidad = 0;
  for (let i = inicio + apertura.length - 1; i < texto.length; i++) {
    if (texto[i] === '(') profundidad++;
    if (texto[i] === ')' && --profundidad === 0) return texto.slice(inicio + apertura.length, i);
  }
  return assert.fail(`@include sin cerrar: ${nombre}`);
}

test('radios --r-*: valores de DESIGN.md definidos en html', () => {
  const esperado = { sm: '10px', md: '16px', lg: '20px', xl: '24px', hero: '32px', pill: '999px' };
  for (const [n, v] of Object.entries(esperado)) {
    assert.match(TEMA, new RegExp(`--r-${n}:\\s*${v};`), `--r-${n} debe ser ${v}`);
  }
});

test('esquinas de Material: small 10, medium 16, large 20 y extra-large 32', () => {
  const esquinas = { small: '10px', medium: '16px', large: '20px', 'extra-large': '32px' };
  for (const [n, v] of Object.entries(esquinas)) {
    assert.match(TEMA, new RegExp(`corner-${n}:\\s*${v},`), `corner-${n} debe ser ${v}`);
  }
  assert.equal([...TEMA.matchAll(/corner-[\w-]+:/g)].length, 4, 'solo los cuatro corner-*');
});

test('la tarjeta de login y registro se queda en 28 px mediante --r-auth, no mediante corner-extra-large', () => {
  assert.match(TEMA, /--r-auth:\s*28px;/, '--r-auth debe fijar los 28 px de la tarjeta de acceso');
  const tarjeta = regla(AUTH, '.tarjeta');
  assert.match(tarjeta, /border-radius:\s*var\(--r-auth\)/);
  assert.ok(!AUTH.includes('corner-extra-large'), 'auth-layout no puede depender de corner-extra-large');
});

test('tarjetas: radio --r-lg, superficie de tarjeta y contorno fino outline-variant; sin sombra pesada', () => {
  const tarjetas = incluir(TEMA, 'mat.card-overrides');
  assert.match(tarjetas, /outlined-container-shape:\s*var\(--r-lg\)/);
  assert.match(tarjetas, /elevated-container-shape:\s*var\(--r-lg\)/);
  assert.match(tarjetas, /outlined-container-color:\s*var\(--app-tarjeta\)/);
  assert.match(tarjetas, /elevated-container-color:\s*var\(--app-tarjeta\)/);
  assert.match(tarjetas, /outlined-outline-color:\s*var\(--mat-sys-outline-variant\)/);
});

test('--app-tarjeta existe en los dos temas (paso de superficie respecto a la página)', () => {
  assert.match(TEMA, /--app-tarjeta:\s*var\(--mat-sys-surface-container\);/);
  assert.match(TEMA, /--app-tarjeta:\s*var\(--mat-sys-surface-container-low\);/);
});

const ALTO_APP = 'html:has(app-main-layout)';

test('diálogos a --r-md y botones de 44 px como mínimo en la aplicación, con el foco de 2 px', () => {
  assert.match(incluir(TEMA, 'mat.dialog-overrides'), /container-shape:\s*var\(--r-md\)/);
  const botones = incluir(regla(TEMA, ALTO_APP), 'mat.button-overrides');
  for (const tipo of ['filled', 'outlined', 'text', 'tonal', 'protected']) {
    assert.match(botones, new RegExp(`${tipo}-container-height:\\s*44px`), `botón ${tipo}`);
  }
  // el último bloque html:has(app-main-layout) es el del anillo de foco (el primero lleva los botones)
  const bloqueApp = regla(TEMA.slice(TEMA.lastIndexOf(`${ALTO_APP} {`)), ALTO_APP);
  const focoApp = incluir(bloqueApp, 'mat.strong-focus-indicators');
  assert.match(focoApp, /border-width:\s*2px/, 'el anillo de foco es de 2 px en la aplicación');
  assert.match(focoApp, /border-color:\s*var\(--app-foco\)/, 'el anillo de foco usa --app-foco');
});

test('el anillo de foco de 2 px no es global: login y registro conservan los 3 px de Material', () => {
  const global = incluir(TEMA, 'mat.strong-focus-indicators'); // el primero, el de `html`
  assert.match(global, /border-color:\s*var\(--app-foco\)/, 'el anillo global usa --app-foco');
  assert.ok(!/border-width/.test(global), 'el anillo global no fija el grosor (Material: 3 px)');
  const antes = TEMA.slice(0, TEMA.indexOf('@include mat.strong-focus-indicators('));
  assert.match(antes, /html\s*\{\s*(\/\/[^\n]*\s*)*$/, 'el primer anillo cuelga de `html`, sin acotar');
  assert.equal(
    [...TEMA.matchAll(/border-width:\s*2px/g)].length,
    1,
    'el grosor de 2 px aparece una sola vez: la regla acotada a la aplicación',
  );
});

test('los botones de login y registro conservan los 40 px de Material: el alto de 44 px solo vale en la aplicación', () => {
  // ninguna altura de botón fuera de la regla acotada a la carcasa de la aplicación
  const total = [...TEMA.matchAll(/container-height:\s*44px/g)].length;
  const acotadas = [...regla(TEMA, ALTO_APP).matchAll(/container-height:\s*44px/g)].length;
  assert.equal(total, acotadas, 'hay alturas de botón de 44 px fuera de la regla de la aplicación');
  assert.ok(!/html\s*\{[^{}]*container-height/.test(TEMA), 'no hay override global de altura de botón');
  // ni el layout de acceso toca el alto de los botones
  assert.ok(!/container-height/.test(AUTH), 'auth-layout no puede fijar el alto de los botones');
});

test('barra superior: píldora de 56 px, activo en lima y colapso a menú en móvil (<= 720 px)', () => {
  assert.match(TEMA, /--app-alto-pildora:\s*56px;/, 'el alto de la píldora es un token');
  const barra = regla(LAYOUT, '.barra');
  assert.match(barra, /height:\s*var\(--app-alto-pildora\)/);
  assert.ok(!/\b56px/.test(LAYOUT), 'el alto de la píldora sale del token, no de un literal');
  assert.match(barra, /min-width:\s*0/, 'la barra puede estrecharse por debajo de sus hijos');
  assert.match(barra, /background:\s*var\(--app-fondo-barra\)/);
  assert.ok(!/color-mix/.test(LAYOUT), 'la mezcla de color de la barra vive en _tema.scss');
  assert.match(TEMA, /--app-fondo-barra:\s*color-mix\(in srgb,\s*var\(--app-tarjeta\)\s*94%,\s*transparent\);/);
  assert.match(barra, /border-radius:\s*var\(--r-pill\)/);
  const enlace = regla(LAYOUT, '.enlace');
  assert.match(enlace, /min-height:\s*44px/);
  assert.match(enlace, /border-radius:\s*var\(--r-pill\)/);
  const activo = regla(LAYOUT, '.enlace.activo');
  assert.match(activo, /background:\s*var\(--app-lima\)/);
  assert.match(activo, /color:\s*var\(--app-sobre-lima\)/);
  // la lima de relleno es el primario en el oscuro y el contenedor primario en el claro (DESIGN.md)
  assert.match(TEMA, /--app-lima:\s*var\(--mat-sys-primary\);/);
  assert.match(TEMA, /--app-lima:\s*var\(--mat-sys-primary-container\);/);
  assert.match(LAYOUT, /max-width:\s*720px/, 'el colapso a menú es a 720 px');
  // el componente decide móvil con el mismo punto de corte que el SCSS
  assert.match(
    LAYOUT_TS,
    /PUNTO_DE_CORTE_MOVIL\s*=\s*'\(max-width:\s*720px\)'/,
    'main-layout.ts y main-layout.scss deben usar el mismo punto de corte de 720 px',
  );
  assert.ok(!/999px/.test(LAYOUT), 'las píldoras usan --r-pill, no un literal');
});

test('barra superior: el activo solo se pinta como píldora lima en la barra y el menú móvil, sin regla .activo genérica', () => {
  assert.ok(!/^\.activo\s*\{/m.test(LAYOUT), 'la regla .activo debe acotarse a .menu');
  assert.ok(!/^(app-main-layout )?\.activo\s*\{/m.test(BARRA), 'la regla .activo debe acotarse a .menu');
  assert.match(
    regla(BARRA, 'app-main-layout .menu .activo'),
    /--mat-list-list-item-container-color:\s*var\(--app-lima\)/,
  );
});

test('barra superior: el menú móvil y el difuminado viven en styles/_barra.scss, acotados a app-main-layout y con tokens', () => {
  assert.match(STYLES, /@use 'styles\/barra';/, 'styles.scss carga la parcial de la barra');
  // ningún selector de la parcial queda sin acotar (salvo @property, @keyframes y los pasos del keyframe)
  const sueltos = BARRA.split('\n').filter((l) => /^\.[\w-]+/.test(l) || /^\s+\.(menu|enlaces)/.test(l));
  assert.deepEqual(sueltos, [], 'todo selector de _barra.scss cuelga de app-main-layout');
  for (const s of ['.menu', '.menu mat-nav-list', '.menu-usuario', '.menu-nombre', '.menu-rol']) {
    assert.ok(BARRA.includes(`app-main-layout ${s} {`), `falta app-main-layout ${s}`);
  }
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(BARRA), 'los colores son referencias a tokens, no literales');
  // y esas reglas ya no están en el SCSS del componente
  for (const s of ['.menu', '.menu-usuario', '.menu-nombre', '.menu-rol', '.menu .activo']) {
    assert.ok(!LAYOUT.includes(`${s} {`), `${s} no debe duplicarse en main-layout.scss`);
  }
  assert.ok(!/@keyframes|@property/.test(LAYOUT), 'el difuminado no se duplica en el componente');
});

test('main-layout.ts: el desplazamiento de la lista no usa llamada opcional (scrollTo existe en los navegadores soportados)', () => {
  assert.ok(!/scrollTo\?\./.test(LAYOUT_TS), 'lista.scrollTo(...) sin `?.`');
});

test('barra superior: logo fijo, foco hacia dentro y margen de la lista bajo el difuminado', () => {
  const logo = regla(LAYOUT, '.logo');
  // el logo nunca cede ancho (si no, "VÍBORA" se recorta a "VÍBOR"); la que cede es la lista de enlaces
  assert.match(logo, /flex:\s*none/, 'el logo no se encoge');
  assert.ok(!/overflow:\s*hidden/.test(logo), 'el logo no recorta su texto');
  const enlaces = regla(LAYOUT, '.enlaces');
  assert.match(enlaces, /flex:\s*1 1 auto/, 'la lista cede el espacio');
  assert.match(enlaces, /min-width:\s*0/, 'la lista puede ser más estrecha que su contenido');
  // el margen de detención es al menos el ancho del difuminado (1.5rem)
  assert.match(enlaces, /scroll-padding-inline:\s*2rem/);
  assert.match(enlaces, /position:\s*relative/, 'offsetParent de los enlaces: mostrarSiActivo usa offsetLeft');
  assert.match(regla(LAYOUT, '.enlace:focus-visible'), /outline-offset:\s*-2px/, 'el anillo cabe dentro del scroller');
  assert.ok(!/outline:/.test(regla(LAYOUT, '.enlace:focus-visible')), 'el color del anillo sigue siendo el global');
});

test('barra superior: desbordamiento visible, foco no tapado por la barra fija y alto dinámico', () => {
  const enlaces = regla(LAYOUT, '.enlaces');
  assert.match(enlaces, /overflow-x:\s*auto/);
  assert.ok(!/scrollbar-width:\s*none/.test(LAYOUT), 'la barra de desplazamiento no se oculta');
  assert.match(enlaces, /scrollbar-width:\s*thin/);
  assert.match(BARRA, /mask-image/, 'el borde se difumina cuando la lista desborda');
  assert.match(LAYOUT, /scroll-padding-top:\s*var\(--app-alto-barra\)/, 'WCAG 2.4.11');
  assert.match(
    TEMA,
    /--app-alto-barra:\s*calc\(var\(--app-alto-pildora\)\s*\+\s*2\s*\*\s*var\(--app-marco-barra\)\);/,
    'el alto de la barra se calcula a partir de la píldora y su marco',
  );
  assert.match(regla(LAYOUT, '.marco-barra'), /padding:\s*var\(--app-marco-barra\)/);
  assert.match(regla(LAYOUT, '.marco-barra'), /background:\s*var\(--mat-sys-surface\)/);
  assert.match(regla(LAYOUT, '.contenedor'), /height:\s*100dvh/);
  // nombre y rol visibles hasta 900 px; por debajo van en el menú móvil
  assert.match(LAYOUT, /@media \(max-width:\s*899px\)\s*\{\s*\.usuario,\s*\.rol\s*\{\s*display:\s*none/);
});
