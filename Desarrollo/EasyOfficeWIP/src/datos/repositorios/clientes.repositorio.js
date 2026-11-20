/* =========================================================
   CAPA DE DATOS · Repositorio de clientes
   (clientes + su contrato más reciente y servicios vigentes).
   ========================================================= */

/**
 * filtros = { texto, rut, estado }  (ya normalizados por la capa de negocio)
 */
const { POR_REVISAR, textoLike } = require('../sql/fragmentos');

/** aCargo: id del usuario a cargo (null = todos); sinAsignar: solo los que no tienen ejecutivo a cargo */
async function listar(db, { texto, rut, estado, porRevisar, aCargo = null, sinAsignar = false }, limite) {
  const r = await db.query(`
    WITH base AS (
      SELECT cl.id, cl.rut, fn_rut_formato(cl.rut) AS rut_fmt, cl.razon_social, cl.nombre_fantasia,
             cl.email, cl.celular, cl.creado_en::date::text AS desde, cl.ejecutivo_id, ue.nombre AS a_cargo,
             ult.ejecutivo, ult.vence, ult.estado_contrato, ult.folio, ult.contrato_id, srv.servicios,
             (SELECT count(*)::int FROM documentos d WHERE d.cliente_id = cl.id AND ${POR_REVISAR('d')}) AS docs_por_revisar,
             CASE
               WHEN ult.vence IS NULL                                                   THEN 'Sin contrato'
               WHEN ult.estado_contrato = 'vencido' OR ult.vence::date < CURRENT_DATE   THEN 'Vencido'
               WHEN ult.estado_contrato = 'pendiente'                                   THEN 'Pendiente'
               WHEN ult.vence::date <= CURRENT_DATE + 30                                THEN 'Por vencer'
               ELSE 'Activo' END AS estado
        FROM clientes cl
        LEFT JOIN usuarios ue ON ue.id = cl.ejecutivo_id
        LEFT JOIN LATERAL (
          SELECT u.nombre AS ejecutivo, k.fecha_vencimiento::text AS vence, k.estado AS estado_contrato, k.folio, k.id AS contrato_id
            FROM contratos k LEFT JOIN usuarios u ON u.id = k.ejecutivo_id
           WHERE k.cliente_id = cl.id AND k.estado <> 'cancelado'
           ORDER BY k.fecha_vencimiento DESC LIMIT 1) ult ON true
        LEFT JOIN LATERAL (
          SELECT string_agg(DISTINCT sv.nombre, ' · ') AS servicios
            FROM contratos k JOIN contrato_servicios cs ON cs.contrato_id = k.id
            JOIN servicios sv ON sv.id = cs.servicio_id
           WHERE k.cliente_id = cl.id AND k.estado IN ('activo','pendiente')) srv ON true
       WHERE ($1 = '' OR cl.razon_social ILIKE '%' || $1 || '%' OR cl.nombre_fantasia ILIKE '%' || $1 || '%'
              OR ($2 <> '' AND cl.rut LIKE '%' || $2 || '%')
              OR EXISTS (SELECT 1 FROM contratos k WHERE k.cliente_id = cl.id AND k.folio ILIKE '%' || $1 || '%'))
         AND ($6::int IS NULL OR cl.ejecutivo_id = $6)
         AND (NOT $7::boolean OR cl.ejecutivo_id IS NULL)
    )
    SELECT * FROM base WHERE ($3 = '' OR estado = $3) AND (NOT $5::boolean OR docs_por_revisar > 0)
    ORDER BY docs_por_revisar > 0 DESC, razon_social LIMIT $4`, [textoLike(texto), rut, estado, limite, !!porRevisar, aCargo, !!sinAsignar]);
  return r.rows;
}

// Devuelve true si se eliminó; false si no existe o la seguridad por fila lo oculta
async function eliminar(db, id) {
  const r = await db.query('DELETE FROM clientes WHERE id = $1 RETURNING id', [id]);
  return r.rowCount > 0;
}

async function obtener(db, id) {
  const r = await db.query(
    `SELECT cl.id, cl.rut, fn_rut_formato(cl.rut) AS rut_fmt, cl.tipo_persona, cl.razon_social, cl.nombre_fantasia, cl.giro_principal,
            cl.email, cl.celular, cl.representante_legal_id, cl.direccion_id, cl.fecha_escritura::text AS fecha_escritura, cl.sitio_notaria,
            cl.creado_en::date::text AS creado_en, u.nombre AS registrado_por, cl.ejecutivo_id, ue.nombre AS a_cargo
       FROM clientes cl LEFT JOIN usuarios u ON u.id = cl.registrado_por LEFT JOIN usuarios ue ON ue.id = cl.ejecutivo_id
      WHERE cl.id = $1`, [id]);
  return r.rows[0] || null;
}

/*
 * Deja a los clientes indicados a cargo de un usuario del personal (null = sin asignar). Con
 * conContratos, también sus contratos vigentes y sus documentos en curso pasan a ese ejecutivo
 * (renovaciones, avisos y carga de trabajo). Devuelve los ids que cambió (los que puede ver).
 */
async function asignar(db, ids, ejecutivoId, conContratos) {
  const r = await db.query('UPDATE clientes SET ejecutivo_id = $2 WHERE id = ANY($1::int[]) RETURNING id', [ids, ejecutivoId]);
  const cambiados = r.rows.map((x) => x.id);
  if (conContratos && ejecutivoId && cambiados.length) {
    await db.query("UPDATE contratos SET ejecutivo_id = $2 WHERE cliente_id = ANY($1::int[]) AND estado IN ('activo', 'pendiente')", [cambiados, ejecutivoId]);
    await db.query("UPDATE documentos SET ejecutivo_id = $2 WHERE cliente_id = ANY($1::int[]) AND estado NOT IN ('firmado', 'anulado', 'rechazado')", [cambiados, ejecutivoId]);
  }
  return cambiados;
}

/** c = { rut, razon_social, nombre_fantasia, giro_principal, email, celular, representante_legal_id, fecha_escritura, sitio_notaria } */
async function crear(db, c) {
  const r = await db.query(
    `INSERT INTO clientes (rut, razon_social, nombre_fantasia, giro_principal, email, celular,
                           representante_legal_id, fecha_escritura, sitio_notaria, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, app_usuario()) RETURNING id`,
    [c.rut, c.razon_social, c.nombre_fantasia, c.giro_principal, c.email, c.celular,
      c.representante_legal_id, c.fecha_escritura, c.sitio_notaria]);
  return r.rows[0].id;
}

async function actualizar(db, id, c) {
  const r = await db.query(
    `UPDATE clientes
        SET rut = $2, razon_social = $3, nombre_fantasia = $4, giro_principal = $5, email = $6, celular = $7,
            representante_legal_id = $8, fecha_escritura = $9, sitio_notaria = $10
      WHERE id = $1 RETURNING id`,
    [id, c.rut, c.razon_social, c.nombre_fantasia, c.giro_principal, c.email, c.celular,
      c.representante_legal_id, c.fecha_escritura, c.sitio_notaria]);
  return r.rowCount > 0;
}

module.exports = { listar, eliminar, obtener, crear, actualizar, asignar };
