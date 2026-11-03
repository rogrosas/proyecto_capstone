/* =========================================================
   CAPA DE DATOS · Bitácora de gestiones con el cliente (llamadas, correos,
   reuniones, links de pago y notas). Las políticas RLS dejan ver al
   ejecutivo las gestiones de su cartera.
   ========================================================= */

async function porCliente(db, clienteId, limite = 50) {
  const r = await db.query(`
    SELECT g.id, g.tipo, g.resultado, g.nota, g.proxima_accion_en::text AS proxima, k.folio, g.contrato_id,
           u.nombre AS usuario, to_char(g.creado_en AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD HH24:MI') AS fecha
      FROM gestiones g
      JOIN usuarios u ON u.id = g.usuario_id
      LEFT JOIN contratos k ON k.id = g.contrato_id
     WHERE g.cliente_id = $1
     ORDER BY g.creado_en DESC, g.id DESC LIMIT $2`, [clienteId, limite]);
  return r.rows;
}

// usuario_id queda como el de la sesión (DEFAULT app_usuario())
async function crear(db, g) {
  const r = await db.query(`
    INSERT INTO gestiones (cliente_id, contrato_id, tipo, resultado, nota, proxima_accion_en)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
  [g.cliente_id, g.contrato_id, g.tipo, g.resultado, g.nota, g.proxima_accion_en]);
  return r.rows[0].id;
}

module.exports = { porCliente, crear };
