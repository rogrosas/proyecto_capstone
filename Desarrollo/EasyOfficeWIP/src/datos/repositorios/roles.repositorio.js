/* =========================================================
   CAPA DE DATOS · Roles, permisos y su relación (roles_permisos).
   ========================================================= */
const { num } = require('../conversion');

async function listar(db) {
  const r = await db.query(`
    SELECT ro.id, ro.rol,
           COALESCE(array_agg(rp.permisos_id ORDER BY rp.permisos_id) FILTER (WHERE rp.permisos_id IS NOT NULL), '{}') AS permisos,
           (SELECT count(*) FROM usuarios u WHERE u.rol_id = ro.id) AS usuarios
      FROM roles ro LEFT JOIN roles_permisos rp ON rp.rol_id = ro.id
     GROUP BY ro.id ORDER BY ro.id`);
  return r.rows.map((x) => ({ ...x, usuarios: num(x.usuarios) }));
}

async function listarPermisos(db) {
  return (await db.query('SELECT id, permiso FROM permisos ORDER BY permiso')).rows;
}

async function crear(db, rol) {
  return (await db.query('INSERT INTO roles (rol) VALUES ($1) RETURNING id', [rol])).rows[0].id;
}

async function renombrar(db, id, rol) {
  return (await db.query('UPDATE roles SET rol = $2 WHERE id = $1 RETURNING id', [id, rol])).rowCount > 0;
}

async function eliminar(db, id) {
  return (await db.query('DELETE FROM roles WHERE id = $1 RETURNING id', [id])).rowCount > 0;
}

// Reemplaza los permisos del rol por la lista indicada
async function asignarPermisos(db, rolId, permisosIds) {
  await db.query('DELETE FROM roles_permisos WHERE rol_id = $1 AND NOT (permisos_id = ANY($2::int[]))', [rolId, permisosIds]);
  await db.query(`INSERT INTO roles_permisos (rol_id, permisos_id)
                  SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`, [rolId, permisosIds]);
}

module.exports = { listar, listarPermisos, crear, renombrar, eliminar, asignarPermisos };
