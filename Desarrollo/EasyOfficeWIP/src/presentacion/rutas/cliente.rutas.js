/* =========================================================
   CAPA DE PRESENTACIÓN · Rutas /api/cliente (portal de clientes)
   ========================================================= */
const router = require('express').Router();
const { asincrono: a } = require('../middleware/errores');
const { requiereSesionCliente } = require('../middleware/sesionCliente');
const portal = require('../controladores/portal.controlador');

// Públicas
router.post('/acceso', a(portal.solicitarAcceso));    // pide el enlace mágico
router.post('/verificar', a(portal.verificar));       // canjea el enlace por una sesión
router.post('/salir', a(portal.salir));

// Requieren sesión de cliente
router.use(requiereSesionCliente);
router.get('/yo', portal.yo);
router.get('/panel', a(portal.panel));

module.exports = router;
