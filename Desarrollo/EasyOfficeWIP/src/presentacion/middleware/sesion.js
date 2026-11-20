/* =========================================================
   CAPA DE PRESENTACIÓN · Exige una sesión válida y deja req.usuario
   (con el rol vigente en la base: ver authServicio.validarSesion).
   ========================================================= */
const { errores } = require('../../comun/errores');
const authServicio = require('../../negocio/servicios/auth.servicio');
const { leerSesion } = require('./cookies');

async function requiereSesion(req, res, next) {
  try {
    const usuario = await authServicio.validarSesion(leerSesion(req));
    if (!usuario) return next(errores.noAutenticado());
    req.usuario = usuario;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requiereSesion };
