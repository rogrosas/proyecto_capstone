/* =========================================================
   CAPA DE PRESENTACIÓN · Rutas /api/tienda (compra en /contratar, pública)
   ========================================================= */
const router = require('express').Router();
const { asincrono: a } = require('../middleware/errores');
const { limitePorIp } = require('../middleware/limite');
const entrega = require('../controladores/entrega.controlador');

const limitePago = limitePorIp(60, 10 * 60 * 1000);

router.get('/planes/:codigo/preguntas', a(entrega.preguntasPlan));   // datos que piden los documentos del plan
router.get('/comunas', a(entrega.comunas));                          // para el domicilio del comprador
router.post('/compras', a(entrega.comprar));                        // cliente + contrato + pago (+ documentos al pagar)

// Vuelta de la pasarela de pago (el token lo firma la pasarela): el contrato y los documentos siguen solo con el pago aprobado
router.get('/pago/:token', limitePago, a(entrega.estadoPago));
router.post('/pago/:token', limitePago, a(entrega.confirmarPago));
router.post('/pago/:token/reintentar', limitePago, a(entrega.reintentarPago));

module.exports = router;
