/* =========================================================
   CAPA DE PRESENTACIÓN · Documentos de la tienda, borradores con marca
   de agua, aceptación del cliente y tickets (CRM, portal y tienda).
   ========================================================= */
const entrega = require('../../negocio/servicios/entrega.servicio');
const archivosServicio = require('../../negocio/servicios/archivos.servicio');
const tienda = require('../../negocio/servicios/tienda.servicio');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// El borrador es HTML convertido desde el Word: sin scripts ni recursos externos
function enviarBorrador(res, html) {
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'private, no-store'
  });
  res.send(html);
}

function enviarDocx(res, { nombre, contenido }) {
  res.set({
    'Content-Type': DOCX,
    'Content-Disposition': `attachment; filename="${nombre.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'Cache-Control': 'private, no-store'
  });
  res.send(contenido);
}

const responder = (fn) => async (req, res) => res.json(await fn(req));

module.exports = {
  // CRM
  borradorPersonal: async (req, res) => enviarBorrador(res, await entrega.borradorPersonal(req.usuario, req.params.id)),
  publicar: responder((req) => entrega.publicar(req.usuario, req.params.id)),
  listarTickets: responder((req) => entrega.listarTickets(req.usuario, { estado: req.query.estado, documento: req.query.documento })),
  atenderTicket: responder((req) => entrega.atenderTicket(req.usuario, req.params.id, req.body)),
  preguntasGeneracion: responder((req) => archivosServicio.preguntasGeneracion(req.usuario, req.params.id, req.query.contrato)),
  documentosTienda: responder((req) => archivosServicio.documentosTienda(req.usuario)),
  camposPlantilla: responder((req) => archivosServicio.camposPlantilla(req.usuario, req.params.id)),
  configurarTienda: responder((req) => archivosServicio.configurarTienda(req.usuario, req.params.id, req.body)),

  // Portal del cliente
  borradorCliente: async (req, res) => enviarBorrador(res, await entrega.borradorCliente(req.cliente, req.params.id)),
  aceptar: responder((req) => entrega.aceptar(req.cliente, req.params.id, req.body, req.ip)),
  ticketDocumento: responder((req) => entrega.enviarTicket(req.cliente, req.params.id, req.body)),
  ticket: responder((req) => entrega.enviarTicket(req.cliente, null, req.body)),
  archivoFinal: async (req, res) => enviarDocx(res, await entrega.archivoFinal(req.cliente, req.params.id)),
  ticketsCliente: responder((req) => entrega.ticketsCliente(req.cliente)),

  // Tienda
  preguntasPlan: responder((req) => tienda.preguntas(req.params.codigo)),
  comunas: responder(() => tienda.comunas()),
  comprar: async (req, res) => res.status(201).json(await tienda.comprar(req.body, req.ip))
};
