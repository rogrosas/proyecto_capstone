/* =========================================================
   CAPA DE PRESENTACIÓN · Rutas /api/crm
   ========================================================= */
const express = require('express');
const router = express.Router();
const { archivos: archivosCfg } = require('../../config');
const arch = require('../controladores/archivos.controlador');
const { asincrono: a } = require('../middleware/errores');
const { requiereSesion } = require('../middleware/sesion');
const auth = require('../controladores/auth.controlador');
const crm = require('../controladores/crm.controlador');
const adm = require('../controladores/administracion.controlador');
const entrega = require('../controladores/entrega.controlador');
const firma = require('../controladores/firma.controlador');
const correspondencia = require('../controladores/correspondencia.controlador');

// Públicas
router.post('/login', a(auth.login));
router.post('/login/codigo', a(auth.loginCodigo));                 // segundo factor: código de 6 dígitos
router.post('/logout', a(auth.logout));
router.post('/clave', a(auth.solicitarClave));                     // olvidé mi contraseña: enlace al correo
router.post('/clave/definir', a(auth.definirClave));               // nueva contraseña con ese enlace

// Requieren sesión
router.use(requiereSesion);
router.get('/yo', auth.yo);
router.get('/yo/seguridad', a(auth.seguridad));
router.post('/yo/totp/iniciar', a(auth.iniciarTotp));
router.post('/yo/totp/activar', a(auth.activarTotp));
router.post('/yo/totp/desactivar', a(auth.desactivarTotp));
router.get('/dashboard', a(crm.dashboard));
router.get('/opciones', a(crm.opciones));

// Clientes (clientes, representantes_legales, direcciones)
router.get('/clientes', a(crm.listarClientes));
router.post('/clientes', a(crm.crearCliente));
router.get('/clientes/:id', a(crm.fichaCliente));
router.put('/clientes/:id', a(crm.actualizarCliente));
router.delete('/clientes/:id', a(crm.eliminarCliente));
router.put('/clientes/:id/accesos', a(crm.guardarAccesoPortal));   // personas que ingresan a /mi-cuenta (cuentas_portal)
router.post('/clientes/:id/gestiones', a(crm.registrarGestion));   // bitácora: llamadas, correos, reuniones, notas

// Contratos (contratos, contrato_servicios, alertas, vistas de impresión)
router.get('/contratos', a(crm.listarContratos));
router.post('/contratos', a(crm.crearContrato));
router.get('/contratos/:id', a(crm.detalleContrato));
router.patch('/contratos/:id', a(crm.actualizarContrato));
router.post('/contratos/:id/servicios', a(crm.agregarServicioContrato));
router.delete('/contratos/:id/servicios/:csId', a(crm.quitarServicioContrato));
router.post('/contratos/:id/renovar', a(crm.renovarContrato));
router.get('/contratos/:id/impresion', a(crm.impresionContrato));
router.post('/contratos/:id/notificar-alertas', a(crm.notificarAlertasContrato));
router.post('/alertas/:id/notificar', a(crm.notificarAlerta));
router.get('/renovaciones', a(crm.renovaciones));
router.get('/avisos', a(crm.avisos));                               // envíos de avisos de vencimiento (administradores)
router.post('/avisos/enviar', a(crm.enviarAvisos));

// Documentos (documentos, documento_partes, documento_clausulas)
router.get('/documentos', a(crm.listarDocumentos));
router.post('/documentos', a(crm.crearDocumento));
router.get('/documentos/:id', a(crm.detalleDocumento));
router.post('/documentos/:id/aprobar', a(crm.aprobarDocumento));
router.post('/documentos/:id/estado', a(crm.estadoDocumento));
router.post('/documentos/:id/firma', a(firma.enviar));             // envía a la plataforma de firma electrónica
router.get('/documentos/:id/firmado', a(firma.archivoFirmado));    // documento firmado que devolvió la plataforma

// Plantillas Word y contratos generados (la BD guarda la ubicación; el archivo está en la carpeta de contratos)
router.get('/plantillas-word', a(arch.plantillas));
router.get('/plantillas/:id/archivo', a(arch.archivoPlantilla));
router.post('/contratos/:id/generar', a(arch.generarContrato));
router.get('/documentos/:id/archivo', a(arch.archivoDocumento));
router.get('/plantillas/:id/preguntas', a(entrega.preguntasGeneracion));   // datos que completa el personal al generar

// Entrega al cliente: borrador con marca de agua, publicación y tickets
router.get('/documentos/:id/borrador', a(entrega.borradorPersonal));
router.post('/documentos/:id/publicar', a(entrega.publicar));
router.get('/tickets', a(entrega.listarTickets));
router.patch('/tickets/:id', a(entrega.atenderTicket));

// Documentos de la tienda (solo administradores): planes, entrega y datos de cada marca del Word
router.get('/admin/documentos-tienda', a(entrega.documentosTienda));
router.get('/admin/plantillas/:id/campos', a(entrega.camposPlantilla));
router.put('/admin/plantillas/:id/tienda', a(entrega.configurarTienda));
router.get('/admin/archivos', a(arch.listarArchivos));
router.post('/admin/archivos', express.raw({ type: () => true, limit: archivosCfg.maxBytes }), a(arch.subirArchivo));

// Correspondencia del domicilio tributario: registrar, escanear, avisar al cliente, retirada o devuelta
router.get('/correspondencia', a(correspondencia.listar));
router.post('/correspondencia', a(correspondencia.registrar));
router.post('/correspondencia/:id/escaneo', express.raw({ type: () => true, limit: '10mb' }), a(correspondencia.subirEscaneo));
router.post('/correspondencia/:id/notificar', a(correspondencia.notificar));
router.patch('/correspondencia/:id', a(correspondencia.cambiarEstado));
router.get('/correspondencia/:id/archivo', a(correspondencia.archivo));

// Pagos
router.get('/ventas', a(crm.ventas));
router.post('/pagos', a(crm.registrarPago));
router.patch('/pagos/:id', a(crm.estadoPago));

// Auditoría
router.get('/auditoria', a(crm.auditoria));

// Exportar listados a CSV: clientes, contratos, renovaciones, documentos, pagos, auditoria
router.get('/exportar/:lista', a(crm.exportar));

// Administración (usuarios, roles, permisos, roles_permisos y catálogos)
router.get('/admin/usuarios', a(adm.listarUsuarios));
router.post('/admin/usuarios', a(adm.crearUsuario));
router.patch('/admin/usuarios/:id', a(adm.actualizarUsuario));
router.get('/admin/roles', a(adm.listarRoles));
router.post('/admin/roles', a(adm.crearRol));
router.put('/admin/roles/:id', a(adm.actualizarRol));
router.delete('/admin/roles/:id', a(adm.eliminarRol));
router.get('/admin/catalogos', a(adm.definiciones));
router.get('/admin/catalogos/:nombre', a(adm.listarCatalogo));
router.post('/admin/catalogos/:nombre', a(adm.crearEnCatalogo));
router.put('/admin/catalogos/:nombre/:clave', a(adm.actualizarEnCatalogo));
router.delete('/admin/catalogos/:nombre/:clave', a(adm.eliminarDeCatalogo));

module.exports = router;
