/* =========================================================
   CAPA DE PRESENTACIÓN · Controladores de los módulos del CRM.
   Solo toman los datos de la petición, llaman al servicio y
   responden JSON. Las reglas viven en la capa de negocio.
   ========================================================= */
const dashboardServicio = require('../../negocio/servicios/dashboard.servicio');
const opcionesServicio = require('../../negocio/servicios/opciones.servicio');
const clientesServicio = require('../../negocio/servicios/clientes.servicio');
const contratosServicio = require('../../negocio/servicios/contratos.servicio');
const renovacionesServicio = require('../../negocio/servicios/renovaciones.servicio');
const documentosServicio = require('../../negocio/servicios/documentos.servicio');
const pagosServicio = require('../../negocio/servicios/pagos.servicio');
const auditoriaServicio = require('../../negocio/servicios/auditoria.servicio');
const avisosServicio = require('../../negocio/servicios/avisos.servicio');
const exportarServicio = require('../../negocio/servicios/exportar.servicio');

const responder = (fn) => async (req, res) => res.json(await fn(req));
const creado = (fn) => async (req, res) => res.status(201).json(await fn(req));

module.exports = {
  dashboard: responder((req) => dashboardServicio.obtener(req.usuario, { desde: req.query.desde, hasta: req.query.hasta, ejecutivo: req.query.ejecutivo })),
  opciones: responder((req) => opcionesServicio.obtener(req.usuario)),

  // Clientes
  listarClientes: responder((req) => clientesServicio.listar(req.usuario, { q: req.query.q, estado: req.query.estado })),
  fichaCliente: responder((req) => clientesServicio.ficha(req.usuario, req.params.id)),
  crearCliente: creado((req) => clientesServicio.crear(req.usuario, req.body)),
  actualizarCliente: responder((req) => clientesServicio.actualizar(req.usuario, req.params.id, req.body)),
  eliminarCliente: responder((req) => clientesServicio.eliminar(req.usuario, req.params.id)),
  guardarAccesoPortal: responder((req) => clientesServicio.guardarAcceso(req.usuario, req.params.id, req.body)),
  registrarGestion: creado((req) => clientesServicio.registrarGestion(req.usuario, req.params.id, req.body)),

  // Contratos
  listarContratos: responder((req) => contratosServicio.listar(req.usuario, { q: req.query.q, estado: req.query.estado, mes: req.query.mes, ejecutivo: req.query.ejecutivo })),
  detalleContrato: responder((req) => contratosServicio.detalle(req.usuario, req.params.id)),
  crearContrato: creado((req) => contratosServicio.crear(req.usuario, req.body)),
  actualizarContrato: responder((req) => contratosServicio.actualizar(req.usuario, req.params.id, req.body)),
  agregarServicioContrato: creado((req) => contratosServicio.agregarServicio(req.usuario, req.params.id, req.body)),
  quitarServicioContrato: responder((req) => contratosServicio.quitarServicio(req.usuario, req.params.id, req.params.csId)),
  renovarContrato: creado((req) => contratosServicio.renovar(req.usuario, req.params.id)),
  impresionContrato: responder((req) => contratosServicio.impresion(req.usuario, req.params.id)),
  notificarAlertasContrato: responder((req) => contratosServicio.notificarVencidas(req.usuario, req.params.id)),
  notificarAlerta: responder((req) => contratosServicio.notificarAlerta(req.usuario, req.params.id)),

  // Renovaciones
  renovaciones: responder((req) => renovacionesServicio.listar(req.usuario, { filtro: req.query.filtro })),
  avisos: responder((req) => avisosServicio.historial(req.usuario)),
  enviarAvisos: responder((req) => avisosServicio.enviarAhora(req.usuario)),

  // Documentos
  listarDocumentos: responder((req) => documentosServicio.listar(req.usuario, { tipo: req.query.tipo })),
  detalleDocumento: responder((req) => documentosServicio.detalle(req.usuario, req.params.id)),
  crearDocumento: creado((req) => documentosServicio.crear(req.usuario, req.body)),
  aprobarDocumento: responder((req) => documentosServicio.aprobar(req.usuario, req.params.id)),
  estadoDocumento: responder((req) => documentosServicio.cambiarEstado(req.usuario, req.params.id, req.body)),

  // Pagos
  ventas: responder((req) => pagosServicio.resumen(req.usuario)),
  registrarPago: creado((req) => pagosServicio.registrar(req.usuario, req.body)),
  estadoPago: responder((req) => pagosServicio.cambiarEstado(req.usuario, req.params.id, req.body)),

  // Exportar un listado a CSV (Excel), con los mismos filtros de la pantalla
  exportar: async (req, res) => {
    const { nombre, contenido } = await exportarServicio.exportar(req.usuario, req.params.lista, req.query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nombre}"`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
    }).send(contenido);
  },

  // Auditoría
  auditoria: responder((req) => auditoriaServicio.listar(req.usuario, { q: req.query.q, accion: req.query.accion, dias: req.query.dias }))
};
