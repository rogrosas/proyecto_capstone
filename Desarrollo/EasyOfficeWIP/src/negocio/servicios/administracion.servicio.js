/* =========================================================
   CAPA DE NEGOCIO · Usuarios del personal, roles y permisos
   (solo administradores).
   ========================================================= */
const bcrypt = require('bcryptjs');
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const usuariosRepo = require('../../datos/repositorios/usuarios.repositorio');
const rolesRepo = require('../../datos/repositorios/roles.repositorio');
const v = require('../validacion');

const MIN_CLAVE = 10;

function exigirAdmin(usuario) {
  if (!usuario.admin) throw errores.sinPermiso('Solo los administradores gestionan usuarios y roles.');
}

function clave(valor) {
  const c = String(valor || '');
  if (c.length < MIN_CLAVE) throw errores.solicitudInvalida(`La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`);
  return bcrypt.hash(c, 12);
}

/* ---------- Usuarios ---------- */
async function listarUsuarios(usuario) {
  exigirAdmin(usuario);
  return conUsuario(usuario, async (db) => ({ usuarios: await usuariosRepo.listar(db), roles: await rolesRepo.listar(db) }));
}

async function crearUsuario(usuario, d = {}) {
  exigirAdmin(usuario);
  const u = {
    nombre: v.texto(d.nombre, 'Nombre'),
    email: v.email(d.email, 'Correo', { opcional: false }),
    rol_id: v.id(d.rol_id, 'Rol'),
    password_hash: await clave(d.password)
  };
  return { id: await conUsuario(usuario, (db) => usuariosRepo.crear(db, u)) };
}

async function actualizarUsuario(usuario, id, d = {}) {
  exigirAdmin(usuario);
  id = v.id(id, 'Usuario');
  const cambios = {};
  if ('nombre' in d) cambios.nombre = v.texto(d.nombre, 'Nombre');
  if ('email' in d) cambios.email = v.email(d.email, 'Correo', { opcional: false });
  if ('rol_id' in d) cambios.rol_id = v.id(d.rol_id, 'Rol');
  if ('activo' in d) cambios.activo = v.booleano(d.activo);
  if (d.password) cambios.password_hash = await clave(d.password);
  if (id === usuario.id && (cambios.activo === false || 'rol_id' in cambios)) {
    throw errores.conflicto('No puede desactivarse ni cambiarse el rol a sí mismo.');
  }
  const ok = await conUsuario(usuario, (db) => usuariosRepo.actualizar(db, id, cambios));
  if (!ok) throw errores.noEncontrado('Usuario no encontrado.');
  return { ok: true };
}

/* ---------- Roles y permisos ---------- */
async function listarRoles(usuario) {
  exigirAdmin(usuario);
  return conUsuario(usuario, async (db) => ({ roles: await rolesRepo.listar(db), permisos: await rolesRepo.listarPermisos(db) }));
}

async function guardarRol(usuario, id, d = {}) {
  exigirAdmin(usuario);
  const rol = v.texto(d.rol, 'Nombre del rol', { max: 50 }).toLowerCase();
  const permisos = (Array.isArray(d.permisos) ? d.permisos : []).map((p) => v.id(p, 'Permiso'));
  return conUsuario(usuario, async (db) => {
    let rolId = id ? v.id(id, 'Rol') : null;
    if (rolId) { if (!(await rolesRepo.renombrar(db, rolId, rol))) throw errores.noEncontrado('Rol no encontrado.'); }
    else rolId = await rolesRepo.crear(db, rol);
    await rolesRepo.asignarPermisos(db, rolId, permisos);
    return { id: rolId };
  });
}

async function eliminarRol(usuario, id) {
  exigirAdmin(usuario);
  const ok = await conUsuario(usuario, (db) => rolesRepo.eliminar(db, v.id(id, 'Rol')));
  if (!ok) throw errores.noEncontrado('Rol no encontrado.');
  return { ok: true };
}

module.exports = { listarUsuarios, crearUsuario, actualizarUsuario, listarRoles, guardarRol, eliminarRol };
