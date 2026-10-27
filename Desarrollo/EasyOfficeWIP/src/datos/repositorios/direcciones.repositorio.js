/* =========================================================
   CAPA DE DATOS · Direcciones (direcciones → comunas → regiones).
   El índice único ux_direcciones_completa impide duplicar una dirección,
   por eso se busca primero y solo se inserta si no existe.
   ========================================================= */

/** d = { calle, numero, complemento, comuna_id }  -> id */
async function obtenerOCrear(db, d) {
  const existente = await db.query(
    `SELECT id FROM direcciones
      WHERE lower(calle) = lower($1) AND numero = $2
        AND COALESCE(lower(complemento), '') = COALESCE(lower($3), '') AND comuna_id = $4`,
    [d.calle, d.numero, d.complemento, d.comuna_id]);
  if (existente.rows[0]) return existente.rows[0].id;
  const r = await db.query(
    'INSERT INTO direcciones (calle, numero, complemento, comuna_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [d.calle, d.numero, d.complemento, d.comuna_id]);
  return r.rows[0].id;
}

async function obtener(db, id) {
  if (!id) return null;
  const r = await db.query(
    `SELECT d.id, d.calle, d.numero, d.complemento, d.comuna_id, c.nombre_comuna AS comuna,
            c.region_id, r.nombre_region AS region,
            fn_dir_calle(d.id) || ', ' || c.nombre_comuna AS texto
       FROM direcciones d JOIN comunas c ON c.id = d.comuna_id JOIN regiones r ON r.id = c.region_id
      WHERE d.id = $1`, [id]);
  return r.rows[0] || null;
}

module.exports = { obtenerOCrear, obtener };
