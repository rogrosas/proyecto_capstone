/* =========================================================
   CAPA DE PRESENTACIÓN · Rutas /api/catalogo
   ========================================================= */
const router = require('express').Router();
const { asincrono } = require('../middleware/errores');
const catalogo = require('../controladores/catalogo.controlador');

router.get('/', catalogo.listar);
router.get('/:id', asincrono(catalogo.obtener));

module.exports = router;
