/* =========================================================
   CAPA DE DATOS · Plataforma de firma electrónica (adaptador).

   Toda plataforma se usa con las mismas operaciones, así el resto de la
   aplicación no cambia al pasar del simulador a la plataforma real:

     crearSolicitud({ documentoId, titulo, archivo, firmantes })
        → { idExterno, firmantes: [{ orden, idExterno, enlace }] }
        La plataforma avisa a cada firmante (correo con su enlace).
     enlace(idExternoFirmante)          → URL para que esa persona firme
     documentoFirmado({ idExterno, original, firmantes, codigo, urlVerificacion })
        → Buffer con el documento firmado que devuelve la plataforma

   La plataforma informa cada firma o rechazo a POST /api/firma/aviso
   (ver firma.servicio.registrarEvento).

   Proveedores: 'simulador' (laboratorio, TRL 4). Para la plataforma de
   Easy Office se agrega aquí un archivo con estas mismas operaciones.
   ========================================================= */
const config = require('../../config');
const { errores } = require('../../comun/errores');

const PROVEEDORES = {
  simulador: () => require('./simulador')
};

const activo = () => config.firma.proveedor in PROVEEDORES;
const nombre = () => config.firma.proveedor;

function proveedor() {
  if (!activo()) throw errores.conflicto('No hay una plataforma de firma electrónica configurada (FIRMA_PROVEEDOR).');
  return PROVEEDORES[config.firma.proveedor]();
}

module.exports = { activo, nombre, proveedor };
