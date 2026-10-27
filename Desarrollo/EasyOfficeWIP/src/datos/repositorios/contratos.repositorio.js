/* =========================================================
   CAPA DE DATOS · Repositorio de contratos (renovaciones y cobranza)
   Usa contratos, contrato_servicios, alertas y la vista v_saldo_contrato.
   ========================================================= */
const { numeros } = require('../conversion');
const { SIN_RENOVAR, SERVICIOS_CONTRATO } = require('../sql/fragmentos');

// Cantidad de contratos en cada etapa del ciclo de renovación (días hasta/desde el vencimiento)
async function etapasRenovacion(db) {
  const r = await db.query(`
    SELECT
      count(*) FILTER (WHERE d BETWEEN 31 AND 60)  AS d60,
      count(*) FILTER (WHERE d BETWEEN 8 AND 30)   AS d30,
      count(*) FILTER (WHERE d BETWEEN 0 AND 7)    AS d7,
      count(*) FILTER (WHERE d BETWEEN -30 AND -1) AS d0,
      count(*) FILTER (WHERE d < -30)              AS dmas30
    FROM (SELECT k.fecha_vencimiento - CURRENT_DATE AS d
            FROM contratos k
           WHERE k.estado IN ('activo','vencido') AND (k.fecha_vencimiento >= CURRENT_DATE OR ${SIN_RENOVAR})) x`);
  return numeros(r.rows[0], ['d60', 'd30', 'd7', 'd0', 'dmas30']);
}

/**
 * rango = { soloVencidos: boolean, dias: number }
 */
async function listarPorVencer(db, { soloVencidos, dias }, limite) {
  const r = await db.query(`
    SELECT k.id, k.folio, cl.razon_social, fn_rut_formato(cl.rut) AS rut, k.estado,
           k.fecha_vencimiento::text AS vence, (k.fecha_vencimiento - CURRENT_DATE) AS dias,
           k.renovacion_automatica, k.link_pago, u.nombre AS ejecutivo,
           s.total_servicios, s.saldo,
           ${SERVICIOS_CONTRATO} AS servicios,
           (SELECT count(*) FROM alertas a WHERE a.contrato_id = k.id AND a.notificado) AS avisos_enviados,
           (SELECT min(a.fecha_alerta)::text FROM alertas a WHERE a.contrato_id = k.id AND NOT a.notificado) AS proxima_alerta
      FROM contratos k
      JOIN clientes cl ON cl.id = k.cliente_id
      LEFT JOIN usuarios u ON u.id = k.ejecutivo_id
      LEFT JOIN v_saldo_contrato s ON s.contrato_id = k.id
     WHERE k.estado IN ('activo','vencido')
       AND CASE WHEN $1
                THEN k.fecha_vencimiento < CURRENT_DATE AND ${SIN_RENOVAR}
                ELSE k.fecha_vencimiento <= CURRENT_DATE + $2::int
                     AND (k.fecha_vencimiento >= CURRENT_DATE OR ${SIN_RENOVAR}) END
     ORDER BY k.fecha_vencimiento
     LIMIT $3`, [soloVencidos, dias, limite]);
  return r.rows.map((x) => numeros(x, ['dias', 'total_servicios', 'saldo', 'avisos_enviados']));
}

/* ---------- Gestión de contratos ---------- */

const COLUMNAS_LISTA = `
  k.id, k.folio, k.cliente_id, cl.razon_social AS cliente, fn_rut_formato(cl.rut) AS rut, k.estado,
  k.fecha_inicio::text AS inicio, k.fecha_vencimiento::text AS vence, k.duracion_meses,
  (k.fecha_vencimiento - CURRENT_DATE) AS dias, e.nombre_comercial AS emisora, su.nombre AS sucursal,
  u.nombre AS ejecutivo, s.total_servicios, s.pagado, s.saldo, ${SERVICIOS_CONTRATO} AS servicios`;

const FROM_LISTA = `
  FROM contratos k
  JOIN clientes cl ON cl.id = k.cliente_id
  JOIN empresas_emisoras e ON e.id = k.empresa_id
  JOIN sucursales su ON su.id = k.sucursal_id
  LEFT JOIN usuarios u ON u.id = k.ejecutivo_id
  LEFT JOIN v_saldo_contrato s ON s.contrato_id = k.id`;

const tipar = (x) => numeros(x, ['dias', 'total_servicios', 'pagado', 'saldo', 'duracion_meses']);

async function listar(db, { texto, estado }, limite) {
  const r = await db.query(`
    SELECT ${COLUMNAS_LISTA} ${FROM_LISTA}
     WHERE ($1 = '' OR k.folio ILIKE '%' || $1 || '%' OR cl.razon_social ILIKE '%' || $1 || '%')
       AND ($2 = '' OR k.estado = $2)
     ORDER BY k.creado_en DESC LIMIT $3`, [texto, estado, limite]);
  return r.rows.map(tipar);
}

async function porCliente(db, clienteId) {
  const r = await db.query(`SELECT ${COLUMNAS_LISTA} ${FROM_LISTA} WHERE k.cliente_id = $1 ORDER BY k.fecha_vencimiento DESC`, [clienteId]);
  return r.rows.map(tipar);
}

async function obtener(db, id) {
  const r = await db.query(`
    SELECT ${COLUMNAS_LISTA}, k.empresa_id, k.sucursal_id, k.cuenta_recaudacion_id, k.link_pago,
           k.lugar_celebracion, k.fecha_celebracion::text AS fecha_celebracion, k.renovacion_automatica,
           k.ejecutivo_id, k.observaciones, k.datos_formulario, k.creado_en::date::text AS creado_en
    ${FROM_LISTA} WHERE k.id = $1`, [id]);
  return r.rows[0] ? tipar(r.rows[0]) : null;
}

async function servicios(db, contratoId) {
  const r = await db.query(`
    SELECT cs.id, cs.orden, cs.servicio_id, sv.nombre, cs.precio, cs.ciclo_pago, cs.descripcion
      FROM contrato_servicios cs JOIN servicios sv ON sv.id = cs.servicio_id
     WHERE cs.contrato_id = $1 ORDER BY cs.orden`, [contratoId]);
  return r.rows.map((x) => numeros(x, ['precio']));
}

/** c = { empresa_id, cliente_id, sucursal_id, cuenta_recaudacion_id, link_pago, lugar_celebracion,
 *        fecha_celebracion, fecha_inicio, duracion_meses, renovacion_automatica, estado, ejecutivo_id, observaciones }
 *  folio y fecha_vencimiento los asignan los triggers. */
async function crear(db, c) {
  const r = await db.query(`
    INSERT INTO contratos (empresa_id, cliente_id, sucursal_id, cuenta_recaudacion_id, link_pago, lugar_celebracion,
                           fecha_celebracion, fecha_inicio, duracion_meses, renovacion_automatica, estado,
                           ejecutivo_id, observaciones)
    VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'Santiago'), COALESCE($7::date, CURRENT_DATE), $8, $9, $10, $11, $12, $13)
    RETURNING id, folio`,
    [c.empresa_id, c.cliente_id, c.sucursal_id, c.cuenta_recaudacion_id, c.link_pago, c.lugar_celebracion,
      c.fecha_celebracion, c.fecha_inicio, c.duracion_meses, c.renovacion_automatica, c.estado,
      c.ejecutivo_id, c.observaciones]);
  return r.rows[0];
}

/** precio, ciclo_pago y descripcion en null -> los copia el trigger desde servicios */
async function agregarServicio(db, contratoId, s) {
  const r = await db.query(`
    INSERT INTO contrato_servicios (contrato_id, orden, servicio_id, precio, ciclo_pago, descripcion)
    VALUES ($1, COALESCE((SELECT max(orden) FROM contrato_servicios WHERE contrato_id = $1), 0) + 1, $2, $3, $4, $5)
    RETURNING id`, [contratoId, s.servicio_id, s.precio, s.ciclo_pago, s.descripcion]);
  return r.rows[0].id;
}

async function quitarServicio(db, contratoId, contratoServicioId) {
  const r = await db.query('DELETE FROM contrato_servicios WHERE id = $1 AND contrato_id = $2', [contratoServicioId, contratoId]);
  return r.rowCount > 0;
}

// Actualiza solo las columnas presentes en "cambios" (lista blanca)
const EDITABLES = ['estado', 'observaciones', 'ejecutivo_id', 'renovacion_automatica', 'link_pago', 'cuenta_recaudacion_id', 'fecha_vencimiento'];
async function actualizar(db, id, cambios) {
  const cols = EDITABLES.filter((c) => c in cambios);
  if (!cols.length) return true;
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const r = await db.query(`UPDATE contratos SET ${sets} WHERE id = $1 RETURNING id`, [id, ...cols.map((c) => cambios[c])]);
  return r.rowCount > 0;
}

// Copia un contrato con inicio al día siguiente de su vencimiento y precios vigentes del catálogo
async function renovar(db, id) {
  const r = await db.query(`
    INSERT INTO contratos (empresa_id, cliente_id, sucursal_id, cuenta_recaudacion_id, link_pago, lugar_celebracion,
                           fecha_inicio, duracion_meses, renovacion_automatica, estado, ejecutivo_id, observaciones)
    SELECT empresa_id, cliente_id, sucursal_id, cuenta_recaudacion_id, link_pago, lugar_celebracion,
           fecha_vencimiento + 1, duracion_meses, renovacion_automatica, 'activo', ejecutivo_id,
           'Renovación del folio ' || folio
      FROM contratos WHERE id = $1
    RETURNING id, folio`, [id]);
  if (!r.rows[0]) return null;
  await db.query(`
    INSERT INTO contrato_servicios (contrato_id, orden, servicio_id, precio, ciclo_pago, descripcion)
    SELECT $2, cs.orden, cs.servicio_id, COALESCE(sv.precio_lista, cs.precio), cs.ciclo_pago, cs.descripcion
      FROM contrato_servicios cs JOIN servicios sv ON sv.id = cs.servicio_id
     WHERE cs.contrato_id = $1`, [id, r.rows[0].id]);
  return r.rows[0];
}

// Datos para imprimir el contrato (vistas que reemplazan la combinación Excel → Word)
async function impresion(db, id) {
  const datos = (await db.query('SELECT * FROM v_datos_contrato WHERE contrato_id = $1', [id])).rows[0];
  if (!datos) return null;
  const servicios = (await db.query(
    'SELECT orden, servicio, precio, ciclo, contenido FROM v_datos_contrato_servicios WHERE contrato_id = $1 ORDER BY orden', [id]))
    .rows.map((x) => numeros(x, ['precio']));
  return { datos, servicios };
}

module.exports = {
  etapasRenovacion, listarPorVencer,
  listar, porCliente, obtener, servicios, crear, agregarServicio, quitarServicio, actualizar, renovar, impresion
};
