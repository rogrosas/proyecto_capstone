/* =========================================================
   CAPA DE DATOS · Representantes legales.
   Tiene seguridad por fila: registrado_por toma app_usuario() por defecto.
   ========================================================= */

async function buscarPorRut(db, rut) {
  const r = await db.query('SELECT id FROM representantes_legales WHERE rut = $1', [rut]);
  return r.rows[0]?.id || null;
}

async function obtener(db, id) {
  if (!id) return null;
  const r = await db.query(
    `SELECT id, rut, fn_rut_formato(rut) AS rut_fmt, nombre_completo, nacionalidad, estado_civil, profesion, email, direccion_id
       FROM representantes_legales WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

/** r = { rut, nombre_completo, nacionalidad, estado_civil, profesion, email, direccion_id } */
async function crear(db, r) {
  const x = await db.query(
    `INSERT INTO representantes_legales (rut, nombre_completo, nacionalidad, estado_civil, profesion, email, direccion_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [r.rut, r.nombre_completo, r.nacionalidad, r.estado_civil, r.profesion, r.email, r.direccion_id]);
  return x.rows[0].id;
}

async function actualizar(db, id, r) {
  await db.query(
    `UPDATE representantes_legales
        SET nombre_completo = $2, nacionalidad = $3, estado_civil = $4, profesion = $5, email = $6, direccion_id = $7
      WHERE id = $1`,
    [id, r.nombre_completo, r.nacionalidad, r.estado_civil, r.profesion, r.email, r.direccion_id]);
}

module.exports = { buscarPorRut, obtener, crear, actualizar };
