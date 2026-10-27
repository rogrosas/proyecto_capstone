/* =========================================================
   CAPA DE DATOS · Repositorio de auditoría (registros_actividad).
   Solo lectura: la tabla es inmutable por trigger.
   ========================================================= */
const config = require('../../config');

async function listar(db, { dias, accion, texto }, limite) {
  const r = await db.query(`
    SELECT ra.id, to_char(ra.fecha AT TIME ZONE $5, 'YYYY-MM-DD HH24:MI') AS fecha,
           COALESCE(u.nombre, CASE WHEN ra.tabla_afectada = 'clientes' AND ra.accion IN ('LOGIN', 'LOGOUT')
                                   THEN 'Cliente (portal) #' || ra.registro_id ELSE 'Sistema' END) AS usuario,
           COALESCE(ro.rol, CASE WHEN ra.tabla_afectada = 'clientes' AND ra.accion IN ('LOGIN', 'LOGOUT')
                                 THEN 'cliente' ELSE 'automático' END) AS rol,
           ra.accion, ra.tabla_afectada, ra.registro_id
      FROM registros_actividad ra
      LEFT JOIN usuarios u ON u.id = ra.usuario_id
      LEFT JOIN roles ro   ON ro.id = u.rol_id
     WHERE ra.fecha >= now() - make_interval(days => $1)
       AND ($2 = '' OR ra.accion = $2)
       AND ($3 = '' OR u.nombre ILIKE '%' || $3 || '%' OR ra.tabla_afectada ILIKE '%' || $3 || '%' OR ra.registro_id = $3)
     ORDER BY ra.fecha DESC
     LIMIT $4`, [dias, accion, texto, limite, config.bd.zonaHoraria]);
  return r.rows;
}

module.exports = { listar };
