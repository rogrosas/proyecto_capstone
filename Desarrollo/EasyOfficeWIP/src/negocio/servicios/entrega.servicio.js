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
const word = require('../../datos/word');
const config = require('../../config');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const ticketsRepo = require('../../datos/repositorios/tickets.repositorio');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const portalServicio = require('./portal.servicio');
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

// Sin marca de agua (marca: false) es la vista del documento que se firma
async function borradorHtml(doc, { marca = true } = {}) {
  if (!doc.url_archivo || /^https?:\/\//i.test(doc.url_archivo)) throw errores.noEncontrado('Este documento aún no tiene archivo Word.');
  if (!marca) {
    const { value } = await mammoth.convertToHtml({ buffer: await archivos.leer(doc.url_archivo) });
    return paginaDocumento(doc, value, 'DOCUMENTO PARA FIRMA · Revíselo completo antes de firmar.', false);
  }
  const { value } = await mammoth.convertToHtml({ buffer: await archivos.leer(doc.url_archivo) });
  return paginaDocumento(doc, value, 'BORRADOR PARA REVISIÓN · Sin validez legal hasta que usted lo acepte y se firme.', true);
}

function paginaDocumento(doc, html, aviso, conMarca) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${conMarca ? 'Borrador' : 'Documento'} · ${esc(doc.tipo)}${doc.folio ? ' · ' + esc(doc.folio) : ''}</title>
<style>
  html,body{margin:0;background:#E9ECEE;color:#222;}
  .aviso{position:sticky;top:0;z-index:5;background:#FFF4E0;border-bottom:1px solid #F0D39C;color:#7A4B00;
         font:600 13px/1.4 Arial,sans-serif;padding:10px 16px;text-align:center;}
  .hoja{position:relative;max-width:780px;margin:22px auto;background:#fff;padding:56px 64px;box-shadow:0 4px 16px rgba(0,0,0,.12);
        font:14.5px/1.6 Georgia,'Times New Roman',serif;overflow-wrap:anywhere;-webkit-user-select:none;user-select:none;}
  ${conMarca ? `.hoja::after{content:'';position:absolute;inset:0;z-index:3;pointer-events:none;
        background-image:url("data:image/svg+xml,${MARCA_AGUA}");background-repeat:repeat;
        -webkit-print-color-adjust:exact;print-color-adjust:exact;}` : ''}
  .hoja table{border-collapse:collapse;width:100%;margin:10px 0;} .hoja td,.hoja th{border:1px solid #ccc;padding:5px 7px;vertical-align:top;}
  .hoja img{max-width:100%;height:auto;} .hoja p{margin:0 0 10px;}
  @media (max-width:640px){.hoja{margin:0;padding:28px 18px;box-shadow:none;}}
</style></head><body>
<div class="aviso">${esc(aviso)}</div>
<div class="hoja">${html}</div>
</body></html>`;
}

/* ---------- Avisos por correo ---------- */
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const boton = (url, texto) => `<p style="margin-top:22px;"><a href="${esc(url)}" style="background:#24D356;color:#fff;text-decoration:none;padding:10px 18px;border-radius:3px;font-weight:600;display:inline-block;">${esc(texto)}</a></p>`;
const cuerpo = (html) => `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#333;">${html}</div>`;

async function destinosDe(clienteId) {
  try { return await portalRepo.contactos(clienteId); } catch (err) { console.warn('[entrega] contactos:', err.message); return []; }
}

async function avisar(clienteId, asunto, cuerpoHtml, texto) {
  for (const para of await destinosDe(clienteId)) {
    try {
      await correo.enviar({ para, asunto, texto, html: cuerpo(cuerpoHtml + boton(`${config.appUrl}/mi-cuenta`, 'Ir a Mi cuenta')) });
    } catch (err) { console.warn('[entrega] no se pudo enviar el aviso a', para, err.message); }
  }
}

/*
 * Documento publicado al cliente. Quien ya tiene cuenta recibe el aviso para revisarlo en Mi cuenta.
 * Quien no tiene cuenta recibe el documento en el correo: el borrador en Word con marca de agua,
 * más el enlace para crear su contraseña, aceptarlo y descargar el documento final.
 * Devuelve a cuántos se les envió el documento adjunto.
 */
async function avisarPublicado(doc) {
  const titulo = `<b>${esc(doc.tipo)}</b>${doc.folio ? ` · contrato ${esc(doc.folio)}` : ''}`;
  let adjunto = null, adjuntos = 0;
  for (const para of await destinosDe(doc.cliente_id)) {
    try {
      if (await portalRepo.tieneClave(doc.cliente_id, para)) {
        await correo.enviar({
          para, asunto: 'Tiene un documento para revisar en Easy Office',
          texto: `Su documento ${doc.tipo}${doc.folio ? ' (contrato ' + doc.folio + ')' : ''} está listo para revisión en ${config.appUrl}/mi-cuenta`,
          html: cuerpo(`<h2 style="font-family:Georgia,serif;color:#282828;">Su documento está listo para revisión</h2>
            <p>${titulo}.</p>
            <p>Ingrese a su cuenta, revise el borrador y acéptelo para recibir el documento final. Si algo no está correcto, puede enviarnos un ticket desde el mismo lugar.</p>`
            + boton(`${config.appUrl}/mi-cuenta`, 'Ir a Mi cuenta'))
        });
        continue;
      }
      adjunto ||= {
        nombre: `Borrador - ${doc.tipo}${doc.folio ? ' ' + doc.folio : ''}.docx`.replace(/[\\/:*?"<>|]+/g, '-'),
        contenido: word.marcaDeAgua(await archivos.leer(doc.url_archivo)), tipo: DOCX
      };
      const url = portalServicio.enlaceClave(doc.cliente_id, doc.tipo_persona, para);
      if (correo.modoDesarrollo()) console.log(`[portal · desarrollo] Enlace de contraseña para ${para} en ${doc.cliente}: ${url}`);
      await correo.enviar({
        para, asunto: 'Su documento de Easy Office (borrador para revisar)', adjuntos: [adjunto],
        texto: `Adjuntamos el borrador de su documento ${doc.tipo}${doc.folio ? ' (contrato ' + doc.folio + ')' : ''}. Para aceptarlo y recibir el documento final, cree su contraseña: ${url} (el enlace vence en 15 minutos; si vence, pida otro en ${config.appUrl}/mi-cuenta).`,
        html: cuerpo(`<h2 style="font-family:Georgia,serif;color:#282828;">Le enviamos su documento</h2>
          <p>${titulo}.</p>
          <p>Adjuntamos el <b>borrador</b> en Word, con marca de agua, para que lo revise. Para aceptarlo y recibir el documento final, cree su contraseña de <b>Mi cuenta</b>: ahí también puede enviarnos un ticket si algo no está correcto.</p>`
          + boton(url, 'Crear mi contraseña y revisar')
          + `<p style="font-size:12px;color:#69727D;margin-top:18px;">El enlace vence en 15 minutos y sirve una sola vez. Si vence, pida otro en ${esc(config.appUrl)}/mi-cuenta → "Crear o recuperar contraseña".</p>`)
      });
      adjuntos++;
    } catch (err) { console.warn('[entrega] no se pudo enviar el documento a', para, err.message); }
  }
  return adjuntos;
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
    const aprobado = await documentosRepo.aprobarParaPublicar(db, id);
    await documentosRepo.fijarEntrega(db, id, 'por_revisar');
    return { ...d, aprobado };
  });
  const adjuntos = await avisarPublicado(doc);
  return { ok: true, aprobado: doc.aprobado, enviado_por_correo: adjuntos > 0 };
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

const ETIQUETA_TICKET = { abierto: 'abierto', en_proceso: 'en proceso', resuelto: 'resuelto', cerrado: 'cerrado' };

// Conversación de un ticket (CRM)
async function detalleTicket(usuario, id) {
  id = v.id(id, 'Ticket');
  return conUsuario(usuario, async (db) => {
    const ticket = await ticketsRepo.obtener(db, id);
    if (!ticket) throw errores.noEncontrado('Ticket no encontrado o fuera de su cartera.');
    return { ticket, mensajes: await ticketsRepo.mensajes(db, id), motivos: MOTIVOS };
  });
}

/*
 * El personal responde (mensaje) y/o cambia el estado. Cada mensaje queda con su autor y hora; un cambio
 * de estado queda como mensaje del sistema. Responder un ticket abierto lo deja "en proceso".
 */
async function atenderTicket(usuario, id, d = {}) {
  id = v.id(id, 'Ticket');
  const respuesta = v.texto(d.respuesta, 'Respuesta', { opcional: true, max: 4000 });
  const pedido = v.opcion(d.estado, ESTADOS_TICKET, 'Estado', { opcional: true });
  if (!respuesta && !pedido) throw errores.solicitudInvalida('Escriba un mensaje o elija un estado.');
  const t = await conUsuario(usuario, async (db) => {
    const actual = await ticketsRepo.obtener(db, id);
    if (!actual) throw errores.noEncontrado('Ticket no encontrado o fuera de su cartera.');
    const estado = pedido || (respuesta && actual.estado === 'abierto' ? 'en_proceso' : actual.estado);
    if (['resuelto', 'cerrado'].includes(estado) && !respuesta && !actual.respuesta) {
      throw errores.solicitudInvalida('Escriba una respuesta para el cliente antes de resolver o cerrar el ticket.');
    }
    if (respuesta) await ticketsRepo.agregarMensaje(db, { ticket_id: id, autor_tipo: 'personal', texto: respuesta });
    if (estado !== actual.estado) {
      await ticketsRepo.agregarMensaje(db, { ticket_id: id, autor_tipo: 'sistema', texto: `${usuario.nombre} cambió el estado a "${ETIQUETA_TICKET[estado]}".` });
    }
    await ticketsRepo.atender(db, id, { estado, respuesta });
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
  // Aceptado el borrador, el documento sigue solo a la firma electrónica (si se puede; si no, queda para el personal)
  const firma = await require('./firma.servicio').enviarAlAceptar(doc.id);   // require diferido: firma también usa este módulo
  return { ok: true, documento_id: doc.id, en_firma: !!firma };
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
  await require('./personal.servicio').avisar(sesion.id, {
    asunto: `Nuevo ticket #${ticketId} de ${sesion.razon_social}`,
    titulo: 'Un cliente envió un ticket',
    lineas: [`${sesion.razon_social} (${sesion.email}) · ${MOTIVOS[motivo]}${id ? ' · sobre un documento' : ''}:`, detalle],
    seccion: 'tickets'
  });
  return { ok: true, id: ticketId, mensaje: `Recibimos su ticket #${ticketId}. Le responderemos por correo y en esta misma sección.` };
}

async function archivoFinal(sesion, id) {
  const doc = await conSistema((db) => documentoDelCliente(db, sesion, id));
  // Firmado, se entrega el documento que devolvió la plataforma de firma
  if (doc.archivo_firmado) return { nombre: doc.archivo_firmado.split('/').pop(), contenido: await archivos.leer(doc.archivo_firmado) };
  if (doc.estado_cliente !== 'aceptado') throw errores.sinPermiso('Acepte el borrador para descargar el documento final.');
  return { nombre: doc.url_archivo.split('/').pop(), contenido: await archivos.leer(doc.url_archivo) };
}

// Mi cuenta: los tickets del cliente, cada uno con su conversación
async function ticketsCliente(sesion) {
  return conSistema(async (db) => {
    const tickets = await ticketsRepo.porCliente(db, sesion.id);
    for (const t of tickets) t.conversacion = await ticketsRepo.mensajes(db, t.id);
    return { tickets, motivos: MOTIVOS };
  });
}

// El cliente responde en la conversación. Si el ticket estaba resuelto, se reabre; uno cerrado ya no admite mensajes.
async function responderTicket(sesion, id, d = {}) {
  id = v.id(id, 'Ticket');
  const texto = v.texto(d.texto, 'Mensaje', { max: 4000 });
  const t = await conSistema(async (db) => {
    const x = await ticketsRepo.obtener(db, id);
    if (!x || x.cliente_id !== sesion.id) throw errores.noEncontrado('Ticket no encontrado.');
    if (x.estado === 'cerrado') throw errores.conflicto('Este ticket está cerrado. Si necesita algo más, envíe una nueva consulta.');
    await ticketsRepo.agregarMensaje(db, { ticket_id: id, autor_tipo: 'cliente', email: sesion.email, texto });
    if (await ticketsRepo.reabrir(db, id)) {
      await ticketsRepo.agregarMensaje(db, { ticket_id: id, autor_tipo: 'sistema', texto: 'El cliente respondió: el ticket se reabrió.' });
    } else await ticketsRepo.tocar(db, id);
    return x;
  });
  await require('./personal.servicio').avisar(sesion.id, {
    asunto: `Respuesta del cliente en el ticket #${id} · ${sesion.razon_social}`,
    titulo: `El cliente respondió el ticket #${id}`,
    lineas: [`${sesion.razon_social} (${sesion.email}) escribió${t.documento ? ` sobre ${t.documento}` : ''}:`, texto],
    seccion: 'tickets'
  });
  return { ok: true };
}

module.exports = {
  MOTIVOS, borradorHtml, avisarPublicado,
  borradorPersonal, publicar, listarTickets, detalleTicket, atenderTicket,
  borradorCliente, aceptar, enviarTicket, archivoFinal, ticketsCliente, responderTicket
};
