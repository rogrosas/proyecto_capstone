/* =========================================================
   CAPA DE PRESENTACIÓN · Plantillas Word y contratos generados
   ========================================================= */
const archivosServicio = require('../../negocio/servicios/archivos.servicio');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const descargar = (fn) => async (req, res) => {
  const { nombre, contenido } = await fn(req);
  res.set({
    'Content-Type': DOCX,
    'Content-Disposition': `attachment; filename="${nombre.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'Cache-Control': 'private, no-store'
  });
  res.send(contenido);
};

module.exports = {
  plantillas: async (req, res) => res.json(await archivosServicio.plantillas(req.usuario)),
  generarContrato: async (req, res) => res.status(201).json(await archivosServicio.generarContrato(req.usuario, req.params.id, req.body)),
  archivoDocumento: descargar((req) => archivosServicio.archivoDocumento(req.usuario, req.params.id)),
  archivoPlantilla: descargar((req) => archivosServicio.archivoPlantilla(req.usuario, req.params.id)),
  listarArchivos: async (req, res) => res.json(await archivosServicio.listarArchivos(req.usuario)),
  subirArchivo: async (req, res) => res.status(201).json(await archivosServicio.subirArchivo(req.usuario, req.query, req.body))
};
