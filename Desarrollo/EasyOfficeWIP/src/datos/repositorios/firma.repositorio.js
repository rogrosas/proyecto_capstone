/* =========================================================
   CAPA DE DATOS · Firma electrónica de documentos (documentos, documento_firmantes,
   movimientos_firmas y v_saldo_firmas).
   ========================================================= */
const { numeros } = require('../conversion');

// Documento con los datos de quien debe firmarlo (la persona natural, o el representante legal de la empresa)
async function paraFirmar(db, id) {
  const r = await db.query(`
    SELECT d.id, d.cliente_id, d.tipo, d.estado, d.requiere_revision, d.revisado_por, d.estado_cliente, d.url_archivo,
           d.codigo_verificacion, d.firma_id_externo, d.firma_proveedor, k.folio,
           cl.tipo_persona, cl.razon_social, cl.rut, cl.email,
           r.nombre_completo AS rep_nombre, r.rut AS rep_rut, r.email AS rep_email
      FROM documentos d
      JOIN clientes cl ON cl.id = d.cliente_id
      LEFT JOIN representantes_legales r ON r.id = cl.representante_legal_id
      LEFT JOIN contratos k ON k.id = d.contrato_id
     WHERE d.id = $1`, [id]);
  return r.rows[0] || null;
}

// Envía a firma: cambia el estado solo si sigue como se leyó, y deja la lista de firmantes
async function iniciar(db, id, estadoAnterior, { proveedor, idExterno, firmantes }) {
  const r = await db.query(`
    UPDATE documentos SET estado = 'enviado_firma', firma_id_externo = $3, firma_proveedor = $4, enviado_firma_en = now()
     WHERE id = $1 AND estado = $2 RETURNING id`, [id, estadoAnterior, idExterno, proveedor]);
  if (!r.rowCount) return false;
  await db.query('DELETE FROM documento_firmantes WHERE documento_id = $1', [id]);   // un reenvío reemplaza a los anteriores
  for (const f of firmantes) {
    await db.query(`INSERT INTO documento_firmantes (documento_id, orden, nombre, rut, email, id_externo)
                    VALUES ($1, $2, $3, $4, $5, $6)`, [id, f.orden, f.nombre, f.rut, f.email, f.idExterno]);
  }
  return true;
}

async function firmantes(db, documentoId) {
  const r = await db.query(`
    SELECT id, orden, nombre, rut, fn_rut_formato(rut) AS rut_fmt, email, estado, id_externo, firmado_en, host(ip) AS ip, motivo_rechazo,
           to_char(firmado_en AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD HH24:MI') AS firmado
      FROM documento_firmantes WHERE documento_id = $1 ORDER BY orden`, [documentoId]);
  return r.rows;
}

// Firmante por su id en la plataforma, con su documento (bloquea la fila: dos avisos a la vez no se pisan)
async function firmantePorExterno(db, idExterno) {
  const r = await db.query(`
    SELECT f.id, f.documento_id, f.orden, f.nombre, f.rut, fn_rut_formato(f.rut) AS rut_fmt, f.email, f.estado,
           d.estado AS estado_documento, d.tipo, d.cliente_id, d.url_archivo, d.firma_id_externo, k.folio
      FROM documento_firmantes f
      JOIN documentos d ON d.id = f.documento_id
      LEFT JOIN contratos k ON k.id = d.contrato_id
     WHERE f.id_externo = $1
       FOR UPDATE OF f`, [idExterno]);
  return r.rows[0] || null;
}

async function marcarFirmante(db, id, { estado, ip, motivo }) {
  await db.query(`
    UPDATE documento_firmantes
       SET estado = $2, ip = $3, motivo_rechazo = $4, firmado_en = CASE WHEN $2 = 'firmado' THEN now() ELSE NULL END
     WHERE id = $1 AND estado = 'pendiente'`, [id, estado, ip || null, motivo || null]);
}

async function completar(db, id, { codigo, archivo, hash }) {
  const r = await db.query(`
    UPDATE documentos
       SET estado = 'firmado', firmado_en = now(), codigo_verificacion = $2, archivo_firmado = $3, hash_firmado = $4
     WHERE id = $1 AND estado = 'enviado_firma' RETURNING id`, [id, codigo, archivo, hash]);
  return r.rowCount > 0;
}

async function rechazar(db, id) {
  await db.query("UPDATE documentos SET estado = 'rechazado' WHERE id = $1 AND estado = 'enviado_firma'", [id]);
}

async function archivoFirmado(db, id) {
  const r = await db.query('SELECT id, archivo_firmado FROM documentos WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function codigoLibre(db, codigo) {
  const r = await db.query('SELECT 1 FROM documentos WHERE codigo_verificacion = $1', [codigo]);
  return r.rowCount === 0;
}

// Verificación pública: solo lo necesario para comprobar el documento (sin RUT completo ni correos)
async function porCodigo(db, codigo, zona) {
  const r = await db.query(`
    SELECT d.id, d.tipo, d.estado, k.folio, to_char(d.firmado_en AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS firmado,
           d.hash_firmado, d.firma_proveedor, cl.razon_social AS cliente
      FROM documentos d JOIN clientes cl ON cl.id = d.cliente_id LEFT JOIN contratos k ON k.id = d.contrato_id
     WHERE d.codigo_verificacion = $1`, [codigo, zona]);
  return r.rows[0] || null;
}

/* ---------- Saldo de firmas del cliente (bolsas y planes con firmas incluidas) ---------- */
async function saldo(db, clienteId) {
  const r = await db.query(`
    SELECT compradas, consumidas, disponibles, proximo_vencimiento::text AS vence
      FROM v_saldo_firmas WHERE cliente_id = $1`, [clienteId]);
  return r.rows[0] ? numeros(r.rows[0], ['compradas', 'consumidas', 'disponibles']) : null;
}

async function movimientos(db, clienteId, limite = 20) {
  const r = await db.query(`
    SELECT m.motivo, m.cantidad, m.vence_en::text AS vence, m.detalle, m.creado_en::date::text AS fecha, k.folio
      FROM movimientos_firmas m LEFT JOIN contratos k ON k.id = m.contrato_id
     WHERE m.cliente_id = $1 ORDER BY m.creado_en DESC, m.id DESC LIMIT $2`, [clienteId, limite]);
  return r.rows;
}

module.exports = {
  paraFirmar, iniciar, firmantes, firmantePorExterno, marcarFirmante, completar, rechazar, archivoFirmado, codigoLibre, porCodigo,
  saldo, movimientos
};
