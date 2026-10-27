/* =========================================================
   CAPA DE NEGOCIO · Contratos de servicio.
   Reglas:
   - El folio, el vencimiento, los precios por defecto y las alertas
     los calcula la base de datos (triggers); aquí no se reprograman.
   - Debe indicarse cuenta de recaudación o link de pago.
   - Un ejecutivo solo crea contratos a su nombre; el administrador
     puede asignarlos a cualquier ejecutivo.
   - Solo el administrador quita servicios (rol_ejecutivo no tiene DELETE).
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');
const alertasRepo = require('../../datos/repositorios/alertas.repositorio');
const pagosRepo = require('../../datos/repositorios/pagos.repositorio');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const v = require('../validacion');

const ESTADOS = ['pendiente', 'activo', 'vencido', 'cancelado'];
const LIMITE = 500;

async function listar(usuario, { q, estado }) {
  const filtros = { texto: String(q || '').trim().slice(0, 80), estado: ESTADOS.includes(estado) ? estado : '' };
  return { contratos: await conUsuario(usuario, (db) => contratosRepo.listar(db, filtros, LIMITE)) };
}

async function detalle(usuario, id) {
  id = v.id(id, 'Contrato');
  return conUsuario(usuario, async (db) => {
    const contrato = await contratosRepo.obtener(db, id);
    if (!contrato) throw errores.noEncontrado('Contrato no encontrado o fuera de su cartera.');
    const documentos = (await documentosRepo.porCliente(db, contrato.cliente_id)).filter((d) => d.folio === contrato.folio);
    return {
      contrato,
      servicios: await contratosRepo.servicios(db, id),
      alertas: await alertasRepo.porContrato(db, id),
      pagos: await pagosRepo.porContrato(db, id),
      documentos
    };
  });
}

function validarServicio(s) {
  return {
    servicio_id: v.id(s.servicio_id, 'Servicio'),
    precio: v.monto(s.precio, 'Precio', { opcional: true }),            // vacío = precio del catálogo
    ciclo_pago: v.opcion(s.ciclo_pago, v.CICLOS, 'Ciclo de pago', { opcional: true }),
    descripcion: v.texto(s.descripcion, 'Descripción', { opcional: true, max: 4000 })
  };
}

async function crear(usuario, d = {}) {
  const contrato = {
    cliente_id: v.id(d.cliente_id, 'Cliente'),
    empresa_id: v.id(d.empresa_id, 'Empresa emisora'),
    sucursal_id: v.id(d.sucursal_id, 'Sucursal'),
    cuenta_recaudacion_id: v.id(d.cuenta_recaudacion_id, 'Cuenta', { opcional: true }),
    link_pago: v.texto(d.link_pago, 'Link de pago', { opcional: true, max: 500 }),
    lugar_celebracion: v.texto(d.lugar_celebracion, 'Lugar', { opcional: true, max: 100 }),
    fecha_celebracion: v.fecha(d.fecha_celebracion, 'Fecha de celebración', { opcional: true }),
    fecha_inicio: v.fecha(d.fecha_inicio, 'Fecha de inicio'),
    duracion_meses: v.entero(d.duracion_meses, 'Duración en meses', { min: 1, max: 120 }),
    renovacion_automatica: v.booleano(d.renovacion_automatica, true),
    estado: v.opcion(d.estado || 'activo', ['pendiente', 'activo'], 'Estado'),
    ejecutivo_id: usuario.admin ? v.id(d.ejecutivo_id, 'Ejecutivo', { opcional: true }) ?? usuario.id : usuario.id,
    observaciones: v.texto(d.observaciones, 'Observaciones', { opcional: true, max: 4000 })
  };
  if (!contrato.cuenta_recaudacion_id && !contrato.link_pago) {
    throw errores.solicitudInvalida('Indique una cuenta de recaudación o un link de pago.');
  }
  const servicios = (Array.isArray(d.servicios) ? d.servicios : []).map(validarServicio);
  if (!servicios.length) throw errores.solicitudInvalida('Agregue al menos un servicio al contrato.');

  return conUsuario(usuario, async (db) => {
    const k = await contratosRepo.crear(db, contrato);
    for (const s of servicios) await contratosRepo.agregarServicio(db, k.id, s);
    return { id: k.id, folio: k.folio };
  });
}

async function actualizar(usuario, id, d = {}) {
  id = v.id(id, 'Contrato');
  const cambios = {};
  if ('estado' in d) cambios.estado = v.opcion(d.estado, ESTADOS, 'Estado');
  if ('observaciones' in d) cambios.observaciones = v.texto(d.observaciones, 'Observaciones', { opcional: true, max: 4000 });
  if ('renovacion_automatica' in d) cambios.renovacion_automatica = v.booleano(d.renovacion_automatica);
  if ('link_pago' in d) cambios.link_pago = v.texto(d.link_pago, 'Link de pago', { opcional: true, max: 500 });
  if ('fecha_vencimiento' in d) cambios.fecha_vencimiento = v.fecha(d.fecha_vencimiento, 'Fecha de vencimiento');
  if ('ejecutivo_id' in d) {
    if (!usuario.admin) throw errores.sinPermiso('Solo un administrador puede reasignar el ejecutivo.');
    cambios.ejecutivo_id = v.id(d.ejecutivo_id, 'Ejecutivo');
  }
  const ok = await conUsuario(usuario, (db) => contratosRepo.actualizar(db, id, cambios));
  if (!ok) throw errores.noEncontrado('Contrato no encontrado o fuera de su cartera.');
  return { ok: true };
}

async function agregarServicio(usuario, id, d) {
  id = v.id(id, 'Contrato');
  const s = validarServicio(d || {});
  return { id: await conUsuario(usuario, (db) => contratosRepo.agregarServicio(db, id, s)) };
}

async function quitarServicio(usuario, id, csId) {
  if (!usuario.admin) throw errores.sinPermiso('Solo un administrador puede quitar servicios de un contrato.');
  const ok = await conUsuario(usuario, (db) => contratosRepo.quitarServicio(db, v.id(id), v.id(csId)));
  if (!ok) throw errores.noEncontrado();
  return { ok: true };
}

async function renovar(usuario, id) {
  id = v.id(id, 'Contrato');
  const k = await conUsuario(usuario, (db) => contratosRepo.renovar(db, id));
  if (!k) throw errores.noEncontrado('Contrato no encontrado o fuera de su cartera.');
  return k;
}

async function impresion(usuario, id) {
  id = v.id(id, 'Contrato');
  const r = await conUsuario(usuario, (db) => contratosRepo.impresion(db, id));
  if (!r) throw errores.noEncontrado('Contrato no encontrado o fuera de su cartera.');
  return r;
}

/* ---------- Alertas ---------- */
async function notificarAlerta(usuario, alertaId) {
  const ok = await conUsuario(usuario, (db) => alertasRepo.notificar(db, v.id(alertaId, 'Alerta')));
  if (!ok) throw errores.conflicto('La alerta ya estaba notificada o no pertenece a su cartera.');
  return { ok: true };
}

async function notificarVencidas(usuario, id) {
  const n = await conUsuario(usuario, (db) => alertasRepo.notificarVencidas(db, v.id(id, 'Contrato')));
  return { notificadas: n };
}

module.exports = {
  listar, detalle, crear, actualizar, agregarServicio, quitarServicio, renovar, impresion,
  notificarAlerta, notificarVencidas
};
