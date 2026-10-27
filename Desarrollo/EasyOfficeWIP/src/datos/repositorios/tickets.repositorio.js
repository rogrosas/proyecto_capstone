/* =========================================================
   CAPA DE DATOS · Tickets del cliente a la administración (tickets).
   El cliente los crea desde el portal (transacción del sistema, filtrada
   por su cliente_id); el personal los ve según su cartera (seguridad por fila).
   ========================================================= */

const COLUMNAS = `
  t.id, t.cliente_id, cl.razon_social AS cliente, t.documento_id, d.tipo AS documento, k.folio,
  t.email, t.motivo, t.detalle, t.estado, t.respuesta, u.nombre AS atendido_por,
  to_char(t.creado_en, 'YYYY-MM-DD HH24:MI') AS creado_en, to_char(t.actualizado_en, 'YYYY-MM-DD HH24:MI') AS actualizado_en`;
const DESDE = `
  FROM tickets t
  JOIN clientes cl ON cl.id = t.cliente_id
  LEFT JOIN documentos d ON d.id = t.documento_id
  LEFT JOIN contratos k ON k.id = d.contrato_id
  LEFT JOIN usuarios u ON u.id = t.atendido_por`;

async function crear(db, t) {
  const r = await db.query(`
    INSERT INTO tickets (cliente_id, documento_id, email, motivo, detalle)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`, [t.cliente_id, t.documento_id, t.email, t.motivo, t.detalle]);
  return r.rows[0].id;
}

// estado: '' = todos; 'pendientes' = abiertos y en proceso
async function listar(db, { estado, documentoId }, limite) {
  const r = await db.query(`
    SELECT ${COLUMNAS} ${DESDE}
     WHERE ($1::text = '' OR ($1 = 'pendientes' AND t.estado IN ('abierto', 'en_proceso')) OR t.estado = $1)
       AND ($2::int IS NULL OR t.documento_id = $2)
     ORDER BY (t.estado IN ('abierto', 'en_proceso')) DESC, t.creado_en DESC
     LIMIT $3`, [estado || '', documentoId ?? null, limite]);
  return r.rows;
}

async function porCliente(db, clienteId) {
  const r = await db.query(`SELECT ${COLUMNAS} ${DESDE} WHERE t.cliente_id = $1 ORDER BY t.creado_en DESC`, [clienteId]);
  return r.rows;
}

async function obtener(db, id) {
  const r = await db.query(`SELECT ${COLUMNAS} ${DESDE} WHERE t.id = $1`, [id]);
  return r.rows[0] || null;
}

async function pendientes(db) {
  const r = await db.query("SELECT count(*)::int AS n FROM tickets WHERE estado IN ('abierto', 'en_proceso')");
  return r.rows[0].n;
}

/** c = { estado, respuesta } — atendido_por = usuario de la sesión */
async function atender(db, id, c) {
  const r = await db.query(`
    UPDATE tickets SET estado = $2, respuesta = COALESCE($3, respuesta), atendido_por = app_usuario(), actualizado_en = now()
     WHERE id = $1 RETURNING id`, [id, c.estado, c.respuesta]);
  return r.rowCount > 0;
}

module.exports = { crear, listar, porCliente, obtener, pendientes, atender };
