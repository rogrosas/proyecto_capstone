/* =========================================================
   CAPA DE DATOS · Correspondencia recibida en el domicilio tributario
   (oficina de partes). Urgencia, plazo de aviso y fechas de cada estado
   los completa la base (fn_defaults_correspondencia).
   ========================================================= */
const { textoLike } = require('../sql/fragmentos');

const COLUMNAS = `
  c.id, c.cliente_id, cl.razon_social AS cliente, c.sucursal_id, s.nombre AS sucursal, c.remitente, c.tipo, c.descripcion,
  c.urgente, c.estado, c.url_archivo IS NOT NULL AS con_archivo,
  to_char(c.recibida_en AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS recibida,
  to_char(c.plazo_en AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS plazo,
  to_char(c.notificada_en AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS notificada,
  to_char(c.leida_en AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS leida,
  to_char(c.retirada_en AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS retirada,
  (c.estado IN ('recibida', 'digitalizada') AND c.plazo_en < now()) AS atrasada`;
const DESDE = 'FROM correspondencia c JOIN clientes cl ON cl.id = c.cliente_id JOIN sucursales s ON s.id = c.sucursal_id';

// filtro: 'pendientes' (sin avisar), 'por_retirar' (avisada y no retirada) o un estado; texto: cliente o remitente
async function listar(db, { filtro, texto }, zona, limite) {
  const r = await db.query(`
    SELECT ${COLUMNAS} ${DESDE}
     WHERE CASE $2 WHEN '' THEN true
                   WHEN 'pendientes' THEN c.estado IN ('recibida', 'digitalizada')
                   WHEN 'por_retirar' THEN c.estado = 'notificada'
                   ELSE c.estado = $2 END
       AND ($3 = '' OR cl.razon_social ILIKE '%' || $3 || '%' OR c.remitente ILIKE '%' || $3 || '%')
     ORDER BY (c.estado IN ('recibida', 'digitalizada')) DESC, c.urgente DESC, c.recibida_en DESC
     LIMIT $4`, [zona, filtro, textoLike(texto), limite]);
  return r.rows;
}

async function obtener(db, id, zona) {
  const r = await db.query(`SELECT ${COLUMNAS}, c.url_archivo ${DESDE} WHERE c.id = $2`, [zona, id]);
  return r.rows[0] || null;
}

async function crear(db, c) {
  const r = await db.query(`
    INSERT INTO correspondencia (cliente_id, sucursal_id, remitente, tipo, descripcion, urgente)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [c.cliente_id, c.sucursal_id, c.remitente, c.tipo, c.descripcion, c.urgente]);
  return r.rows[0].id;
}

// Sucursal del domicilio del cliente: la de su contrato más reciente (si no, la primera activa)
async function sucursalDe(db, clienteId) {
  const r = await db.query(`
    SELECT COALESCE((SELECT k.sucursal_id FROM contratos k WHERE k.cliente_id = $1 ORDER BY k.fecha_vencimiento DESC LIMIT 1),
                    (SELECT id FROM sucursales WHERE activo ORDER BY id LIMIT 1)) AS id`, [clienteId]);
  return r.rows[0]?.id || null;
}

async function cambiarEstado(db, id, estado, desde) {
  const r = await db.query('UPDATE correspondencia SET estado = $2 WHERE id = $1 AND estado = ANY($3) RETURNING id', [id, estado, desde]);
  return r.rowCount > 0;
}

async function guardarArchivo(db, id, url) {
  await db.query(`UPDATE correspondencia SET url_archivo = $2, estado = CASE WHEN estado = 'recibida' THEN 'digitalizada' ELSE estado END
                   WHERE id = $1`, [id, url]);
}

/* ---------- Portal del cliente ---------- */
async function porCliente(db, clienteId, zona) {
  const r = await db.query(`SELECT ${COLUMNAS} ${DESDE} WHERE c.cliente_id = $2 AND c.estado <> 'recibida' ORDER BY c.recibida_en DESC LIMIT 50`, [zona, clienteId]);
  return r.rows;
}

async function delCliente(db, id, clienteId) {
  const r = await db.query('SELECT id, url_archivo, estado FROM correspondencia WHERE id = $1 AND cliente_id = $2', [id, clienteId]);
  return r.rows[0] || null;
}

async function marcarLeida(db, id, clienteId) {
  await db.query('UPDATE correspondencia SET leida_en = COALESCE(leida_en, now()) WHERE id = $1 AND cliente_id = $2', [id, clienteId]);
}

module.exports = { listar, obtener, crear, sucursalDe, cambiarEstado, guardarArchivo, porCliente, delCliente, marcarLeida };
