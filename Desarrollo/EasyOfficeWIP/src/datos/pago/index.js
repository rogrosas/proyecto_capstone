/* =========================================================
   CAPA DE DATOS · Pasarela de pago (adaptador).

   Toda pasarela se usa con las mismas operaciones, así la tienda no cambia
   al pasar del simulador a Webpay o Mercado Pago (ADR-009):

     crearCobro({ pagoId, monto, descripcion, pasarela }) → { idTransaccion, url }
        url: página de la pasarela a la que se envía al comprador.
     leerToken(token) → idTransaccion        (el retorno trae el token de la pasarela)

   El resultado (aprobado o rechazado) llega a tienda.servicio.confirmarPago,
   que verifica el pago ANTES de activar el contrato y generar los documentos.
   ========================================================= */
const config = require('../../config');
const { errores } = require('../../comun/errores');

const PROVEEDORES = {
  simulador: () => require('./simulador')
};

const activo = () => config.pago.proveedor in PROVEEDORES;
const nombre = () => config.pago.proveedor;

function proveedor() {
  if (!activo()) throw errores.conflicto('No hay una pasarela de pago configurada (PAGO_PROVEEDOR).');
  return PROVEEDORES[config.pago.proveedor]();
}

module.exports = { activo, nombre, proveedor };
