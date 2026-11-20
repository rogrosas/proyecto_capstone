/* =========================================================
   CAPA DE NEGOCIO · Reglas de roles y permisos.
   esAdmin debe coincidir con app_es_admin() de easyoffice_v2.sql.
   Los permisos de cada rol (roles_permisos) se leen de la base en cada
   revisión: un cambio en Administración → Roles rige de inmediato, también
   para las sesiones abiertas. Los administradores tienen todos los permisos.
   ========================================================= */
const config = require('../config');
const { errores } = require('../comun/errores');
const usuariosRepo = require('../datos/repositorios/usuarios.repositorio');

const esAdmin = (rol) => config.rolesAdmin.includes(String(rol || '').toLowerCase());

// Permisos vigentes del rol del usuario de la sesión
const permisosActuales = (usuario) => usuariosRepo.permisosDe(usuario.rol);

async function tienePermiso(usuario, permiso) {
  return !!usuario && (usuario.admin || (await permisosActuales(usuario)).includes(permiso));
}

async function exigirPermiso(usuario, permiso, mensaje = 'Su rol no tiene permiso para esta acción. Pídalo a un administrador.') {
  if (!(await tienePermiso(usuario, permiso))) throw errores.sinPermiso(mensaje);
}

module.exports = { esAdmin, permisosActuales, tienePermiso, exigirPermiso };
