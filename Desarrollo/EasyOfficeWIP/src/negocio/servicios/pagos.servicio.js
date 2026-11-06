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
    const r = await conUsuario(usuario, async (db) => {
      const id = await pagosRepo.crear(db, p);
      if (p.estado !== 'pagado') return { id, contrato_activado: null };
      return { id, contrato_activado: await pagosRepo.activarContratoPagado(db, id), siguiente: await pagosRepo.crearSiguienteCuota(db, id) };
    });
    if (r.siguiente) await require('./tienda.servicio').avisarCuota(p.contrato_id, r.siguiente);
    return { id: r.id, contrato_activado: r.contrato_activado, cuota_siguiente: r.siguiente || null };
  } catch (err) {
    if (err.status === 409) throw errores.conflicto(`Ya existe una cuota ${p.cuota} vigente (pendiente o pagada) para ese contrato o documento.`);
    throw err;
  }
}

async function cambiarEstado(usuario, id, d = {}) {
  const estado = v.opcion(d.estado, ESTADOS, 'Estado');
  id = v.id(id, 'Pago');
  // Confirmar el pago de una compra pendiente activa su contrato (igual que cuando lo aprueba la pasarela)
  const r = await conUsuario(usuario, async (db) => {
    if (!(await pagosRepo.cambiarEstado(db, id, estado))) return null;
    if (estado !== 'pagado') return { activado: null };
    return { activado: await pagosRepo.activarContratoPagado(db, id), siguiente: await pagosRepo.crearSiguienteCuota(db, id), contrato: await pagosRepo.contratoDe(db, id) };
  });
  if (!r) throw errores.noEncontrado('Pago no encontrado o fuera de su cartera.');
  // Pago 50/50: queda pendiente la cuota siguiente y se le avisa al cliente
  if (r.siguiente) await require('./tienda.servicio').avisarCuota(r.contrato, r.siguiente);   // require diferido: evita la dependencia circular
  return { ok: true, contrato_activado: r.activado, cuota_siguiente: r.siguiente || null };
}

module.exports = { resumen, registrar, cambiarEstado };
