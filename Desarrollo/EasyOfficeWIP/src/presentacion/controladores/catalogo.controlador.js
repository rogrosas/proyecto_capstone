/* =========================================================
   CAPA DE PRESENTACIÓN · Controlador del catálogo público.
   ========================================================= */
const catalogoServicio = require('../../negocio/servicios/catalogo.servicio');

module.exports = {
  listar: (req, res) => res.json(catalogoServicio.listar()),
  obtener: (req, res) => res.json(catalogoServicio.obtenerPlan(req.params.id))
};
