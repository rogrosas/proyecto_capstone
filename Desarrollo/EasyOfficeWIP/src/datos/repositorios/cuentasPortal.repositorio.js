/* =========================================================
   CAPA DE DATOS · Accesos al portal de clientes desde el CRM (cuentas_portal).
   Corre con el rol del usuario: la seguridad por fila limita a su cartera
   y el ejecutivo nunca puede leer password_hash.
   ========================================================= */

async function porCliente(db, clienteId) {
  const r = await db.query(
    `SELECT cp.email, cp.nombre, cp.autorizado, cp.activo, cp.clave_definida_en IS NOT NULL AS con_clave,
            cp.ultimo_ingreso, u.nombre AS registrado_por
       FROM cuentas_portal cp LEFT JOIN usuarios u ON u.id = cp.registrado_por
      WHERE cp.cliente_id = $1 ORDER BY cp.creado_en`, [clienteId]);
  return r.rows;
}

/** a = { nombre?, autorizado?, activo? }: solo cambia lo que viene definido */
async function guardar(db, clienteId, email, a) {
  await db.query(
    `INSERT INTO cuentas_portal (cliente_id, email, nombre, autorizado, activo)
     VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, true))
     ON CONFLICT (cliente_id, email) DO UPDATE
        SET nombre     = COALESCE(EXCLUDED.nombre, cuentas_portal.nombre),
            autorizado = COALESCE($4, cuentas_portal.autorizado),
            activo     = COALESCE($5, cuentas_portal.activo)`,
    [clienteId, email, a.nombre ?? null, a.autorizado ?? null, a.activo ?? null]);
}

module.exports = { porCliente, guardar };
