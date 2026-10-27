/* =========================================================
   CAPA DE DATOS · Repositorio de pagos
   ========================================================= */
const config = require('../../config');
const { numeros } = require('../conversion');

async function resumenPorPasarela(db, dias) {
  const r = await db.query(`
    SELECT COALESCE(p.pasarela, 'sin_pasarela') AS pasarela,
           count(*) FILTER (WHERE p.estado = 'pagado')                  AS pagados,
           COALESCE(sum(p.monto) FILTER (WHERE p.estado = 'pagado'), 0) AS monto,
           count(*) FILTER (WHERE p.estado = 'pendiente')               AS pendientes,
           count(*) FILTER (WHERE p.estado = 'rechazado')               AS rechazados
      FROM pagos p
     WHERE COALESCE(p.fecha_pago, now()) >= now() - make_interval(days => $1)
     GROUP BY 1 ORDER BY monto DESC`, [dias]);
  return r.rows.map((x) => numeros(x, ['pagados', 'monto', 'pendientes', 'rechazados']));
}

async function listarRecientes(db, limite) {
  const r = await db.query(`
    SELECT p.id, p.monto, p.estado, p.pasarela, p.cuota, p.total_cuotas,
           to_char(p.fecha_pago AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS fecha,
           COALESCE(k.folio, 'DOC-' || p.documento_id) AS referencia,
           cl.razon_social AS cliente,
           COALESCE((SELECT string_agg(sv.nombre, ' · ')
                       FROM contrato_servicios cs JOIN servicios sv ON sv.id = cs.servicio_id
                      WHERE cs.contrato_id = k.id), d.tipo) AS concepto
      FROM pagos p
      LEFT JOIN contratos k  ON k.id = p.contrato_id
      LEFT JOIN documentos d ON d.id = p.documento_id
      LEFT JOIN clientes cl  ON cl.id = COALESCE(k.cliente_id, d.cliente_id)
     ORDER BY p.fecha_pago DESC NULLS FIRST, p.id DESC
     LIMIT $1`, [limite, config.bd.zonaHoraria]);
  return r.rows.map((x) => numeros(x, ['monto']));
}

const COLUMNAS_PAGO = `
  p.id, p.contrato_id, p.documento_id, p.monto, p.estado, p.pasarela, p.cuota, p.total_cuotas,
  to_char(p.fecha_pago AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS fecha`;

async function porContrato(db, contratoId) {
  const r = await db.query(`SELECT ${COLUMNAS_PAGO} FROM pagos p WHERE p.contrato_id = $1 ORDER BY p.cuota, p.id`,
    [contratoId, config.bd.zonaHoraria]);
  return r.rows.map((x) => numeros(x, ['monto']));
}

async function porCliente(db, clienteId) {
  const r = await db.query(`
    SELECT ${COLUMNAS_PAGO}, COALESCE(k.folio, 'DOC-' || p.documento_id) AS referencia
      FROM pagos p
      LEFT JOIN contratos k ON k.id = p.contrato_id
      LEFT JOIN documentos d ON d.id = p.documento_id
     WHERE COALESCE(k.cliente_id, d.cliente_id) = $1
     ORDER BY p.fecha_pago DESC NULLS FIRST, p.id DESC`, [clienteId, config.bd.zonaHoraria]);
  return r.rows.map((x) => numeros(x, ['monto']));
}

/** p = { contrato_id, documento_id, monto, estado, pasarela, fecha_pago, cuota, total_cuotas } */
async function crear(db, p) {
  const r = await db.query(`
    INSERT INTO pagos (contrato_id, documento_id, monto, estado, pasarela, fecha_pago, cuota, total_cuotas)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [p.contrato_id, p.documento_id, p.monto, p.estado, p.pasarela, p.fecha_pago, p.cuota, p.total_cuotas]);
  return r.rows[0].id;
}

// Al pasar a "pagado" sin fecha, se registra la fecha actual
async function cambiarEstado(db, id, estado) {
  const r = await db.query(`
    UPDATE pagos SET estado = $2,
           fecha_pago = CASE WHEN $2 = 'pagado' THEN COALESCE(fecha_pago, now()) ELSE fecha_pago END
     WHERE id = $1 RETURNING id`, [id, estado]);
  return r.rowCount > 0;
}

module.exports = { resumenPorPasarela, listarRecientes, porContrato, porCliente, crear, cambiarEstado };
