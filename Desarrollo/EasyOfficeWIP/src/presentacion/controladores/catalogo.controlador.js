/* =========================================================
   CAPA DE PRESENTACIÓN · Controlador del catálogo público.
   ========================================================= */
const catalogoServicio = require('../../negocio/servicios/catalogo.servicio');

module.exports = {
  listar: async (req, res) => res.json(await catalogoServicio.listar()),
  obtener: async (req, res) => res.json(await catalogoServicio.obtenerPlan(req.params.id)),

  // /js/catalogo.js: deja window.CATALOGO como lo esperan contratar.js y planes.js
  script: async (req, res, next) => {
    try {
      const datos = await catalogoServicio.listar();
      res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.send(`window.CATALOGO = ${JSON.stringify(datos).replace(/</g, '\\u003c')};\n`);
    } catch (err) {
      next(err);
    }
  }
};
