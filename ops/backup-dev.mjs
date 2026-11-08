#!/usr/bin/env node
// Copia de seguridad del entorno de DESARROLLO (docker compose): base de datos y volumen de fotos subidas.
//
//   node ops/backup-dev.mjs [--out <carpeta>]        (por defecto ./backups)
//
// Genera en <carpeta>:
//   vibora-<fecha>.sql.gz            pg_dump (formato SQL, solo lectura sobre la base) del contenedor vibora-postgres
//   vibora-uploads-<fecha>.tar.gz    contenido del volumen vibora_vibora-uploads (si existe; si no, se omite con un aviso)
// No sobrescribe nunca un fichero existente y no necesita dependencias (solo Node, Docker y el contenedor en marcha).
//
// RESTAURAR (en una base vacia o desechable; el volcado incluye CREATE TABLE y los datos):
//   gunzip -c backups/vibora-<fecha>.sql.gz | docker exec -i vibora-postgres psql -U vibora -d vibora -v ON_ERROR_STOP=1
//   (Windows sin gunzip: node -e "process.stdout.write(require('zlib').gunzipSync(require('fs').readFileSync(process.argv[1])))" backups/vibora-<fecha>.sql.gz | docker exec -i vibora-postgres psql -U vibora -d vibora)
// Fotos: docker run --rm -v vibora_vibora-uploads:/d -v "<carpeta absoluta>:/o:ro" alpine tar xzf /o/vibora-uploads-<fecha>.tar.gz -C /d

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';

// Sobrescribibles por entorno (para pruebas del camino de error); por defecto, el entorno de desarrollo de compose.
const CONTENEDOR = process.env.VIBORA_BACKUP_CONTENEDOR || 'vibora-postgres';
const BASE_DE_DATOS = process.env.VIBORA_BACKUP_BD || 'vibora';
const USUARIO_BD = process.env.VIBORA_BACKUP_USUARIO || 'vibora';
const VOLUMEN = 'vibora_vibora-uploads';

function fallo(mensaje) {
  console.error(`ERROR: ${mensaje}`);
  process.exit(1);
}

function argumentos() {
  const a = process.argv.slice(2);
  let out = 'backups';
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--out') {
      out = a[++i];
      if (!out) fallo('--out necesita una carpeta');
    } else {
      fallo(`argumento desconocido: ${a[i]}\nUso: node ops/backup-dev.mjs [--out <carpeta>]`);
    }
  }
  return path.resolve(out);
}

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

function tamano(fichero) {
  const bytes = fs.statSync(fichero).size;
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function marca() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const out = argumentos();
const fecha = marca();
const sql = path.join(out, `vibora-${fecha}.sql.gz`);
const fotos = path.join(out, `vibora-uploads-${fecha}.tar.gz`);
for (const f of [sql, fotos]) {
  if (fs.existsSync(f)) fallo(`${f} ya existe; no se sobrescribe (espera un segundo o usa otra carpeta)`);
}

const estado = docker(['inspect', '-f', '{{.State.Running}}', CONTENEDOR]);
if (estado.status !== 0 || estado.stdout.trim() !== 'true') {
  fallo(`el contenedor ${CONTENEDOR} no está en marcha (docker compose up -d db)`);
}
fs.mkdirSync(out, { recursive: true });

// 1) Base de datos: pg_dump -> gzip (zlib de Node) -> fichero. wx = falla si existe.
// Exito = el fichero se ha escrito y cerrado Y pg_dump ha terminado con codigo 0. Se esperan AMBAS cosas (sin
// cortocircuitar en el primer fallo, para no borrar el fichero con el flujo aun abierto): un volcado truncado
// (pg_dump muerto a medias) cierra el fichero igual que uno completo, y solo el codigo de salida los distingue.
{
  const dump = spawn('docker', ['exec', CONTENEDOR, 'pg_dump', '-U', USUARIO_BD, '-d', BASE_DE_DATOS, '--no-owner'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errores = '';
  dump.stderr.on('data', (c) => (errores += c));
  const escrito = pipeline(dump.stdout, zlib.createGzip({ level: 9 }), fs.createWriteStream(sql, { flags: 'wx' }));
  const terminado = new Promise((resolve, reject) => {
    dump.on('error', reject); // docker no se pudo lanzar
    dump.on('close', (codigo, senal) =>
      codigo === 0 ? resolve() : reject(new Error(`pg_dump terminó con código ${codigo ?? senal}: ${errores.trim()}`)));
  });
  const resultados = await Promise.allSettled([escrito, terminado]);
  const fallido = resultados.find((r) => r.status === 'rejected');
  if (fallido) {
    fs.rmSync(sql, { force: true });
    fallo(fallido.reason.message);
  }
}
console.log(`Base de datos : ${sql} (${tamano(sql)})`);

// 2) Fotos: el volumen se monta en solo lectura en un contenedor desechable que hace el tar
const volumen = docker(['volume', 'inspect', VOLUMEN]);
if (volumen.status !== 0) {
  console.log(`Fotos         : el volumen ${VOLUMEN} no existe; se omite (nadie ha subido fotos en este entorno)`);
} else {
  const tar = docker([
    'run', '--rm',
    '-v', `${VOLUMEN}:/d:ro`,
    '-v', `${out}:/o`,
    'alpine', 'tar', 'czf', `/o/${path.basename(fotos)}`, '-C', '/d', '.',
  ]);
  if (tar.status !== 0) fallo(`no se pudo archivar el volumen ${VOLUMEN}: ${tar.stderr.trim()}`);
  console.log(`Fotos         : ${fotos} (${tamano(fotos)})`);
}
console.log('Hecho. Restauración: ver la cabecera de este script.');
