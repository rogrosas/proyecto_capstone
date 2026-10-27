/* =========================================================
   CAPA DE DATOS · Consultas agregadas del tablero del CRM
   (cruzan contratos, contrato_servicios, alertas, documentos y usuarios).
   Todas reciben db = cliente abierto por conUsuario().
   ========================================================= */
const { num, numeros } = require('../conversion');
const { MENSUALIZADO, SIN_RENOVAR, TOTAL_CONTRATO } = require('../sql/fragmentos');

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
            (CURRENT_DATE - k.fecha_vencimiento) AS dias, ${TOTAL_CONTRATO} AS monto
       FROM contratos k JOIN clientes cl ON cl.id = k.cliente_id
      WHERE k.estado IN ('activo','vencido') AND k.fecha_vencimiento < CURRENT_DATE AND ${SIN_RENOVAR}
      ORDER BY monto DESC NULLS LAST LIMIT $1)
    UNION ALL
    (SELECT 'por_vencer', cl.razon_social, k.folio, k.fecha_vencimiento::text,
            (k.fecha_vencimiento - CURRENT_DATE), ${TOTAL_CONTRATO}
       FROM contratos k JOIN clientes cl ON cl.id = k.cliente_id
      WHERE k.estado = 'activo' AND k.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
      ORDER BY k.fecha_vencimiento LIMIT $1)
    UNION ALL
    (SELECT 'revisar', cl.razon_social, COALESCE(k.folio, 'DOC-' || d.id), d.generado_en::date::text, NULL, NULL
       FROM documentos d JOIN clientes cl ON cl.id = d.cliente_id LEFT JOIN contratos k ON k.id = d.contrato_id
      WHERE d.estado = 'en_revision'
      ORDER BY d.generado_en LIMIT $1)`, [porTipo]);
  return r.rows.map((x) => numeros(x, ['dias', 'monto']));
}

async function cargaPorEjecutivo(db) {
  const r = await db.query(`
    SELECT u.nombre AS ejecutivo,
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
    SELECT (SELECT count(*) FROM clientes)                                AS clientes,
           (SELECT count(*) FROM documentos WHERE estado = 'en_revision') AS en_revision`);
  return numeros(r.rows[0], ['clientes', 'en_revision']);
}

module.exports = {
  indicadoresContratos, montoEnRiesgo, ingresoRecurrenteMensual,
  vencimientosPorMes, pendientesDelDia, cargaPorEjecutivo, conteosMenu
};
