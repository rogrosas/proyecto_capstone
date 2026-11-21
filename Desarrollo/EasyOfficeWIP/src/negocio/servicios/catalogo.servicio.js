/* =========================================================
   CAPA DE NEGOCIO · Catálogo de planes del sitio público.
   ========================================================= */
const { errores } = require('../../comun/errores');
const catalogoRepo = require('../../datos/repositorios/catalogo.repositorio');

const listar = () => catalogoRepo.todos();

async function obtenerPlan(id) {
  const p = await catalogoRepo.plan(String(id));
  if (!p) throw errores.noEncontrado('Plan no encontrado');
  return p;
}

module.exports = { listar, obtenerPlan };
