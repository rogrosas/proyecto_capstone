/* =========================================================
   CAPA DE NEGOCIO · Entrega del documento al cliente.

   1. El documento se publica al cliente (automático al generarlo, o el
      personal lo publica tras revisarlo): estado_cliente = 'por_revisar'.
   2. En /mi-cuenta el cliente SIEMPRE ve primero un borrador con marca de
      agua (HTML generado desde el Word; el .docx no se entrega todavía).
   3. Marca la casilla "estoy de acuerdo" y lo acepta → recibe el Word final.
      Si no está de acuerdo, envía un ticket → estado_cliente = 'objetado'.
   4. El personal atiende el ticket, corrige, regenera y vuelve a publicar.
   ========================================================= */
const mammoth = require('mammoth');
const { conUsuario, conSistema } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const archivos = require('../../datos/archivos');
const correo = require('../../datos/correo');
const config = require('../../config');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const ticketsRepo = require('../../datos/repositorios/tickets.repositorio');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const v = require('../validacion');

const MOTIVOS = { datos_incorrectos: 'Mis datos están incorrectos', condiciones: 'No estoy de acuerdo con las condiciones',
  falta_informacion: 'Falta información en el documento', otro: 'Otro motivo' };
const ESTADOS_TICKET = ['abierto', 'en_proceso', 'resuelto', 'cerrado'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Borrador con marca de agua ---------- */
const MARCA_AGUA = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='380' height='260'>
  <text x='190' y='130' text-anchor='middle' transform='rotate(-30 190 130)' font-family='Arial, sans-serif'
        font-size='38' font-weight='700' fill='rgba(200,40,40,0.14)'>BORRADOR</text>
  <text x='190' y='165' text-anchor='middle' transform='rotate(-30 190 130)' font-family='Arial, sans-serif'
        font-size='15' font-weight='700' fill='rgba(200,40,40,0.14)'>SIN VALIDEZ · EASY OFFICE</text></svg>`);

async function borradorHtml(doc) {
  if (!doc.url_archivo || /^https?:\/\//i.test(doc.url_archivo)) throw errores.noEncontrado('Este documento aún no tiene archivo Word.');
  const { value } = await mammoth.convertToHtml({ buffer: await archivos.leer(doc.url_archivo) });
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Borrador · ${esc(doc.tipo)}${doc.folio ? ' · ' + esc(doc.folio) : ''}</title>
<style>
  html,body{margin:0;background:#E9ECEE;color:#222;}
  .aviso{position:sticky;top:0;z-index:5;background:#FFF4E0;border-bottom:1px solid #F0D39C;color:#7A4B00;
         font:600 13px/1.4 Arial,sans-serif;padding:10px 16px;text-align:center;}
  .hoja{position:relative;max-width:780px;margin:22px auto;background:#fff;padding:56px 64px;box-shadow:0 4px 16px rgba(0,0,0,.12);
        font:14.5px/1.6 Georgia,'Times New Roman',serif;overflow-wrap:anywhere;-webkit-user-select:none;user-select:none;}
  .hoja::after{content:'';position:absolute;inset:0;z-index:3;pointer-events:none;
        background-image:url("data:image/svg+xml,${MARCA_AGUA}");background-repeat:repeat;
        -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .hoja table{border-collapse:collapse;width:100%;margin:10px 0;} .hoja td,.hoja th{border:1px solid #ccc;padding:5px 7px;vertical-align:top;}
  .hoja img{max-width:100%;height:auto;} .hoja p{margin:0 0 10px;}
  @media (max-width:640px){.hoja{margin:0;padding:28px 18px;box-shadow:none;}}
</style></head><body>
<div class="aviso">BORRADOR PARA REVISIÓN · Sin validez legal hasta que usted lo acepte y se firme.</div>
<div class="hoja">${value}</div>
</body></html>`;
}

/* ---------- Avisos por correo ---------- */
async function avisar(clienteId, asunto, cuerpoHtml, texto) {
  let destinos = [];
  try { destinos = await portalRepo.contactos(clienteId); } catch (err) { console.warn('[entrega] contactos:', err.message); }
  for (const para of destinos) {
    try {
      await correo.enviar({ para, asunto, texto, html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#333;">${cuerpoHtml}
        <p style="margin-top:22px;"><a href="${esc(config.appUrl)}/mi-cuenta" style="background:#24D356;color:#fff;text-decoration:none;padding:10px 18px;border-radius:3px;font-weight:600;display:inline-block;">Ir a Mi cuenta</a></p></div>` });
    } catch (err) { console.warn('[entrega] no se pudo enviar el aviso a', para, err.message); }
  }
}

async function avisarPublicado(doc) {
  await avisar(doc.cliente_id, 'Tiene un documento para revisar en Easy Office',
    `<h2 style="font-family:Georgia,serif;color:#282828;">Su documento está listo para revisión</h2>
     <p><b>${esc(doc.tipo)}</b>${doc.folio ? ` · contrato ${esc(doc.folio)}` : ''}.</p>
     <p>Ingrese a su cuenta, revise el borrador y acéptelo para recibir el documento final. Si algo no está correcto, puede enviarnos un ticket desde el mismo lugar.</p>`,
    `Su documento ${doc.tipo}${doc.folio ? ' (contrato ' + doc.folio + ')' : ''} está listo para revisión en ${config.appUrl}/mi-cuenta`);
}

/* ---------- Personal (CRM) ---------- */

async function borradorPersonal(usuario, id) {
  id = v.id(id, 'Documento');
  const doc = await conUsuario(usuario, (db) => documentosRepo.entregaDe(db, id));
  if (!doc) throw errores.noEncontrado('Documento no encontrado o fuera de su cartera.');
  return borradorHtml(doc);
}

async function publicar(usuario, id) {
  id = v.id(id, 'Documento');
  const doc = await conUsuario(usuario, async (db) => {
    const d = await documentosRepo.entregaDe(db, id);
    if (!d) throw errores.noEncontrado('Documento no encontrado o fuera de su cartera.');
    if (!d.url_archivo) throw errores.conflicto('Genere primero el documento Word.');
    if (d.estado === 'anulado') throw errores.conflicto('El documento está anulado.');
    if (d.estado_cliente === 'aceptado') throw errores.conflicto('El cliente ya aceptó este documento.');
    if (d.estado_cliente === 'por_revisar') throw errores.conflicto('El documento ya está publicado al cliente.');
    await documentosRepo.fijarEntrega(db, id, 'por_revisar');
    return d;
  });
  await avisarPublicado(doc);
  return { ok: true };
}

async function listarTickets(usuario, { estado, documento }) {
  const e = estado === 'pendientes' ? 'pendientes' : v.opcion(estado, ESTADOS_TICKET, 'Estado', { opcional: true }) || '';
  const documentoId = v.id(documento, 'Documento', { opcional: true });
  return conUsuario(usuario, async (db) => ({
    tickets: await ticketsRepo.listar(db, { estado: e, documentoId }, 300),
    pendientes: await ticketsRepo.pendientes(db),
    motivos: MOTIVOS
  }));
}

async function atenderTicket(usuario, id, d = {}) {
  id = v.id(id, 'Ticket');
  const estado = v.opcion(d.estado, ESTADOS_TICKET, 'Estado');
  const respuesta = v.texto(d.respuesta, 'Respuesta', { opcional: true, max: 4000 });
  if (['resuelto', 'cerrado'].includes(estado) && !respuesta) {
    const actual = await conUsuario(usuario, (db) => ticketsRepo.obtener(db, id));
    if (!actual?.respuesta) throw errores.solicitudInvalida('Escriba una respuesta para el cliente antes de resolver o cerrar el ticket.');
  }
  const t = await conUsuario(usuario, async (db) => {
    if (!(await ticketsRepo.atender(db, id, { estado, respuesta }))) throw errores.noEncontrado('Ticket no encontrado o fuera de su cartera.');
    return ticketsRepo.obtener(db, id);
  });
  if (respuesta) {
    await avisar(t.cliente_id, `Respuesta a su ticket #${t.id} · Easy Office`,
      `<h2 style="font-family:Georgia,serif;color:#282828;">Respondimos su ticket #${t.id}</h2>
       ${t.documento ? `<p>Sobre: <b>${esc(t.documento)}</b>${t.folio ? ` · contrato ${esc(t.folio)}` : ''}</p>` : ''}
       <p style="white-space:pre-wrap;border-left:3px solid #24D356;padding-left:12px;">${esc(respuesta)}</p>`,
      `Respuesta a su ticket #${t.id}: ${respuesta}`);
  }
  return { ok: true };
}

/* ---------- Cliente (portal) ---------- */
// El cliente solo ve documentos publicados (por revisar, aceptados u objetados) y que sean suyos
async function documentoDelCliente(db, sesion, id) {
  const doc = await documentosRepo.entregaDe(db, v.id(id, 'Documento'), sesion.id);
  if (!doc || !doc.estado_cliente) throw errores.noEncontrado('Documento no encontrado.');
  return doc;
}

async function borradorCliente(sesion, id) {
  return borradorHtml(await conSistema((db) => documentoDelCliente(db, sesion, id)));
}

async function aceptar(sesion, id, d = {}, ip) {
  if (d.acepto !== true) throw errores.solicitudInvalida('Marque la casilla "He leído el borrador y estoy de acuerdo" para aceptar el documento.');
  const doc = await conSistema(async (db) => {
    const x = await documentoDelCliente(db, sesion, id);
    if (x.estado_cliente !== 'por_revisar') {
      throw errores.conflicto(x.estado_cliente === 'aceptado' ? 'Usted ya aceptó este documento.' : 'Este documento tiene un ticket abierto: espere nuestra respuesta.');
    }
    const version = await documentosRepo.ultimaVersion(db, x.id, x.url_archivo);
    if (!(await documentosRepo.aceptar(db, x.id, sesion.id, { email: sesion.email, ip: ip || null, version }))) {
      throw errores.conflicto('El documento cambió mientras lo revisaba. Recargue la página.');
    }
    await db.query(`INSERT INTO registros_actividad (usuario_id, cliente_id, tabla_afectada, registro_id, accion, detalle, ip)
                    VALUES (NULL, $1, 'documentos', $2, 'UPDATE', $3, $4)`,
      [sesion.id, String(x.id), `Aceptado por el cliente (${sesion.email}), versión ${version}`, ip || null]);
    return x;
  });
  return { ok: true, documento_id: doc.id };
}

async function enviarTicket(sesion, id, d = {}) {
  const motivo = v.opcion(d.motivo, Object.keys(MOTIVOS), 'Motivo');
  const detalle = v.texto(d.detalle, 'Detalle', { max: 4000 });
  const ticketId = await conSistema(async (db) => {
    let documentoId = null;
    if (id) {
      const doc = await documentoDelCliente(db, sesion, id);
      if (doc.estado_cliente === 'aceptado') throw errores.conflicto('Usted ya aceptó este documento.');
      await documentosRepo.objetar(db, doc.id, sesion.id);
      documentoId = doc.id;
    }
    return ticketsRepo.crear(db, { cliente_id: sesion.id, documento_id: documentoId, email: sesion.email, motivo, detalle });
  });
  console.log(`[tickets] Nuevo ticket #${ticketId} de ${sesion.razon_social} (${sesion.email}): ${MOTIVOS[motivo]}`);
  return { ok: true, id: ticketId, mensaje: `Recibimos su ticket #${ticketId}. Le responderemos por correo y en esta misma sección.` };
}

async function archivoFinal(sesion, id) {
  const doc = await conSistema((db) => documentoDelCliente(db, sesion, id));
  if (doc.estado_cliente !== 'aceptado') throw errores.sinPermiso('Acepte el borrador para descargar el documento final.');
  return { nombre: doc.url_archivo.split('/').pop(), contenido: await archivos.leer(doc.url_archivo) };
}

async function ticketsCliente(sesion) {
  return conSistema(async (db) => ({ tickets: await ticketsRepo.porCliente(db, sesion.id), motivos: MOTIVOS }));
}

module.exports = {
  MOTIVOS, borradorHtml, avisarPublicado,
  borradorPersonal, publicar, listarTickets, atenderTicket,
  borradorCliente, aceptar, enviarTicket, archivoFinal, ticketsCliente
};
