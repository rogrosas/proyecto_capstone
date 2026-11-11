/* =========================================================
   CAPA DE PRESENTACIÓN · Rutas /api/cliente (portal de clientes)
   ========================================================= */
const router = require('express').Router();
const { asincrono: a } = require('../middleware/errores');
const { requiereSesionCliente } = require('../middleware/sesionCliente');
const portal = require('../controladores/portal.controlador');
const entrega = require('../controladores/entrega.controlador');
const correspondencia = require('../controladores/correspondencia.controlador');

// Públicas
router.post('/ingresar', a(portal.ingresar));             // empresa (RUT + correo) o persona (correo) + contraseña
router.post('/clave', a(portal.solicitarClave));          // envía el enlace para crear o recuperar la contraseña
router.post('/clave/definir', a(portal.definirClave));    // define la contraseña con ese enlace e inicia sesión
router.post('/registro', a(portal.registrar));           // quien aún no es cliente: valida y envía el enlace de confirmación
router.post('/registro/confirmar', a(portal.confirmarRegistro)); // con ese enlace crea el cliente y su cuenta e inicia sesión
router.post('/salir', a(portal.salir));

// Requieren sesión de cliente
router.use(requiereSesionCliente);
router.get('/yo', portal.yo);
router.get('/panel', a(portal.panel));
router.get('/datos-compra', a(portal.datosCompra));      // rellena el formulario de /contratar (editable)

// Documentos: borrador con marca de agua → aceptar (y descargar el final) o enviar un ticket
router.get('/documentos/:id/borrador', a(entrega.borradorCliente));
router.post('/documentos/:id/aceptar', a(entrega.aceptar));
router.post('/documentos/:id/ticket', a(entrega.ticketDocumento));
router.get('/documentos/:id/archivo', a(entrega.archivoFinal));
router.get('/tickets', a(entrega.ticketsCliente));
router.post('/pagos/:id/pagar', a(entrega.pagarCuota));      // cuota pendiente (50/50): va a la pasarela y vuelve a Mi cuenta
router.post('/tickets', a(entrega.ticket));
router.post('/tickets/:id/mensajes', a(entrega.responderTicket));   // responder en la conversación

// Correspondencia recibida en su domicilio tributario (abrir el escaneo la marca como leída)
router.get('/correspondencia', a(correspondencia.delCliente));
router.get('/correspondencia/:id/archivo', a(correspondencia.archivoCliente));
router.post('/correspondencia/:id/leida', a(correspondencia.marcarLeida));

module.exports = router;
