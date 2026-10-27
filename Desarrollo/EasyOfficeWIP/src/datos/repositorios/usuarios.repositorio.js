/* =========================================================
   CAPA DE DATOS · Repositorio de usuarios del personal
   (tablas usuarios, roles y registros_actividad para LOGIN/LOGOUT).
   Usa consultaSistema porque se ejecuta antes de conocer al usuario.
   ========================================================= */
const { consultaSistema } = require('../conexion');

async function buscarPorEmail(email) {
  const r = await consultaSistema(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.activo, r.rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.email = $1`, [email]);
  return r.rows[0] || null;
}

async function registrarAcceso(usuarioId, accion) {
  await consultaSistema(
    "INSERT INTO registros_actividad (usuario_id, tabla_afectada, registro_id, accion) VALUES ($1, 'usuarios', $2, $3)",
    [usuarioId, String(usuarioId), accion]);
}

// Permisos del rol del usuario (roles_permisos → permisos)
async function permisosDe(rolNombre) {
  const r = await consultaSistema(
    `SELECT p.permiso FROM roles ro
       JOIN roles_permisos rp ON rp.rol_id = ro.id JOIN permisos p ON p.id = rp.permisos_id
      WHERE ro.rol = $1 ORDER BY p.permiso`, [rolNombre]);
  return r.rows.map((x) => x.permiso);
}

/* ---------- Administración (se ejecutan con conUsuario como rol_admin) ---------- */

async function listar(db) {
  const r = await db.query(`
    SELECT u.id, u.nombre, u.email, u.rol_id, r.rol, u.activo,
           (SELECT max(fecha) FROM registros_actividad ra WHERE ra.usuario_id = u.id AND ra.accion = 'LOGIN')::date::text AS ultimo_acceso
      FROM usuarios u JOIN roles r ON r.id = u.rol_id ORDER BY u.activo DESC, u.nombre`);
  return r.rows;
}

async function crear(db, u) {
  const r = await db.query('INSERT INTO usuarios (nombre, email, rol_id, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [u.nombre, u.email, u.rol_id, u.password_hash]);
  return r.rows[0].id;
}

const EDITABLES = ['nombre', 'email', 'rol_id', 'activo', 'password_hash'];
async function actualizar(db, id, cambios) {
  const cols = EDITABLES.filter((c) => c in cambios);
  if (!cols.length) return true;
  const r = await db.query(`UPDATE usuarios SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`,
    [id, ...cols.map((c) => cambios[c])]);
  return r.rowCount > 0;
}

module.exports = { buscarPorEmail, registrarAcceso, permisosDe, listar, crear, actualizar };
