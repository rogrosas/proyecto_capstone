/* =========================================================
   CAPA DE DATOS · Plantillas Word, contratos generados y firmados
   y escaneos de correspondencia.
   Las tablas guardan la ruta RELATIVA del archivo (ej.
   'generados/2026/LF-0152-2026.docx'); aquí se resuelve:

   - El contenido vive en la tabla archivos (easyoffice_v2_archivos.sql),
     así no se pierde cuando el servidor borra su disco (Render).
   - Si la ruta no está en la tabla, se lee de la carpeta de contratos
     (config.archivos.dir, la de git) y se copia a la tabla.
   - Si la base aún no tiene la tabla, todo funciona como antes: solo
     con la carpeta.
   Ninguna ruta puede salir de esa carpeta. Los permisos los revisan
   los servicios antes de llamar aquí.
   ========================================================= */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { archivos: cfg } = require('../config');
const { errores } = require('../comun/errores');
const { pool } = require('./conexion');

// 'generados/2026/LF-0152-2026.docx' -> ruta absoluta dentro de la carpeta (o error)
function absoluta(relativa) {
  const rel = String(relativa || '').replace(/\\/g, '/');
  const abs = path.resolve(cfg.dir, rel);
  if (!rel || path.isAbsolute(rel) || (abs !== cfg.dir && !abs.startsWith(cfg.dir + path.sep))) {
    throw errores.solicitudInvalida('Ruta de archivo no válida.');
  }
  return abs;
}

const relativa = (abs) => path.relative(cfg.dir, abs).split(path.sep).join('/');
// La clave en la tabla: relativa, con '/', sin './' ni '..'
const clave = (rel) => relativa(absoluta(rel));

/* ---- Tabla archivos (si la base aún no la tiene, se usa solo la carpeta) ---- */
const REINTENTO_MS = 60 * 1000;
let sinTablaHasta = 0;
let avisado = false;

// Resultado de la consulta, o null si la tabla no existe (se vuelve a probar en un minuto)
async function enBase(sql, params) {
  if (Date.now() < sinTablaHasta) return null;
  try {
    return await pool.query(sql, params);
  } catch (err) {
    if (err.code !== '42P01') throw err;
    sinTablaHasta = Date.now() + REINTENTO_MS;
    if (!avisado) {
      avisado = true;
      console.warn('[archivos] La base no tiene la tabla archivos (ejecute easyoffice_v2_archivos.sql): se usa solo la carpeta de contratos.');
    }
    return null;
  }
}

const huella = (contenido) => crypto.createHash('sha256').update(contenido).digest('hex');

function escribirEnBase(ruta, contenido, reemplazar) {
  const params = [ruta, contenido, contenido.length, huella(contenido)];
  return reemplazar
    ? enBase(`INSERT INTO archivos (ruta, contenido, bytes, sha256) VALUES ($1, $2, $3, $4)
              ON CONFLICT (ruta) DO UPDATE SET contenido = EXCLUDED.contenido, bytes = EXCLUDED.bytes,
                     sha256 = EXCLUDED.sha256, actualizado_en = now()
              RETURNING ruta`, params)
    : enBase(`INSERT INTO archivos (ruta, contenido, bytes, sha256) VALUES ($1, $2, $3, $4)
              ON CONFLICT (ruta) DO NOTHING RETURNING ruta`, params);
}

async function enCarpeta(abs) {
  try { await fs.access(abs); return true; } catch { return false; }
}

/* ---- API ---- */

async function leer(rel) {
  const ruta = clave(rel);
  const r = await enBase('SELECT contenido FROM archivos WHERE ruta = $1', [ruta]);
  if (r?.rows.length) return r.rows[0].contenido;

  let contenido;
  try {
    contenido = await fs.readFile(absoluta(ruta));
  } catch (err) {
    if (err.code === 'ENOENT') throw errores.noEncontrado(`No se encontró el archivo "${rel}".`);
    throw err;
  }
  // Estaba solo en la carpeta (ej. una plantilla de git): queda copiado en la base
  if (r) await escribirEnBase(ruta, contenido, false).catch((err) => console.warn(`[archivos] No se copió "${ruta}" a la base: ${err.message}`));
  return contenido;
}

async function existe(rel) {
  const ruta = clave(rel);
  const r = await enBase('SELECT 1 FROM archivos WHERE ruta = $1', [ruta]);
  return Boolean(r?.rows.length) || enCarpeta(absoluta(ruta));
}

async function guardar(rel, contenido, { reemplazar = true } = {}) {
  const ruta = clave(rel);
  const abs = absoluta(ruta);
  const yaExiste = () => errores.conflicto(`Ya existe "${rel}". Elija otro nombre o márquelo para reemplazar.`);
  if (!reemplazar && await enCarpeta(abs)) throw yaExiste();

  const r = await escribirEnBase(ruta, Buffer.from(contenido), reemplazar);
  if (r) {
    if (!r.rows.length) throw yaExiste();
    return rel;
  }

  // Sin la tabla: en la carpeta, como antes
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fs.writeFile(abs, contenido, { flag: reemplazar ? 'w' : 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') throw yaExiste();
    throw err;
  }
  return rel;
}

async function eliminar(rel) {
  const ruta = clave(rel);
  await enBase('DELETE FROM archivos WHERE ruta = $1', [ruta]);
  await fs.rm(absoluta(ruta), { force: true });
}

const esPlantilla = (ruta) => /\.docx$/i.test(ruta) && !ruta.split('/').pop().startsWith('~$')
  && ruta !== cfg.generados && !ruta.startsWith(cfg.generados + '/');

// Plantillas .docx disponibles: las de la base y las de la carpeta (salvo los contratos
// generados y los temporales de Word "~$"). Si está en las dos, manda la de la base.
async function listarPlantillas() {
  const salida = new Map();
  async function recorrer(dir) {
    let entradas;
    try { entradas = await fs.readdir(dir, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return; throw err; }
    for (const e of entradas) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (relativa(abs) !== cfg.generados) await recorrer(abs); }
      else if (esPlantilla(relativa(abs))) {
        const st = await fs.stat(abs);
        salida.set(relativa(abs), { archivo: relativa(abs), bytes: st.size, modificado: st.mtime.toISOString() });
      }
    }
  }
  await recorrer(cfg.dir);

  const r = await enBase("SELECT ruta, bytes, actualizado_en FROM archivos WHERE ruta ILIKE '%.docx'");
  for (const f of r?.rows || []) {
    if (esPlantilla(f.ruta)) salida.set(f.ruta, { archivo: f.ruta, bytes: f.bytes, modificado: new Date(f.actualizado_en).toISOString() });
  }
  return [...salida.values()].sort((a, b) => a.archivo.localeCompare(b.archivo, 'es'));
}

module.exports = { absoluta, leer, existe, guardar, eliminar, listarPlantillas, carpeta: () => cfg.dir };
