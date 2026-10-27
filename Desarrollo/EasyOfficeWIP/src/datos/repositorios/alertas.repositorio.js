/* =========================================================
   CAPA DE DATOS · Alertas de vencimiento.
   Las crea el trigger fn_generar_alertas según config_alertas;
   la app solo las lee y las marca como notificadas.
   ========================================================= */

async function porContrato(db, contratoId) {
  const r = await db.query(`
    SELECT id, fecha_alerta::text AS fecha, dias_anticipacion, notificado, (fecha_alerta <= CURRENT_DATE) AS vencida
      FROM alertas WHERE contrato_id = $1 ORDER BY fecha_alerta`, [contratoId]);
  return r.rows;
}

async function notificar(db, id) {
  const r = await db.query('UPDATE alertas SET notificado = true WHERE id = $1 AND NOT notificado RETURNING id', [id]);
  return r.rowCount > 0;
}

// Marca como enviadas todas las alertas del contrato cuya fecha ya llegó
async function notificarVencidas(db, contratoId) {
  const r = await db.query(
    'UPDATE alertas SET notificado = true WHERE contrato_id = $1 AND NOT notificado AND fecha_alerta <= CURRENT_DATE RETURNING id',
    [contratoId]);
  return r.rowCount;
}

module.exports = { porContrato, notificar, notificarVencidas };
