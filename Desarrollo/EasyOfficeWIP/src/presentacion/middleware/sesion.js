/* =========================================================
   CAPA DE PRESENTACIÓN · Exige una sesión válida y deja req.usuario.
   ========================================================= */
const { errores } = require('../../comun/errores');
const authServicio = require('../../negocio/servicios/auth.servicio');
const { leerSesion } = require('./cookies');

function requiereSesion(req, res, next) {
  const usuario = authServicio.validarSesion(leerSesion(req));
  if (!usuario) return next(errores.noAutenticado());
  req.usuario = usuario;
  next();
}

module.exports = { requiereSesion };
