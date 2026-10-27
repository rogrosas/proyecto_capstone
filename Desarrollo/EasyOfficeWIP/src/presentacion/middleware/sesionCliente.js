/* =========================================================
   CAPA DE PRESENTACIÓN · Exige una sesión de cliente y deja req.cliente.
   ========================================================= */
const { errores } = require('../../comun/errores');
const portalServicio = require('../../negocio/servicios/portal.servicio');
const { leerSesionCliente } = require('./cookies');

function requiereSesionCliente(req, res, next) {
  const cliente = portalServicio.validarSesion(leerSesionCliente(req));
  if (!cliente) return next(errores.noAutenticado());
  req.cliente = cliente;
  next();
}

module.exports = { requiereSesionCliente };
