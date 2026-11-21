/* =========================================================
   CAPA DE PRESENTACIÓN · Controladores de Administración.
   ========================================================= */
const administracion = require('../../negocio/servicios/administracion.servicio');
const catalogos = require('../../negocio/servicios/catalogos.servicio');
const tienda = require('../../negocio/servicios/tiendaAdmin.servicio');

const responder = (fn) => async (req, res) => res.json(await fn(req));
const creado = (fn) => async (req, res) => res.status(201).json(await fn(req));

module.exports = {
  listarUsuarios: responder((req) => administracion.listarUsuarios(req.usuario)),
  crearUsuario: creado((req) => administracion.crearUsuario(req.usuario, req.body)),
  actualizarUsuario: responder((req) => administracion.actualizarUsuario(req.usuario, req.params.id, req.body)),

  listarRoles: responder((req) => administracion.listarRoles(req.usuario)),
  crearRol: creado((req) => administracion.guardarRol(req.usuario, null, req.body)),
  actualizarRol: responder((req) => administracion.guardarRol(req.usuario, req.params.id, req.body)),
  eliminarRol: responder((req) => administracion.eliminarRol(req.usuario, req.params.id)),

  definiciones: responder((req) => catalogos.definiciones(req.usuario)),
  listarCatalogo: responder((req) => catalogos.listar(req.usuario, req.params.nombre)),
  crearEnCatalogo: creado((req) => catalogos.guardar(req.usuario, req.params.nombre, null, req.body)),
  actualizarEnCatalogo: responder((req) => catalogos.guardar(req.usuario, req.params.nombre, req.params.clave, req.body)),
  eliminarDeCatalogo: responder((req) => catalogos.eliminar(req.usuario, req.params.nombre, req.params.clave)),

  // Tienda del sitio: servicios y planes
  tienda: responder((req) => tienda.listar(req.usuario)),
  crearServicioTienda: creado((req) => tienda.crearFamilia(req.usuario, req.body)),
  editarServicioTienda: responder((req) => tienda.editarFamilia(req.usuario, req.params.codigo, req.body)),
  borrarServicioTienda: responder((req) => tienda.borrarFamilia(req.usuario, req.params.codigo)),
  crearPlanTienda: creado((req) => tienda.crearPlan(req.usuario, req.body)),
  editarPlanTienda: responder((req) => tienda.editarPlan(req.usuario, req.params.codigo, req.body)),
  borrarPlanTienda: responder((req) => tienda.borrarPlan(req.usuario, req.params.codigo)),
  ordenarTienda: responder((req) => tienda.ordenar(req.usuario, req.params.tipo, req.body))
};
