/* =========================================================
   CAPA DE PRESENTACIÓN · Controladores de Administración.
   ========================================================= */
const administracion = require('../../negocio/servicios/administracion.servicio');
const catalogos = require('../../negocio/servicios/catalogos.servicio');

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
  eliminarDeCatalogo: responder((req) => catalogos.eliminar(req.usuario, req.params.nombre, req.params.clave))
};
