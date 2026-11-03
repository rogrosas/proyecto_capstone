/* =========================================================
   CAPA DE PRESENTACIÓN · Controlador de sesión del CRM.
   ========================================================= */
const config = require('../../config');
const authServicio = require('../../negocio/servicios/auth.servicio');
const { leerSesion, escribirSesion, borrarSesion } = require('../middleware/cookies');

// Con segundo factor, el paso 1 no abre sesión: devuelve el desafío para pedir el código
async function login(req, res) {
  const r = await authServicio.iniciarSesion(req.body?.email, req.body?.password, req.ip);
  if (r.desafio) return res.json({ requiereCodigo: true, desafio: r.desafio });
  escribirSesion(res, r.token, config.sesion.duracionMs);
  res.json({ usuario: r.usuario });
}

async function loginCodigo(req, res) {
  const { token, usuario } = await authServicio.iniciarConCodigo(req.body?.desafio, req.body?.codigo, req.ip);
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

const responder = (fn) => async (req, res) => res.json(await fn(req));

module.exports = {
  login, loginCodigo, logout, yo,
  solicitarClave: responder((req) => authServicio.solicitarClave(req.body?.email, req.ip)),
  definirClave: responder((req) => authServicio.definirClave(req.body?.token, req.body?.password)),
  seguridad: responder((req) => authServicio.seguridad(req.usuario)),
  iniciarTotp: responder((req) => authServicio.iniciarTotp(req.usuario)),
  activarTotp: responder((req) => authServicio.activarTotp(req.usuario, req.body?.codigo)),
  desactivarTotp: responder((req) => authServicio.desactivarTotp(req.usuario, req.body?.codigo))
};
