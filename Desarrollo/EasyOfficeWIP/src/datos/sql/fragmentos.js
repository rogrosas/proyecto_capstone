/* =========================================================
   CAPA DE DATOS · Fragmentos SQL reutilizados por varios repositorios.
   Esperan el alias k para contratos y cs para contrato_servicios.
   ========================================================= */

// Monto mensual equivalente de un servicio según su ciclo de pago (UNICO no es recurrente)
const MENSUALIZADO = `
  CASE cs.ciclo_pago
    WHEN 'MENSUAL'    THEN cs.precio
    WHEN 'TRIMESTRAL' THEN cs.precio / 3
    WHEN 'SEMESTRAL'  THEN cs.precio / 6
    WHEN 'ANUAL'      THEN cs.precio / 12
    ELSE 0 END`;

// Contrato "vencido sin renovar": el cliente no tiene otro contrato vigente posterior
const SIN_RENOVAR = `
  NOT EXISTS (SELECT 1 FROM contratos k2
               WHERE k2.cliente_id = k.cliente_id AND k2.id <> k.id
                 AND k2.estado IN ('activo','pendiente')
                 AND k2.fecha_vencimiento > k.fecha_vencimiento)`;

// Total neto de servicios de un contrato
const TOTAL_CONTRATO = '(SELECT sum(cs.precio) FROM contrato_servicios cs WHERE cs.contrato_id = k.id)';

// Servicios de un contrato en una línea
const SERVICIOS_CONTRATO = `
  (SELECT string_agg(sv.nombre, ' · ' ORDER BY cs.orden)
     FROM contrato_servicios cs JOIN servicios sv ON sv.id = cs.servicio_id
    WHERE cs.contrato_id = k.id)`;

module.exports = { MENSUALIZADO, SIN_RENOVAR, TOTAL_CONTRATO, SERVICIOS_CONTRATO };
