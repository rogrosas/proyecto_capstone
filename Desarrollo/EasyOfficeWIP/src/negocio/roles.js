/* =========================================================
   CAPA DE NEGOCIO · Reglas de roles y permisos.
   esAdmin debe coincidir con app_es_admin() de easyoffice_v2.sql.
   Los permisos de cada rol (roles_permisos) se leen de la base en cada
   revisión: un cambio en Administración → Roles rige de inmediato, también
   para las sesiones abiertas. Los administradores (admin, dueno) tienen todos.

   Qué habilita cada permiso:
     ver_todos_los_clientes   ver y operar todos los clientes (sin él, su cartera)
     asignar_clientes         ejecutivo a cargo de clientes, contratos y documentos
     ver_todos_los_tickets    tickets de todos los clientes
     responder_tickets        responder y cambiar el estado de un ticket
     aprobar_documentos       aprobar un documento y publicarlo al cliente
     registrar_pagos          registrar un pago o cambiar su estado
     gestionar_renovaciones   renovar contratos, notificar alertas y enviar los avisos
     registrar_correspondencia  registrar, escanear, avisar y cerrar correspondencia
     ver_reportes             exportar listados a Excel (CSV)
     ver_auditoria            ver la auditoría
     eliminar_registros       eliminar clientes y quitar servicios de un contrato
     administrar_usuarios     usuarios, roles y permisos
     administrar_catalogos    catálogos, plantillas y documentos de la tienda
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

// Lanza 403 si el rol no tiene el permiso y deja la acción DENEGADO en la auditoría
async function exigirPermiso(usuario, permiso, mensaje = `Su rol no tiene el permiso «${permiso}». Pídalo a un administrador.`) {
  if (await tienePermiso(usuario, permiso)) return;
  try { await usuariosRepo.registrarDenegado(usuario.id, permiso); } catch (err) { console.warn('[roles] auditoría:', err.message); }
  throw errores.sinPermiso(mensaje);
}

module.exports = { esAdmin, permisosActuales, tienePermiso, exigirPermiso };
