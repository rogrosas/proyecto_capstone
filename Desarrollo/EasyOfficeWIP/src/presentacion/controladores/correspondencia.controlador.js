/* =========================================================
   CAPA DE PRESENTACIÓN · Correspondencia del domicilio tributario (CRM y portal).
   ========================================================= */
const servicio = require('../../negocio/servicios/correspondencia.servicio');

const responder = (fn) => async (req, res) => res.json(await fn(req));

// El escaneo se muestra en el navegador (PDF o imagen), sin que pueda ejecutar nada
function enviarArchivo(res, { nombre, tipo, contenido }) {
  res.set({
    'Content-Type': tipo, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
  }).send(contenido);
}

module.exports = {
  // CRM
  listar: responder((req) => servicio.listar(req.usuario, { estado: req.query.estado, q: req.query.q })),
  registrar: async (req, res) => res.status(201).json(await servicio.registrar(req.usuario, req.body)),
  subirEscaneo: responder((req) => servicio.subirEscaneo(req.usuario, req.params.id, req.body)),
  notificar: responder((req) => servicio.notificar(req.usuario, req.params.id)),
  cambiarEstado: responder((req) => servicio.cambiarEstado(req.usuario, req.params.id, req.body)),
  archivo: async (req, res) => enviarArchivo(res, await servicio.archivo(req.usuario, req.params.id)),

  // Portal
  delCliente: responder((req) => servicio.delCliente(req.cliente)),
  archivoCliente: async (req, res) => enviarArchivo(res, await servicio.archivoCliente(req.cliente, req.params.id)),
  marcarLeida: responder((req) => servicio.marcarLeida(req.cliente, req.params.id))
};
