/* =========================================================
   CAPA DE NEGOCIO · Ventas y pagos.
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const pagosRepo = require('../../datos/repositorios/pagos.repositorio');

const DIAS_RESUMEN = 30;
const LIMITE = 100;

async function resumen(usuario) {
  return conUsuario(usuario, async (db) => ({
    resumen: await pagosRepo.resumenPorPasarela(db, DIAS_RESUMEN),
    pagos: await pagosRepo.listarRecientes(db, LIMITE)
  }));
}

/* ---------- Registro y cambio de estado ---------- */

const { errores } = require('../../comun/errores');
const v = require('../validacion');

const ESTADOS = ['pendiente', 'pagado', 'rechazado', 'reembolsado'];
const PASARELAS = ['transbank', 'mercado_pago', 'transferencia'];

async function registrar(usuario, d = {}) {
  const p = {
    contrato_id: v.id(d.contrato_id, 'Contrato', { opcional: true }),
    documento_id: v.id(d.documento_id, 'Documento', { opcional: true }),
    monto: v.monto(d.monto, 'Monto', { min: 1 }),
    estado: v.opcion(d.estado || 'pendiente', ESTADOS, 'Estado'),
    pasarela: v.opcion(d.pasarela, PASARELAS, 'Pasarela', { opcional: true }),
    fecha_pago: v.fecha(d.fecha_pago, 'Fecha de pago', { opcional: true }),
    cuota: v.entero(d.cuota ?? 1, 'Cuota', { min: 1 }),
    total_cuotas: v.entero(d.total_cuotas ?? 1, 'Total de cuotas', { min: 1 })
  };
  if (!p.contrato_id && !p.documento_id) throw errores.solicitudInvalida('El pago debe asociarse a un contrato o a un documento.');
  if (p.cuota > p.total_cuotas) throw errores.solicitudInvalida('La cuota no puede ser mayor que el total de cuotas.');
  if (p.estado === 'pagado' && !p.fecha_pago) p.fecha_pago = new Date().toISOString().slice(0, 10);
  try {
    return { id: await conUsuario(usuario, (db) => pagosRepo.crear(db, p)) };
  } catch (err) {
    if (err.status === 409) throw errores.conflicto(`Ya existe una cuota ${p.cuota} vigente (pendiente o pagada) para ese contrato o documento.`);
    throw err;
  }
}

async function cambiarEstado(usuario, id, d = {}) {
  const estado = v.opcion(d.estado, ESTADOS, 'Estado');
  const ok = await conUsuario(usuario, (db) => pagosRepo.cambiarEstado(db, v.id(id, 'Pago'), estado));
  if (!ok) throw errores.noEncontrado('Pago no encontrado o fuera de su cartera.');
  return { ok: true };
}

module.exports = { resumen, registrar, cambiarEstado };
