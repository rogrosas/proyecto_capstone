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

// Documento que espera la revisión del personal: en revisión interna, o un Word generado que aún
// no se publica al cliente (compra en la tienda con entrega "con revisión", o generado desde el CRM)
const POR_REVISAR = (d = 'd') =>
  `(${d}.estado = 'en_revision' OR (${d}.estado = 'borrador' AND ${d}.url_archivo IS NOT NULL AND ${d}.estado_cliente IS NULL))`;

// Texto de búsqueda para "col ILIKE '%' || $n || '%'": escapa los comodines de LIKE (\ % _) para que
// el texto se busque tal cual. Sin esto, buscar "%" o "_" coincide con todo (no es inyección, pero
// permite listar todo o armar patrones costosos). PostgreSQL usa \ como escape de LIKE por defecto.
const textoLike = (s) => String(s ?? '').replace(/[\\%_]/g, '\\$&');

module.exports = { MENSUALIZADO, SIN_RENOVAR, TOTAL_CONTRATO, SERVICIOS_CONTRATO, POR_REVISAR, textoLike };
