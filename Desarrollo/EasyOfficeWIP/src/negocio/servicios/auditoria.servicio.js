/* =========================================================
   CAPA DE NEGOCIO · Auditoría.
   Regla: solo administradores (rol_ejecutivo no tiene SELECT sobre
   registros_actividad en la BD).
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const auditoriaRepo = require('../../datos/repositorios/auditoria.repositorio');

const ACCIONES = ['INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'];
const LIMITE = 300;

async function listar(usuario, { q, accion, dias }) {
  if (!usuario.admin) throw errores.sinPermiso('La auditoría solo está disponible para administradores.');
  const filtros = {
    dias: dias === '30' ? 30 : 7,
    accion: ACCIONES.includes(accion) ? accion : '',
    texto: String(q || '').trim().slice(0, 80)
  };
  const registros = await conUsuario(usuario, (db) => auditoriaRepo.listar(db, filtros, LIMITE));
  return { registros };
}

module.exports = { listar };
