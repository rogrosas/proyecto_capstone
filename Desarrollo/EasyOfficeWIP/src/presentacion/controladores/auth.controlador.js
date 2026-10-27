/* =========================================================
   CAPA DE PRESENTACIÓN · Controlador de sesión del CRM.
   ========================================================= */
const config = require('../../config');
const authServicio = require('../../negocio/servicios/auth.servicio');
const { leerSesion, escribirSesion, borrarSesion } = require('../middleware/cookies');

async function login(req, res) {
  const { token, usuario } = await authServicio.iniciarSesion(req.body?.email, req.body?.password, req.ip);
  escribirSesion(res, token, config.sesion.duracionMs);
  res.json({ usuario });
}

async function logout(req, res) {
  await authServicio.cerrarSesion(leerSesion(req));
  borrarSesion(res);
  res.json({ ok: true });
}

function yo(req, res) {
  res.json({ usuario: req.usuario });
}

module.exports = { login, logout, yo };
