/* =========================================================
   CAPA DE PRESENTACIÓN · Rutas /api/tienda (compra en /contratar, pública)
   ========================================================= */
const router = require('express').Router();
const { asincrono: a } = require('../middleware/errores');
const entrega = require('../controladores/entrega.controlador');

router.get('/planes/:codigo/preguntas', a(entrega.preguntasPlan));   // datos que piden los documentos del plan
router.get('/comunas', a(entrega.comunas));                          // para el domicilio del comprador
router.post('/compras', a(entrega.comprar));                        // cliente + contrato + pago + documentos

module.exports = router;
