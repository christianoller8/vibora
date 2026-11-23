// Photo guard: every .webp in public/fotos/ must be credited (by base name) in both READMEs and weigh at most 250 KB.
// Usage (from vibora-frontend): npm run test:fotos
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 250 * 1024;
const carpeta = fileURLToPath(new URL('../public/fotos/', import.meta.url));
const readmes = ['README.md', 'README.es.md'].map((nombre) => ({
  nombre,
  texto: readFileSync(fileURLToPath(new URL(`../../${nombre}`, import.meta.url)), 'utf8'),
}));
const fotos = readdirSync(carpeta).filter((f) => f.endsWith('.webp'));
// pista-aerea-1280.webp -> pista-aerea
const base = (f) => f.replace(/-\d+\.webp$/, '');

test('there are photos to guard', () => {
  assert.ok(fotos.length > 0, 'public/fotos/ has no .webp files');
});

for (const foto of fotos) {
  test(`${foto} weighs at most 250 KB`, () => {
    const bytes = statSync(`${carpeta}${foto}`).size;
    assert.ok(bytes <= MAX_BYTES, `${foto} is ${bytes} bytes (max ${MAX_BYTES})`);
  });

  for (const { nombre, texto } of readmes) {
    test(`${foto} is credited in ${nombre}`, () => {
      assert.ok(texto.includes(`\`${base(foto)}\``), `${nombre} has no credit for \`${base(foto)}\``);
    });
  }
}
