/* =========================================================
   CAPA DE DATOS · Carpeta de plantillas y contratos Word.
   La BD guarda rutas relativas a config.archivos.dir; aquí se
   resuelven impidiendo salir de esa carpeta.
   ========================================================= */
const fs = require('fs/promises');
const path = require('path');
const { archivos: cfg } = require('../config');
const { errores } = require('../comun/errores');

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

async function leer(rel) {
  try {
    return await fs.readFile(absoluta(rel));
  } catch (err) {
    if (err.code === 'ENOENT') throw errores.noEncontrado(`No se encontró el archivo "${rel}" en la carpeta de contratos.`);
    throw err;
  }
}

async function guardar(rel, contenido, { reemplazar = true } = {}) {
  const abs = absoluta(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fs.writeFile(abs, contenido, { flag: reemplazar ? 'w' : 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') throw errores.conflicto(`Ya existe "${rel}". Elija otro nombre o márquelo para reemplazar.`);
    throw err;
  }
  return rel;
}

async function eliminar(rel) {
  await fs.rm(absoluta(rel), { force: true });
}

// Plantillas .docx disponibles (toda la carpeta salvo los contratos generados y los temporales de Word "~$")
async function listarPlantillas() {
  const salida = [];
  async function recorrer(dir) {
    let entradas;
    try { entradas = await fs.readdir(dir, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return; throw err; }
    for (const e of entradas) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (relativa(abs) !== cfg.generados) await recorrer(abs); }
      else if (/\.docx$/i.test(e.name) && !e.name.startsWith('~$')) {
        const st = await fs.stat(abs);
        salida.push({ archivo: relativa(abs), bytes: st.size, modificado: st.mtime.toISOString() });
      }
    }
  }
  await recorrer(cfg.dir);
  return salida.sort((a, b) => a.archivo.localeCompare(b.archivo, 'es'));
}

module.exports = { absoluta, leer, guardar, eliminar, listarPlantillas, carpeta: () => cfg.dir };
