/* =========================================================
   CAPA DE PRESENTACIÓN · Rutas públicas de /api: firma electrónica y verificación
   ========================================================= */
const router = require('express').Router();
const { asincrono: a } = require('../middleware/errores');
const { limitePorIp } = require('../middleware/limite');
const firma = require('../controladores/firma.controlador');

const limite = limitePorIp(60, 10 * 60 * 1000);

// Simulador de la plataforma de firma (laboratorio): el enlace del correo abre /firma-simulada?t=...
router.get('/firma/simulador/:token', limite, a(firma.verSimulada));
router.get('/firma/simulador/:token/documento', limite, a(firma.documentoSimulada));
router.post('/firma/simulador/:token', limite, a(firma.firmarSimulada));

// Aviso de la plataforma de firma real (con el secreto compartido FIRMA_SECRETO)
router.post('/firma/aviso', limite, a(firma.aviso));

// Verificación de un documento firmado por su código EO-XXXX-XXXX
router.get('/verificar/:codigo', limitePorIp(30, 60 * 1000), a(firma.verificar));

module.exports = router;
