/* =========================================================
   CAPA DE DATOS · Catálogo de planes del sitio público.
   Hoy la fuente es public/js/catalogo.js (el mismo archivo que usa el
   navegador). Cuando el catálogo se lea de la tabla servicios, solo
   cambia este archivo.
   ========================================================= */
const CATALOGO = require('../../../public/js/catalogo');

function todos() {
  return CATALOGO;
}

function plan(id) {
  for (const f of CATALOGO) {
    const p = f.plans.find((x) => x.id === id);
    if (p) return { ...p, fam: f.tab, famId: f.id };
  }
  return null;
}

module.exports = { todos, plan };
