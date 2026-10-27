/* =========================================================
   CAPA DE DATOS · Plantillas con archivo Word (plantillas_documento.archivo_base)
   ========================================================= */

async function conArchivo(db) {
  const r = await db.query(`
    SELECT id, tipo_documento, version, familia, archivo_base, requiere_revision
      FROM plantillas_documento
     WHERE activo AND archivo_base IS NOT NULL AND archivo_base <> ''
     ORDER BY familia = 'CONTRATO_SERVICIO' DESC, tipo_documento, version DESC`);
  return r.rows;
}

async function obtener(db, id) {
  const r = await db.query(
    'SELECT id, tipo_documento, version, familia, archivo_base, requiere_revision, activo FROM plantillas_documento WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// Cuántas plantillas usan cada archivo (para la lista de Administración)
async function usoDeArchivos(db) {
  const r = await db.query(`
    SELECT archivo_base, string_agg(tipo_documento || ' v' || version, ', ' ORDER BY tipo_documento) AS plantillas
      FROM plantillas_documento WHERE archivo_base IS NOT NULL GROUP BY archivo_base`);
  return Object.fromEntries(r.rows.map((x) => [x.archivo_base, x.plantillas]));
}

module.exports = { conArchivo, obtener, usoDeArchivos };
