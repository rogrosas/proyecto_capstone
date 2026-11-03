/* =========================================================
   CAPA DE DATOS · Repositorio de usuarios del personal
   (tablas usuarios, roles y registros_actividad para LOGIN/LOGOUT).
   Usa consultaSistema porque se ejecuta antes de conocer al usuario.
   ========================================================= */
const { consultaSistema } = require('../conexion');

const COLUMNAS_ACCESO = `u.id, u.nombre, u.email, u.password_hash, u.activo, r.rol,
       u.totp_activo, u.totp_secreto, u.intentos_fallidos, u.bloqueado_hasta > now() AS bloqueado`;

async function buscarPorEmail(email) {
  const r = await consultaSistema(`SELECT ${COLUMNAS_ACCESO} FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.email = $1`, [email]);
  return r.rows[0] || null;
}

async function porId(id) {
  const r = await consultaSistema(`SELECT ${COLUMNAS_ACCESO} FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = $1`, [id]);
  return r.rows[0] || null;
}

/* ---------- Bloqueo por claves malas seguidas ---------- */
async function registrarFallo(id, max, bloqueoMs) {
  const r = await consultaSistema(`
    UPDATE usuarios SET intentos_fallidos = intentos_fallidos + 1,
           bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2 THEN now() + make_interval(secs => $3 / 1000.0) ELSE bloqueado_hasta END
     WHERE id = $1 RETURNING intentos_fallidos`, [id, max, bloqueoMs]);
  return r.rows[0]?.intentos_fallidos || 0;
}

async function ingresoExitoso(id) {
  await consultaSistema('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id = $1', [id]);
}

/* ---------- Segundo factor y contraseña (los cambia el propio usuario) ---------- */
async function guardarTotp(id, secretoCifrado) {
  await consultaSistema('UPDATE usuarios SET totp_secreto = $2::text, totp_activo = $2::text IS NOT NULL WHERE id = $1', [id, secretoCifrado]);
}

async function cambiarClave(id, hash) {
  await consultaSistema('UPDATE usuarios SET password_hash = $2, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [id, hash]);
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
    SELECT u.id, u.nombre, u.email, u.rol_id, r.rol, u.activo, u.totp_activo, u.bloqueado_hasta > now() AS bloqueado,
           (SELECT max(fecha) FROM registros_actividad ra WHERE ra.usuario_id = u.id AND ra.accion = 'LOGIN')::date::text AS ultimo_acceso
      FROM usuarios u JOIN roles r ON r.id = u.rol_id ORDER BY u.activo DESC, u.nombre`);
  return r.rows;
}

async function crear(db, u) {
  const r = await db.query('INSERT INTO usuarios (nombre, email, rol_id, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [u.nombre, u.email, u.rol_id, u.password_hash]);
  return r.rows[0].id;
}

const EDITABLES = ['nombre', 'email', 'rol_id', 'activo', 'password_hash', 'totp_activo', 'totp_secreto', 'intentos_fallidos', 'bloqueado_hasta'];
async function actualizar(db, id, cambios) {
  const cols = EDITABLES.filter((c) => c in cambios);
  if (!cols.length) return true;
  const r = await db.query(`UPDATE usuarios SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`,
    [id, ...cols.map((c) => cambios[c])]);
  return r.rowCount > 0;
}

module.exports = {
  buscarPorEmail, porId, registrarFallo, ingresoExitoso, guardarTotp, cambiarClave, registrarAcceso, permisosDe, listar, crear, actualizar
};
