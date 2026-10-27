/* =========================================================
   CAPA DE PRESENTACIÓN · Rutas /api/cliente (portal de clientes)
   ========================================================= */
const router = require('express').Router();
const { asincrono: a } = require('../middleware/errores');
const { requiereSesionCliente } = require('../middleware/sesionCliente');
const portal = require('../controladores/portal.controlador');
const entrega = require('../controladores/entrega.controlador');

// Públicas
router.post('/ingresar', a(portal.ingresar));             // empresa (RUT + correo) o persona (correo) + contraseña
router.post('/clave', a(portal.solicitarClave));          // envía el enlace para crear o recuperar la contraseña
router.post('/clave/definir', a(portal.definirClave));    // define la contraseña con ese enlace e inicia sesión
router.post('/salir', a(portal.salir));

// Requieren sesión de cliente
router.use(requiereSesionCliente);
router.get('/yo', portal.yo);
router.get('/panel', a(portal.panel));

// Documentos: borrador con marca de agua → aceptar (y descargar el final) o enviar un ticket
router.get('/documentos/:id/borrador', a(entrega.borradorCliente));
router.post('/documentos/:id/aceptar', a(entrega.aceptar));
router.post('/documentos/:id/ticket', a(entrega.ticketDocumento));
router.get('/documentos/:id/archivo', a(entrega.archivoFinal));
router.get('/tickets', a(entrega.ticketsCliente));
router.post('/tickets', a(entrega.ticket));

module.exports = router;
