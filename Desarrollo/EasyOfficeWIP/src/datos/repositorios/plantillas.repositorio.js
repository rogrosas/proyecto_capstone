/* =========================================================
   CAPA DE DATOS · Plantillas con archivo Word (plantillas_documento.archivo_base)
   y su uso en la tienda: planes vinculados (plantilla_planes), forma de
   entrega y qué dato va en cada marca del Word (mapa_campos).
   ========================================================= */

const PLANES = `COALESCE((SELECT array_agg(pp.plan_codigo ORDER BY pp.plan_codigo)
                            FROM plantilla_planes pp WHERE pp.plantilla_id = p.id), '{}') AS planes`;

async function conArchivo(db) {
  const r = await db.query(`
    SELECT id, tipo_documento, version, familia, archivo_base, requiere_revision
      FROM plantillas_documento
     WHERE activo AND archivo_base IS NOT NULL AND archivo_base <> ''
     ORDER BY familia = 'CONTRATO_SERVICIO' DESC, tipo_documento, version DESC`);
  return r.rows;
}

async function obtener(db, id) {
  const r = await db.query(`
    SELECT p.id, p.tipo_documento, p.version, p.familia, p.archivo_base, p.requiere_revision, p.activo,
           p.entrega, p.mapa_campos, ${PLANES}
      FROM plantillas_documento p WHERE p.id = $1`, [id]);
  return r.rows[0] || null;
}

// Cuántas plantillas usan cada archivo (para la lista de Administración)
async function usoDeArchivos(db) {
  const r = await db.query(`
    SELECT archivo_base, string_agg(tipo_documento || ' v' || version, ', ' ORDER BY tipo_documento) AS plantillas
      FROM plantillas_documento WHERE archivo_base IS NOT NULL GROUP BY archivo_base`);
  return Object.fromEntries(r.rows.map((x) => [x.archivo_base, x.plantillas]));
}

/* ---------- Tienda ---------- */

// Plantillas con archivo Word, con sus planes y su forma de entrega (Administración → Documentos de la tienda)
async function deTienda(db) {
  const r = await db.query(`
    SELECT p.id, p.tipo_documento, p.version, p.familia, p.archivo_base, p.requiere_revision, p.activo,
           p.entrega, p.mapa_campos, ${PLANES}
      FROM plantillas_documento p
     WHERE p.archivo_base IS NOT NULL AND p.archivo_base <> ''
     ORDER BY p.activo DESC, p.tipo_documento, p.version DESC`);
  return r.rows;
}

// Plantillas activas que genera la compra de un plan
async function porPlan(db, planCodigo) {
  const r = await db.query(`
    SELECT p.id, p.tipo_documento, p.version, p.familia, p.archivo_base, p.entrega, p.mapa_campos
      FROM plantillas_documento p JOIN plantilla_planes pp ON pp.plantilla_id = p.id
     WHERE pp.plan_codigo = $1 AND p.activo AND p.archivo_base IS NOT NULL AND p.archivo_base <> ''
     ORDER BY p.tipo_documento`, [planCodigo]);
  return r.rows;
}

/** t = { entrega, mapa_campos, planes: ['dom-anual', ...] } */
async function guardarTienda(db, id, t) {
  const r = await db.query('UPDATE plantillas_documento SET entrega = $2, mapa_campos = $3 WHERE id = $1 RETURNING id',
    [id, t.entrega, t.mapa_campos]);
  if (!r.rowCount) return false;
  await db.query('DELETE FROM plantilla_planes WHERE plantilla_id = $1 AND NOT (plan_codigo = ANY($2::text[]))', [id, t.planes]);
  await db.query(`INSERT INTO plantilla_planes (plantilla_id, plan_codigo)
                  SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [id, t.planes]);
  return true;
}

module.exports = { conArchivo, obtener, usoDeArchivos, deTienda, porPlan, guardarTienda };
