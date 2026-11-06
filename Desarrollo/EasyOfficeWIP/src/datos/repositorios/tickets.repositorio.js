/* =========================================================
   CAPA DE DATOS · Tickets del cliente a la administración (tickets).
   El cliente los crea desde el portal (transacción del sistema, filtrada
   por su cliente_id); el personal los ve según su cartera (seguridad por fila).
   ========================================================= */

const COLUMNAS = `
  t.id, t.cliente_id, cl.razon_social AS cliente, t.documento_id, d.tipo AS documento, k.folio,
  t.email, t.motivo, t.detalle, t.estado, t.respuesta, u.nombre AS atendido_por,
  to_char(t.creado_en, 'YYYY-MM-DD HH24:MI') AS creado_en, to_char(t.actualizado_en, 'YYYY-MM-DD HH24:MI') AS actualizado_en,
  (SELECT count(*)::int FROM ticket_mensajes m WHERE m.ticket_id = t.id AND m.autor_tipo <> 'sistema') AS mensajes,
  -- quién escribió último: 'cliente' = espera respuesta del personal
  (SELECT m.autor_tipo FROM ticket_mensajes m WHERE m.ticket_id = t.id AND m.autor_tipo <> 'sistema' ORDER BY m.id DESC LIMIT 1) AS ultimo_autor`;
const DESDE = `
  FROM tickets t
  JOIN clientes cl ON cl.id = t.cliente_id
  LEFT JOIN documentos d ON d.id = t.documento_id
  LEFT JOIN contratos k ON k.id = d.contrato_id
  LEFT JOIN usuarios u ON u.id = t.atendido_por`;

// El ticket y su primer mensaje (el detalle que escribió el cliente)
async function crear(db, t) {
  const r = await db.query(`
    INSERT INTO tickets (cliente_id, documento_id, email, motivo, detalle)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`, [t.cliente_id, t.documento_id, t.email, t.motivo, t.detalle]);
  await agregarMensaje(db, { ticket_id: r.rows[0].id, autor_tipo: 'cliente', email: t.email, texto: t.detalle });
  return r.rows[0].id;
}

/* ---------- Conversación ---------- */

// m = { ticket_id, autor_tipo: 'cliente' | 'personal' | 'sistema', email (cliente), texto }; el personal queda con app_usuario()
async function agregarMensaje(db, m) {
  await db.query(`
    INSERT INTO ticket_mensajes (ticket_id, autor_tipo, usuario_id, email, texto)
    VALUES ($1, $2, CASE WHEN $2 = 'cliente' THEN NULL ELSE app_usuario() END, $3, $4)`,
  [m.ticket_id, m.autor_tipo, m.email || null, m.texto]);
}

async function mensajes(db, ticketId) {
  const r = await db.query(`
    SELECT m.id, m.autor_tipo, m.texto, to_char(m.creado_en AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD HH24:MI') AS fecha,
           CASE m.autor_tipo WHEN 'cliente' THEN m.email::text ELSE COALESCE(u.nombre, 'Easy Office') END AS autor
      FROM ticket_mensajes m LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.ticket_id = $1 ORDER BY m.id`, [ticketId]);
  return r.rows;
}

// El cliente respondió un ticket resuelto: vuelve a quedar abierto
async function reabrir(db, id) {
  const r = await db.query("UPDATE tickets SET estado = 'abierto', actualizado_en = now() WHERE id = $1 AND estado = 'resuelto' RETURNING id", [id]);
  return r.rowCount > 0;
}

async function tocar(db, id) {
  await db.query('UPDATE tickets SET actualizado_en = now() WHERE id = $1', [id]);
}

// estado: '' = todos; 'pendientes' = abiertos y en proceso
async function listar(db, { estado, documentoId }, limite) {
  const r = await db.query(`
    SELECT ${COLUMNAS} ${DESDE}
     WHERE ($1::text = '' OR ($1 = 'pendientes' AND t.estado IN ('abierto', 'en_proceso')) OR t.estado = $1)
       AND ($2::int IS NULL OR t.documento_id = $2)
     ORDER BY (t.estado IN ('abierto', 'en_proceso')) DESC, COALESCE(t.actualizado_en, t.creado_en) DESC
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

module.exports = { crear, listar, porCliente, obtener, pendientes, atender, agregarMensaje, mensajes, reabrir, tocar };
