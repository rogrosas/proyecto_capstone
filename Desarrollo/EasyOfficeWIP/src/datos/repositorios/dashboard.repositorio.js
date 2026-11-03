/* =========================================================
   CAPA DE DATOS · Consultas agregadas del tablero del CRM
   (cruzan contratos, contrato_servicios, alertas, documentos y usuarios).
   Todas reciben db = cliente abierto por conUsuario().
   ========================================================= */
const config = require('../../config');
const { num, numeros } = require('../conversion');
const { MENSUALIZADO, SIN_RENOVAR, TOTAL_CONTRATO, POR_REVISAR } = require('../sql/fragmentos');

async function indicadoresContratos(db) {
  const r = await db.query(`
    SELECT
      count(*) FILTER (WHERE k.estado = 'activo' AND k.fecha_vencimiento >= CURRENT_DATE)       AS activos,
      count(*) FILTER (WHERE k.estado = 'activo' AND k.creado_en >= date_trunc('month', now())) AS nuevos_mes,
      count(*) FILTER (WHERE k.estado IN ('activo','vencido') AND k.fecha_vencimiento < CURRENT_DATE
                       AND ${SIN_RENOVAR})                                                      AS vencidos,
      count(*) FILTER (WHERE k.estado = 'activo'
                       AND k.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)      AS vencen_30,
      count(*) FILTER (WHERE k.estado = 'activo'
                       AND k.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                       AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.contrato_id = k.id AND a.notificado)) AS vencen_30_sin_aviso
    FROM contratos k`);
  return numeros(r.rows[0], ['activos', 'nuevos_mes', 'vencidos', 'vencen_30', 'vencen_30_sin_aviso']);
}

async function montoEnRiesgo(db) {
  const r = await db.query(`
    SELECT COALESCE(sum(cs.precio), 0) AS monto
      FROM contratos k JOIN contrato_servicios cs ON cs.contrato_id = k.id
     WHERE k.estado IN ('activo','vencido') AND k.fecha_vencimiento < CURRENT_DATE AND ${SIN_RENOVAR}`);
  return num(r.rows[0].monto);
}

async function ingresoRecurrenteMensual(db) {
  const r = await db.query(`
    SELECT COALESCE(round(sum(${MENSUALIZADO})), 0) AS monto
      FROM contratos k JOIN contrato_servicios cs ON cs.contrato_id = k.id
     WHERE k.estado = 'activo' AND k.fecha_vencimiento >= CURRENT_DATE`);
  return num(r.rows[0].monto);
}

async function vencimientosPorMes(db, meses) {
  const r = await db.query(`
    SELECT to_char(m.mes, 'YYYY-MM') AS mes, count(k.id) AS total
      FROM generate_series(date_trunc('month', CURRENT_DATE),
                           date_trunc('month', CURRENT_DATE) + make_interval(months => $1 - 1),
                           interval '1 month') AS m(mes)
      LEFT JOIN contratos k ON k.estado = 'activo' AND date_trunc('month', k.fecha_vencimiento) = m.mes
     GROUP BY m.mes ORDER BY m.mes`, [meses]);
  return r.rows.map((x) => numeros(x, ['total']));
}

async function pendientesDelDia(db, porTipo) {
  const r = await db.query(`
    (SELECT 'vencido' AS tipo, cl.razon_social AS cliente, k.folio, k.fecha_vencimiento::text AS fecha,
            (CURRENT_DATE - k.fecha_vencimiento) AS dias, ${TOTAL_CONTRATO} AS monto,
            cl.id AS cliente_id, k.id AS contrato_id, NULL::int AS documento_id
       FROM contratos k JOIN clientes cl ON cl.id = k.cliente_id
      WHERE k.estado IN ('activo','vencido') AND k.fecha_vencimiento < CURRENT_DATE AND ${SIN_RENOVAR}
      ORDER BY monto DESC NULLS LAST LIMIT $1)
    UNION ALL
    (SELECT 'por_vencer', cl.razon_social, k.folio, k.fecha_vencimiento::text,
            (k.fecha_vencimiento - CURRENT_DATE), ${TOTAL_CONTRATO}, cl.id, k.id, NULL::int
       FROM contratos k JOIN clientes cl ON cl.id = k.cliente_id
      WHERE k.estado = 'activo' AND k.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
      ORDER BY k.fecha_vencimiento LIMIT $1)
    UNION ALL
    (SELECT 'revisar', cl.razon_social, COALESCE(k.folio, 'DOC-' || d.id), d.generado_en::date::text, NULL, NULL,
            cl.id, d.contrato_id, d.id
       FROM documentos d JOIN clientes cl ON cl.id = d.cliente_id LEFT JOIN contratos k ON k.id = d.contrato_id
      WHERE ${POR_REVISAR('d')}
      ORDER BY d.generado_en LIMIT $1)
    UNION ALL
    -- Seguimientos comprometidos en la bitácora de gestiones (próxima acción hasta hoy)
    (SELECT DISTINCT ON (g.cliente_id) 'seguimiento', cl.razon_social, COALESCE(k.folio, left(g.nota, 60), 'Gestión'),
            g.proxima_accion_en::text, (CURRENT_DATE - g.proxima_accion_en), NULL, cl.id, g.contrato_id, NULL::int
       FROM gestiones g JOIN clientes cl ON cl.id = g.cliente_id LEFT JOIN contratos k ON k.id = g.contrato_id
      WHERE g.proxima_accion_en <= CURRENT_DATE
        AND NOT EXISTS (SELECT 1 FROM gestiones g2 WHERE g2.cliente_id = g.cliente_id AND g2.creado_en > g.creado_en)
      ORDER BY g.cliente_id, g.proxima_accion_en LIMIT $1)`, [porTipo]);
  return r.rows.map((x) => numeros(x, ['dias', 'monto']));
}

async function cargaPorEjecutivo(db) {
  const r = await db.query(`
    SELECT u.id, u.nombre AS ejecutivo,
           (SELECT count(*) FROM contratos k WHERE k.ejecutivo_id = u.id AND k.estado IN ('activo','pendiente')) AS contratos,
           (SELECT count(*) FROM documentos d WHERE d.ejecutivo_id = u.id
               AND d.estado IN ('borrador','en_revision','aprobado','enviado_firma'))                         AS documentos
      FROM usuarios u
     WHERE u.activo
     ORDER BY 2 DESC, 1`);
  return r.rows.map((x) => numeros(x, ['contratos', 'documentos']));
}

async function conteosMenu(db) {
  const r = await db.query(`
    SELECT (SELECT count(*) FROM clientes)                                 AS clientes,
           (SELECT count(*) FROM documentos d WHERE ${POR_REVISAR('d')}) AS en_revision`);
  return numeros(r.rows[0], ['clientes', 'en_revision']);
}

/* ---------- Indicadores de un período (HU-33) ----------
   p = { desde, hasta: 'YYYY-MM-DD', ejecutivo: id | null }. Las fechas se cuentan en hora de Chile.
   Venta = contrato creado en el período (no cancelado), por el total neto de sus servicios. */
const EN_PERIODO = (col) => `(${col} AT TIME ZONE $4)::date BETWEEN $1::date AND $2::date`;
const DEL_EJECUTIVO = (col) => `($3::int IS NULL OR ${col} = $3)`;

async function indicadoresPeriodo(db, { desde, hasta, ejecutivo }) {
  const p = [desde, hasta, ejecutivo, config.bd.zonaHoraria];
  const r = await db.query(`
    SELECT
      (SELECT count(*) FROM clientes cl WHERE ${DEL_EJECUTIVO('cl.registrado_por')})                                  AS clientes,
      (SELECT count(*) FROM clientes cl WHERE ${EN_PERIODO('cl.creado_en')} AND ${DEL_EJECUTIVO('cl.registrado_por')}) AS clientes_nuevos,
      (SELECT count(*) FROM contratos k
        WHERE k.estado <> 'cancelado' AND ${EN_PERIODO('k.creado_en')} AND ${DEL_EJECUTIVO('k.ejecutivo_id')})          AS contratos,
      (SELECT COALESCE(sum(${TOTAL_CONTRATO}), 0) FROM contratos k
        WHERE k.estado <> 'cancelado' AND ${EN_PERIODO('k.creado_en')} AND ${DEL_EJECUTIVO('k.ejecutivo_id')})          AS ventas,
      (SELECT COALESCE(sum(pg.monto), 0) FROM pagos pg LEFT JOIN contratos k ON k.id = pg.contrato_id
        WHERE pg.estado = 'pagado' AND ${EN_PERIODO('pg.fecha_pago')} AND ${DEL_EJECUTIVO('k.ejecutivo_id')})           AS cobrado,
      (SELECT count(*) FROM contratos k
        WHERE k.estado = 'activo' AND k.fecha_vencimiento >= CURRENT_DATE AND ${DEL_EJECUTIVO('k.ejecutivo_id')})       AS servicios_activos,
      (SELECT count(*) FROM documentos d
        WHERE d.estado IN ('borrador','en_revision','aprobado') AND ${DEL_EJECUTIVO('d.ejecutivo_id')})                 AS tramites,
      (SELECT count(*) FROM tickets t LEFT JOIN documentos d ON d.id = t.documento_id
        WHERE t.estado IN ('abierto','en_proceso') AND ${DEL_EJECUTIVO('d.ejecutivo_id')})                              AS tickets,
      (SELECT count(*) FROM documentos d WHERE d.estado = 'enviado_firma' AND ${DEL_EJECUTIVO('d.ejecutivo_id')})        AS pendientes_firma`, p);
  const porServicio = await db.query(`
    SELECT sv.id, sv.nombre AS servicio, count(DISTINCT k.id) AS contratos, COALESCE(sum(cs.precio), 0) AS monto
      FROM contratos k JOIN contrato_servicios cs ON cs.contrato_id = k.id JOIN servicios sv ON sv.id = cs.servicio_id
     WHERE k.estado <> 'cancelado' AND ${EN_PERIODO('k.creado_en')} AND ${DEL_EJECUTIVO('k.ejecutivo_id')}
     GROUP BY sv.id, sv.nombre ORDER BY monto DESC, contratos DESC LIMIT 8`, p);
  const porEjecutivo = await db.query(`
    SELECT u.id, COALESCE(u.nombre, 'Tienda en línea') AS ejecutivo, count(*) AS contratos,
           COALESCE(sum(${TOTAL_CONTRATO}), 0) AS monto
      FROM contratos k LEFT JOIN usuarios u ON u.id = k.ejecutivo_id
     WHERE k.estado <> 'cancelado' AND ${EN_PERIODO('k.creado_en')} AND ${DEL_EJECUTIVO('k.ejecutivo_id')}
     GROUP BY u.id, u.nombre ORDER BY monto DESC, contratos DESC`, p);
  return {
    ...numeros(r.rows[0], ['clientes', 'clientes_nuevos', 'contratos', 'ventas', 'cobrado', 'servicios_activos', 'tramites', 'tickets', 'pendientes_firma']),
    porServicio: porServicio.rows.map((x) => numeros(x, ['contratos', 'monto'])),
    porEjecutivo: porEjecutivo.rows.map((x) => numeros(x, ['contratos', 'monto']))
  };
}

module.exports = {
  indicadoresContratos, montoEnRiesgo, ingresoRecurrenteMensual,
  vencimientosPorMes, pendientesDelDia, cargaPorEjecutivo, conteosMenu, indicadoresPeriodo
};
