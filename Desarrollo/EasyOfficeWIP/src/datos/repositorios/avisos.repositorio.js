/* =========================================================
   CAPA DE DATOS · Avisos de vencimiento por correo (alertas, ejecuciones_avisos).
   Las alertas las crea la base (fn_generar_alertas); aquí se buscan las que ya
   tocan y se marcan como enviadas por correo.
   ========================================================= */
const { numeros } = require('../conversion');
const { SIN_RENOVAR, SERVICIOS_CONTRATO } = require('../sql/fragmentos');

// Un registro por contrato con alertas cuya fecha ya llegó y que siguen sin avisar
async function pendientes(db) {
  const r = await db.query(`
    SELECT k.id AS contrato_id, k.folio, k.fecha_vencimiento::text AS vence, (k.fecha_vencimiento - CURRENT_DATE) AS dias,
           k.renovacion_automatica, cl.id AS cliente_id, cl.razon_social AS cliente,
           ${SERVICIOS_CONTRATO} AS servicios, u.nombre AS ejecutivo, u.email AS ejecutivo_email,
           array_agg(a.id ORDER BY a.id) AS alertas
      FROM alertas a
      JOIN contratos k ON k.id = a.contrato_id
      JOIN clientes cl ON cl.id = k.cliente_id
      LEFT JOIN usuarios u ON u.id = k.ejecutivo_id AND u.activo
     WHERE NOT a.notificado AND a.fecha_alerta <= CURRENT_DATE
       AND k.estado = 'activo' AND k.fecha_vencimiento >= CURRENT_DATE AND ${SIN_RENOVAR}
     GROUP BY k.id, cl.id, u.id
     ORDER BY k.fecha_vencimiento`);
  return r.rows.map((x) => numeros(x, ['dias']));
}

async function marcarEnviadas(db, alertas) {
  await db.query("UPDATE alertas SET notificado = true, canal = 'correo', enviado_en = now() WHERE id = ANY($1) AND NOT notificado", [alertas]);
}

// Correos de los administradores activos (reciben el resumen de los contratos sin ejecutivo)
async function correosAdministradores(db, rolesAdmin) {
  const r = await db.query(`SELECT u.email FROM usuarios u JOIN roles ro ON ro.id = u.rol_id
                             WHERE u.activo AND ro.rol = ANY($1) ORDER BY u.id`, [rolesAdmin]);
  return r.rows.map((x) => x.email);
}

async function ejecutadoHoy(db, zona) {
  const r = await db.query(`SELECT 1 FROM ejecuciones_avisos
                             WHERE origen = 'automatico' AND (iniciado_en AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`, [zona]);
  return r.rowCount > 0;
}

async function registrar(db, e) {
  const r = await db.query(`
    INSERT INTO ejecuciones_avisos (origen, usuario_id, iniciado_en, terminado_en, contratos, correos, sin_correo, errores, detalle)
    VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8) RETURNING id`,
  [e.origen, e.usuarioId, e.iniciado, e.contratos, e.correos, e.sinCorreo, e.errores, JSON.stringify(e.detalle)]);
  return r.rows[0].id;
}

async function ultimas(db, limite, zona) {
  const r = await db.query(`
    SELECT x.id, x.origen, u.nombre AS usuario, to_char(x.iniciado_en AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS iniciado, x.contratos, x.correos, x.sin_correo, x.errores, x.detalle
      FROM ejecuciones_avisos x LEFT JOIN usuarios u ON u.id = x.usuario_id
     ORDER BY x.iniciado_en DESC LIMIT $1`, [limite, zona]);
  return r.rows;
}

module.exports = { pendientes, marcarEnviadas, correosAdministradores, ejecutadoHoy, registrar, ultimas };
