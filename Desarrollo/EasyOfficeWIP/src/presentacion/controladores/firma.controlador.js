/* =========================================================
   CAPA DE PRESENTACIÓN · Firma electrónica: envío desde el CRM, página del
   simulador, avisos de la plataforma y verificación pública por código.
   ========================================================= */
const firma = require('../../negocio/servicios/firma.servicio');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// La vista del documento es HTML convertido desde el Word: sin scripts ni recursos externos
function enviarHtml(res, html) {
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'
  }).send(html);
}

function enviarWord(res, { nombre, contenido }) {
  res.set({
    'Content-Type': DOCX, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
  }).send(contenido);
}

module.exports = {
  // CRM
  enviar: async (req, res) => res.json(await firma.enviar(req.usuario, req.params.id)),
  archivoFirmado: async (req, res) => enviarWord(res, await firma.archivoFirmadoPersonal(req.usuario, req.params.id)),

  // Simulador (/firma-simulada)
  verSimulada: async (req, res) => res.set('Cache-Control', 'no-store').json(await firma.verSimulada(req.params.token)),
  documentoSimulada: async (req, res) => enviarHtml(res, await firma.documentoSimulada(req.params.token)),
  firmarSimulada: async (req, res) => res.json(await firma.firmarSimulada(req.params.token, req.body, req.ip)),

  // Aviso de la plataforma real: { firmante, evento: 'firmado' | 'rechazado', motivo }, con el secreto compartido
  aviso: async (req, res) => {
    firma.validarAviso(req.get('X-Firma-Secreto'));
    res.json(await firma.registrarEvento({ ...req.body, ip: req.body?.ip || null }));
  },

  // Verificación pública
  verificar: async (req, res) => res.set('Cache-Control', 'no-store').json(await firma.verificar(req.params.codigo))
};
