/* =========================================================
   CAPA DE DATOS · Repositorio de documentos
   (documentos + clientes, contratos, plantillas_documento y usuarios).
   ========================================================= */
const { num } = require('../conversion');

async function contarPorEstado(db) {
  const r = await db.query('SELECT estado, count(*) AS n FROM documentos GROUP BY estado');
  return Object.fromEntries(r.rows.map((e) => [e.estado, num(e.n)]));
}

/**
 * revision: null = todos, true = solo los que requieren revisión, false = solo automáticos
 */
async function listar(db, { revision }, limite) {
  const r = await db.query(`
    SELECT d.id, d.tipo, d.estado, d.requiere_revision, d.codigo_verificacion, d.estado_cliente,
           d.generado_en::date::text AS generado, d.firmado_en::date::text AS firmado,
           cl.razon_social AS cliente, k.folio, p.tipo_documento AS plantilla,
           ue.nombre AS ejecutivo, ur.nombre AS revisor
      FROM documentos d
      JOIN clientes cl ON cl.id = d.cliente_id
      LEFT JOIN contratos k ON k.id = d.contrato_id
      LEFT JOIN plantillas_documento p ON p.id = d.plantilla_id
      LEFT JOIN usuarios ue ON ue.id = d.ejecutivo_id
      LEFT JOIN usuarios ur ON ur.id = d.revisado_por
     WHERE ($1::boolean IS NULL OR d.requiere_revision = $1)
     ORDER BY (d.estado = 'en_revision') DESC, d.generado_en DESC
     LIMIT $2`, [revision, limite]);
  return r.rows;
}

// Aprobación humana: revisado_por = usuario de la sesión (app_usuario()); la auditoría la registra el trigger
async function aprobar(db, id) {
  const r = await db.query(`
    UPDATE documentos SET estado = 'aprobado', revisado_por = app_usuario(), revisado_en = now()
     WHERE id = $1 AND estado = 'en_revision' RETURNING id`, [id]);
  return r.rowCount > 0;
}

/* ---------- Gestión de documentos ---------- */

async function obtener(db, id) {
  const r = await db.query(`
    SELECT d.id, d.cliente_id, cl.razon_social AS cliente, d.contrato_id, k.folio, d.servicio_id, sv.nombre AS servicio,
           d.plantilla_id, p.tipo_documento AS plantilla, p.contenido_plantilla, p.campos AS campos_plantilla,
           d.tipo, d.lugar, d.fecha_documento::text AS fecha_documento, d.datos, d.estado, d.requiere_revision,
           d.revisado_por, ur.nombre AS revisor, to_char(d.revisado_en, 'YYYY-MM-DD HH24:MI') AS revisado_en,
           d.ejecutivo_id, ue.nombre AS ejecutivo, d.url_archivo, d.firma_id_externo,
           to_char(d.firmado_en, 'YYYY-MM-DD HH24:MI') AS firmado_en, d.codigo_verificacion,
           d.generado_en::date::text AS generado,
           d.estado_cliente, to_char(d.publicado_en, 'YYYY-MM-DD HH24:MI') AS publicado_en,
           to_char(d.aceptado_en, 'YYYY-MM-DD HH24:MI') AS aceptado_en, d.aceptado_por, d.version_aceptada,
           p.entrega
      FROM documentos d
      JOIN clientes cl ON cl.id = d.cliente_id
      LEFT JOIN contratos k ON k.id = d.contrato_id
      LEFT JOIN servicios sv ON sv.id = d.servicio_id
      LEFT JOIN plantillas_documento p ON p.id = d.plantilla_id
      LEFT JOIN usuarios ur ON ur.id = d.revisado_por
      LEFT JOIN usuarios ue ON ue.id = d.ejecutivo_id
     WHERE d.id = $1`, [id]);
  return r.rows[0] || null;
}

async function partes(db, documentoId) {
  const r = await db.query(`
    SELECT id, orden, rol, tipo_persona, nombre, rut, fn_rut_formato(rut) AS rut_fmt, nacionalidad, estado_civil,
           profesion, email, telefono, representante_nombre, fn_rut_formato(representante_rut) AS representante_rut,
           cantidad_acciones
      FROM documento_partes WHERE documento_id = $1 ORDER BY orden`, [documentoId]);
  return r.rows.map((x) => ({ ...x, cantidad_acciones: x.cantidad_acciones === null ? null : Number(x.cantidad_acciones) }));
}

async function clausulas(db, documentoId) {
  const r = await db.query(`
    SELECT dc.id, dc.orden, dc.clausula_id, c.codigo, c.titulo, c.texto_plantilla, dc.valores
      FROM documento_clausulas dc JOIN clausulas_documento c ON c.id = dc.clausula_id
     WHERE dc.documento_id = $1 ORDER BY dc.orden`, [documentoId]);
  return r.rows;
}

async function porCliente(db, clienteId) {
  const r = await db.query(`
    SELECT d.id, d.tipo, d.estado, d.requiere_revision, k.folio, d.generado_en::date::text AS generado,
           d.firmado_en::date::text AS firmado, d.codigo_verificacion, d.url_archivo,
           d.estado_cliente, d.publicado_en::date::text AS publicado, d.aceptado_en::date::text AS aceptado
      FROM documentos d LEFT JOIN contratos k ON k.id = d.contrato_id
     WHERE d.cliente_id = $1 ORDER BY d.generado_en DESC`, [clienteId]);
  return r.rows;
}

async function tipoDePlantilla(db, plantillaId) {
  const r = await db.query('SELECT tipo_documento FROM plantillas_documento WHERE id = $1', [plantillaId]);
  return r.rows[0]?.tipo_documento || null;
}

/** requiere_revision en null -> lo copia el trigger desde la plantilla */
async function crear(db, d) {
  const r = await db.query(`
    INSERT INTO documentos (cliente_id, contrato_id, servicio_id, plantilla_id, tipo, lugar, fecha_documento, datos,
                            estado, requiere_revision, ejecutivo_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'borrador', NULL, $9) RETURNING id`,
    [d.cliente_id, d.contrato_id, d.servicio_id, d.plantilla_id, d.tipo, d.lugar, d.fecha_documento, d.datos, d.ejecutivo_id]);
  return r.rows[0].id;
}

async function agregarParte(db, documentoId, orden, p) {
  await db.query(`
    INSERT INTO documento_partes (documento_id, orden, rol, tipo_persona, nombre, rut, nacionalidad, estado_civil,
                                  profesion, email, telefono, representante_nombre, representante_rut, cantidad_acciones)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [documentoId, orden, p.rol, p.tipo_persona, p.nombre, p.rut, p.nacionalidad, p.estado_civil, p.profesion,
      p.email, p.telefono, p.representante_nombre, p.representante_rut, p.cantidad_acciones]);
}

async function agregarClausula(db, documentoId, orden, c) {
  await db.query('INSERT INTO documento_clausulas (documento_id, orden, clausula_id, valores) VALUES ($1, $2, $3, $4)',
    [documentoId, orden, c.clausula_id, c.valores]);
}

async function estadoActual(db, id) {
  const r = await db.query('SELECT estado, requiere_revision, revisado_por, codigo_verificacion FROM documentos WHERE id = $1', [id]);
  return r.rows[0] || null;
}

/** cambios: estado y, según la transición, firmado_en / codigo_verificacion / firma_id_externo / url_archivo */
async function cambiarEstado(db, id, estadoAnterior, cambios) {
  const cols = ['estado', 'codigo_verificacion', 'firma_id_externo', 'url_archivo'].filter((c) => c in cambios);
  const sets = cols.map((c, i) => `${c} = $${i + 3}`);
  if (cambios.firmado_en) sets.push('firmado_en = now()');
  const r = await db.query(`UPDATE documentos SET ${sets.join(', ')} WHERE id = $1 AND estado = $2 RETURNING id`,
    [id, estadoAnterior, ...cols.map((c) => cambios[c])]);
  return r.rowCount > 0;
}

module.exports = {
  contarPorEstado, listar, aprobar,
  obtener, partes, clausulas, porCliente, tipoDePlantilla, crear, agregarParte, agregarClausula, estadoActual, cambiarEstado,
  generadoVigente, guardarArchivo, archivoDe, registrarVersion, ultimaVersion,
  entregaDe, fijarEntrega, aceptar, objetar
};

/* ---------- Archivos Word generados ---------- */

// Último documento no anulado de ese contrato y esa plantilla (se le agrega una versión nueva)
async function generadoVigente(db, contratoId, plantillaId) {
  const r = await db.query(`
    SELECT id, estado, estado_cliente, url_archivo FROM documentos
     WHERE contrato_id = $1 AND plantilla_id = $2 AND estado <> 'anulado'
     ORDER BY generado_en DESC, id DESC LIMIT 1 FOR UPDATE`, [contratoId, plantillaId]);
  return r.rows[0] || null;
}

// Nueva ubicación del archivo; un documento rechazado vuelve a borrador
async function guardarArchivo(db, id, urlArchivo) {
  await db.query(`
    UPDATE documentos SET url_archivo = $2, generado_en = now(),
           estado = CASE WHEN estado = 'rechazado' THEN 'borrador' ELSE estado END
     WHERE id = $1`, [id, urlArchivo]);
}

async function archivoDe(db, id) {
  const r = await db.query(`
    SELECT d.id, d.tipo, d.url_archivo, k.folio FROM documentos d LEFT JOIN contratos k ON k.id = d.contrato_id WHERE d.id = $1`, [id]);
  return r.rows[0] || null;
}

// documento_versiones existe desde easyoffice_v2.sql; con el esquema original la versión sale del nombre del archivo
let hayVersiones = null;
async function tablaVersiones(db) {
  if (hayVersiones === null) {
    hayVersiones = (await db.query("SELECT to_regclass('public.documento_versiones') IS NOT NULL AS hay")).rows[0].hay;
  }
  return hayVersiones;
}

async function ultimaVersion(db, id, urlActual) {
  if (await tablaVersiones(db)) {
    const r = await db.query('SELECT COALESCE(max(version), 0) AS v FROM documento_versiones WHERE documento_id = $1', [id]);
    return Number(r.rows[0].v);
  }
  return Number((/_v(\d+)\.docx$/i.exec(urlActual || '') || [0, 0])[1]);
}

async function registrarVersion(db, id, version, urlArchivo, hash) {
  if (!(await tablaVersiones(db))) return false;
  await db.query('INSERT INTO documento_versiones (documento_id, version, url_archivo, hash_sha256) VALUES ($1, $2, $3, $4)',
    [id, version, urlArchivo, hash]);
  return true;
}

/* ---------- Entrega al cliente (borrador con marca de agua → aceptación) ---------- */

// Datos para decidir qué ve el cliente; con clienteId, solo si el documento es suyo
async function entregaDe(db, id, clienteId = null) {
  const r = await db.query(`
    SELECT d.id, d.cliente_id, d.contrato_id, d.tipo, d.estado, d.estado_cliente, d.url_archivo,
           d.publicado_en, d.aceptado_en, d.aceptado_por, k.folio, cl.razon_social AS cliente, cl.email AS cliente_email
      FROM documentos d
      JOIN clientes cl ON cl.id = d.cliente_id
      LEFT JOIN contratos k ON k.id = d.contrato_id
     WHERE d.id = $1 AND ($2::int IS NULL OR d.cliente_id = $2)`, [id, clienteId]);
  return r.rows[0] || null;
}

// 'por_revisar' publica el borrador al cliente; null lo retira (por ejemplo, al regenerarlo para revisión interna)
async function fijarEntrega(db, id, estadoCliente) {
  await db.query(`
    UPDATE documentos
       SET estado_cliente = $2,
           publicado_en = CASE WHEN $2::text = 'por_revisar' THEN now() ELSE NULL END
     WHERE id = $1`, [id, estadoCliente]);
}

// Solo un borrador publicado y del cliente de la sesión
async function aceptar(db, id, clienteId, { email, ip, version }) {
  const r = await db.query(`
    UPDATE documentos
       SET estado_cliente = 'aceptado', aceptado_en = now(), aceptado_por = $3, aceptado_ip = $4, version_aceptada = $5
     WHERE id = $1 AND cliente_id = $2 AND estado_cliente = 'por_revisar' RETURNING id`, [id, clienteId, email, ip, version]);
  return r.rowCount > 0;
}

async function objetar(db, id, clienteId) {
  const r = await db.query(`
    UPDATE documentos SET estado_cliente = 'objetado'
     WHERE id = $1 AND cliente_id = $2 AND estado_cliente = 'por_revisar' RETURNING id`, [id, clienteId]);
  return r.rowCount > 0;
}
