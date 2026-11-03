/* =========================================================
   CAPA DE DATOS · Simulador de la pasarela de pago (laboratorio, ADR-011).
   Imita el ida y vuelta de Webpay / Mercado Pago: la tienda pide un cobro,
   el comprador va a /pago-simulado, aprueba o rechaza, y vuelve a la tienda.
   No pide datos de tarjeta: es solo para validar el flujo.
   ========================================================= */
const crypto = require('crypto');
const config = require('../../config');
const { errores } = require('../../comun/errores');

const SECRETO = config.pago.secreto || crypto.randomBytes(32).toString('hex');
const firmar = (texto) => crypto.createHmac('sha256', SECRETO).update(texto).digest('base64url');

function token(idTransaccion) {
  const datos = Buffer.from(JSON.stringify({ t: idTransaccion, e: Date.now() + config.pago.enlaceMs })).toString('base64url');
  return `${datos}.${firmar(datos)}`;
}

function leerToken(t) {
  const [datos, sello] = String(t || '').split('.');
  const esperado = datos ? firmar(datos) : '';
  if (!datos || !sello || sello.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sello), Buffer.from(esperado))) {
    throw errores.noAutenticado('El enlace de pago no es válido.');
  }
  const { t: id, e } = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
  if (e < Date.now()) throw errores.noAutenticado('El enlace de pago venció. Vuelva a la tienda para intentarlo de nuevo.');
  return id;
}

async function crearCobro({ pagoId }) {
  const idTransaccion = `SIM-${pagoId}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  return { idTransaccion, url: `/pago-simulado?t=${token(idTransaccion)}` };
}

// Respuesta que entregaría la pasarela al aprobar (se guarda en pagos.respuesta_pasarela)
function respuestaAprobada(idTransaccion) {
  return {
    simulador: true, estado: 'AUTHORIZED', id: idTransaccion,
    codigo_autorizacion: String(crypto.randomInt(100000, 999999)), ultimos_4: '6623', fecha: new Date().toISOString()
  };
}

module.exports = { crearCobro, leerToken, respuestaAprobada };
