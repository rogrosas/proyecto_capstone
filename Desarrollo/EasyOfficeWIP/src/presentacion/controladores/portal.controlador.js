/* =========================================================
   CAPA DE PRESENTACIÓN · Controlador del portal de clientes.
   ========================================================= */
const config = require('../../config');
const portalServicio = require('../../negocio/servicios/portal.servicio');
const { leerSesionCliente, escribirSesionCliente, borrarSesionCliente } = require('../middleware/cookies');

module.exports = {
  solicitarAcceso: async (req, res) => res.json(await portalServicio.solicitarAcceso(req.body?.email, req.ip)),

  verificar: async (req, res) => {
    const { token, cliente } = await portalServicio.verificarEnlace(req.body?.token);
    escribirSesionCliente(res, token, config.cliente.duracionMs);
    res.json({ cliente });
  },

  salir: async (req, res) => {
    await portalServicio.cerrarSesion(leerSesionCliente(req));
    borrarSesionCliente(res);
    res.json({ ok: true });
  },

  yo: (req, res) => res.json({ cliente: req.cliente }),

  panel: async (req, res) => res.json(await portalServicio.panel(req.cliente))
};
