/* =========================================================
   CAPA DE NEGOCIO · Firma electrónica de documentos (TT-05, HU-22, HU-32).

   Flujo (especificación §7):
     1. El documento queda listo: aprobado por el personal (si requiere
        revisión) y, si se publicó al cliente, aceptado por él.
     2. Se envía a la plataforma de firma con sus firmantes (la persona natural,
        o el representante legal de la empresa). Al aceptar el borrador se
        envía solo (config.firma.alAceptar); el personal también puede enviarlo.
     3. La plataforma avisa cada firma o rechazo (registrarEvento).
     4. Con todas las firmas: se guarda el documento firmado y su huella SHA-256,
        se le asigna el código de verificación EO-XXXX-XXXX y el estado pasa a
        "firmado" (la base descuenta la firma del saldo del cliente).
     5. El cliente lo descarga en Mi cuenta y cualquiera puede verificarlo en /verificar.
   Un rechazo devuelve el documento a "rechazado" y abre un ticket para el personal.
   ========================================================= */
const crypto = require('crypto');
const config = require('../../config');
const { conUsuario, conSistema } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const v = require('../validacion');
const archivos = require('../../datos/archivos');
const correo = require('../../datos/correo');
const plataforma = require('../../datos/firma');
const firmaRepo = require('../../datos/repositorios/firma.repositorio');
const ticketsRepo = require('../../datos/repositorios/tickets.repositorio');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const { esc, boton, cuerpo, titulo, pie } = require('../../comun/correos');

const urlVerificacion = (codigo) => `${config.appUrl}/verificar?codigo=${encodeURIComponent(codigo)}`;
const tituloDe = (doc) => `${doc.tipo}${doc.folio ? ` · ${doc.folio}` : ''}`;

// Por qué un documento todavía no puede ir a firma (o null si puede)
function impedimento(doc) {
  // Marcado "enviado a firma" a mano antes de existir la plataforma: se puede enviar a ella
  const manual = doc.estado === 'enviado_firma' && !doc.firma_proveedor;
  if (doc.estado === 'enviado_firma' && !manual) return 'El documento ya está en firma.';
  if (doc.estado === 'firmado') return 'El documento ya está firmado.';
  if (!doc.url_archivo || /^https?:\/\//i.test(doc.url_archivo)) return 'Primero genere el documento Word.';
  if (!manual && !(doc.estado === 'aprobado' || (doc.estado === 'borrador' && !doc.requiere_revision))) {
    return doc.requiere_revision ? 'El documento requiere la aprobación del personal antes de firmarse.' : `No se puede firmar un documento "${doc.estado}".`;
  }
  // El cliente siempre ve el borrador con marca de agua y lo acepta antes de firmar
  if (doc.estado_cliente === 'por_revisar') return 'El cliente aún no acepta el borrador.';
  if (doc.estado_cliente === 'objetado') return 'El cliente objetó el borrador: genere una nueva versión.';
  if (doc.estado_cliente !== 'aceptado') return 'Publique el borrador al cliente: debe revisarlo y aceptarlo antes de firmar.';
  return null;
}

function firmantesDe(doc) {
  const f = doc.tipo_persona === 'juridica'
    ? { nombre: doc.rep_nombre, rut: doc.rep_rut, email: doc.rep_email, quien: 'el representante legal' }
    : { nombre: doc.razon_social, rut: doc.rut, email: doc.email, quien: 'el cliente' };
  if (!f.nombre || !f.email) throw errores.conflicto(`Falta el correo de ${f.quien}: regístrelo en la ficha del cliente para enviar a firma.`);
  return [{ orden: 1, nombre: f.nombre, rut: f.rut || null, email: f.email.toLowerCase() }];
}

// Envía a la plataforma y deja el documento "enviado a firma". Usa db de conUsuario (CRM) o conSistema (portal).
async function enviarEnTransaccion(db, id) {
  const doc = await firmaRepo.paraFirmar(db, id);
  if (!doc) throw errores.noEncontrado('Documento no encontrado o fuera de su cartera.');
  const motivo = impedimento(doc);
  if (motivo) throw errores.conflicto(motivo);
  const firmantes = firmantesDe(doc);
  const prov = plataforma.proveedor();
  const solicitud = await prov.crearSolicitud({ documentoId: doc.id, titulo: tituloDe(doc), archivo: await archivos.leer(doc.url_archivo), firmantes });
  const conIds = firmantes.map((f) => ({ ...f, idExterno: solicitud.firmantes.find((x) => x.orden === f.orden).idExterno }));
  if (!(await firmaRepo.iniciar(db, doc.id, doc.estado, { proveedor: plataforma.nombre(), idExterno: solicitud.idExterno, firmantes: conIds }))) {
    throw errores.conflicto('El documento cambió mientras tanto; recargue e intente de nuevo.');
  }
  return { ok: true, estado: 'enviado_firma', solicitud: solicitud.idExterno, firmantes: conIds.map(({ nombre, email }) => ({ nombre, email })) };
}

/* ---------- Casos de uso ---------- */

// CRM: "Enviar a firma"
async function enviar(usuario, id) {
  id = v.id(id, 'Documento');
  return conUsuario(usuario, (db) => enviarEnTransaccion(db, id));
}

// Portal: al aceptar el borrador. Si no se puede (falta un correo, otra regla), queda para el personal.
async function enviarAlAceptar(id) {
  if (!config.firma.alAceptar || !plataforma.activo()) return null;
  try {
    return await conSistema((db) => enviarEnTransaccion(db, id));
  } catch (err) {
    console.warn(`[firma] el documento ${id} no se envió a firma al aceptarlo: ${err.message}`);
    return null;
  }
}

/*
 * Aviso de la plataforma: un firmante firmó o rechazó.
 * e = { firmante (id externo), evento: 'firmado' | 'rechazado', ip, motivo }
 */
async function registrarEvento(e) {
  const evento = v.opcion(e.evento, ['firmado', 'rechazado'], 'Evento');
  const motivo = evento === 'rechazado' ? v.texto(e.motivo, 'Motivo del rechazo', { max: 1000 }) : null;
  const r = await conSistema(async (db) => {
    const f = await firmaRepo.firmantePorExterno(db, String(e.firmante || ''));
    if (!f) throw errores.noEncontrado('Firmante no encontrado.');
    if (f.estado_documento !== 'enviado_firma') throw errores.conflicto('Este documento ya no está esperando firmas.');
    if (f.estado !== 'pendiente') throw errores.conflicto(f.estado === 'firmado' ? 'Usted ya firmó este documento.' : 'Usted rechazó este documento.');
    await firmaRepo.marcarFirmante(db, f.id, { estado: evento, ip: e.ip, motivo });

    if (evento === 'rechazado') {
      await firmaRepo.rechazar(db, f.documento_id);
      const ticket = await ticketsRepo.crear(db, {
        cliente_id: f.cliente_id, documento_id: f.documento_id, email: f.email, motivo: 'otro',
        detalle: `${f.nombre} rechazó la firma electrónica de "${tituloDe(f)}". Motivo: ${motivo}`
      });
      return { documento: f, ticket };
    }
    const todos = await firmaRepo.firmantes(db, f.documento_id);
    if (todos.some((x) => x.estado !== 'firmado')) return { documento: f, faltan: todos.filter((x) => x.estado !== 'firmado').length };
    return { documento: f, completo: await completar(db, f, todos) };
  });

  if (r.completo) await avisarFirmado(r.documento, r.completo.codigo);
  if (r.ticket) {
    console.log(`[firma] ${r.documento.nombre} rechazó la firma del documento ${r.documento.documento_id}: ticket #${r.ticket}`);
    await require('./personal.servicio').avisar(r.documento.cliente_id, {
      asunto: `Firma rechazada: ${tituloDe(r.documento)}`,
      titulo: 'Un firmante rechazó la firma',
      lineas: [`${r.documento.nombre} rechazó firmar "${tituloDe(r.documento)}". Motivo: ${motivo}`, `Se abrió el ticket #${r.ticket}: respóndalo, corrija el documento y vuelva a publicarlo.`],
      seccion: 'tickets'
    });
  }
  return { ok: true, evento, completo: !!r.completo, codigo: r.completo?.codigo || null, faltan: r.faltan || 0 };
}

async function nuevoCodigo(db) {
  for (;;) {
    const h = crypto.randomBytes(4).toString('hex').toUpperCase();
    const codigo = `EO-${h.slice(0, 4)}-${h.slice(4)}`;
    if (await firmaRepo.codigoLibre(db, codigo)) return codigo;
  }
}

// Todas las firmas listas: documento firmado de la plataforma, huella, código y estado "firmado"
async function completar(db, f, firmantes) {
  const codigo = await nuevoCodigo(db);
  const firmado = await plataforma.proveedor().documentoFirmado({
    idExterno: f.firma_id_externo, original: await archivos.leer(f.url_archivo), firmantes, codigo, urlVerificacion: urlVerificacion(codigo)
  });
  const archivo = f.url_archivo.replace(/(_v\d+)?\.docx$/i, '$1_firmado.docx');
  await archivos.guardar(archivo, firmado);
  const hash = crypto.createHash('sha256').update(firmado).digest('hex');
  if (!(await firmaRepo.completar(db, f.documento_id, { codigo, archivo, hash }))) throw errores.conflicto('El documento cambió mientras se firmaba.');
  return { codigo, archivo, hash };
}

async function avisarFirmado(doc, codigo) {
  let destinos = [];
  try { destinos = await portalRepo.contactos(doc.cliente_id); } catch (err) { console.warn('[firma] contactos:', err.message); }
  for (const para of destinos) {
    try {
      await correo.enviar({
        para, asunto: `Documento firmado: ${tituloDe(doc)}`,
        texto: `Su documento "${tituloDe(doc)}" quedó firmado. Código de verificación: ${codigo}. Descárguelo en Mi cuenta: ${config.appUrl}/mi-cuenta`,
        html: cuerpo(`${titulo('Su documento quedó firmado')}
          <p>El documento <b>${esc(tituloDe(doc))}</b> tiene todas sus firmas. Puede descargarlo en Mi cuenta.</p>
          <p>Código de verificación: <b style="font-family:monospace;font-size:15px;">${esc(codigo)}</b><br>
          <a href="${esc(urlVerificacion(codigo))}">Verificar el documento</a></p>
          ${boton(`${config.appUrl}/mi-cuenta`, 'Ir a Mi cuenta')}${pie}`)
      });
    } catch (err) { console.warn('[firma] no se pudo avisar a', para, err.message); }
  }
}

/* ---------- Documento firmado ---------- */
async function leerFirmado(doc) {
  if (!doc) throw errores.noEncontrado('Documento no encontrado.');
  if (!doc.archivo_firmado) throw errores.conflicto('El documento aún no está firmado.');
  return { nombre: doc.archivo_firmado.split('/').pop(), contenido: await archivos.leer(doc.archivo_firmado) };
}

async function archivoFirmadoPersonal(usuario, id) {
  id = v.id(id, 'Documento');
  return leerFirmado(await conUsuario(usuario, (db) => firmaRepo.archivoFirmado(db, id)));
}

// Portal: firmantes del documento y, si quien entró debe firmar, su enlace
async function firmaParaCliente(db, documento, email) {
  const firmantes = await firmaRepo.firmantes(db, documento.id);
  const yo = firmantes.find((f) => f.estado === 'pendiente' && f.email.toLowerCase() === String(email).toLowerCase());
  let enlace = null;
  if (yo && documento.estado === 'enviado_firma' && plataforma.activo() && plataforma.proveedor().enlace) enlace = plataforma.proveedor().enlace(yo.id_externo);
  return { firmantes: firmantes.map((f) => ({ nombre: f.nombre, estado: f.estado, firmado: f.firmado })), enlace };
}

/* ---------- Página del simulador (/firma-simulada) ---------- */
async function verSimulada(token) {
  const prov = plataforma.proveedor();
  if (!prov.leerToken) throw errores.noEncontrado();
  const idExterno = prov.leerToken(token);
  return conSistema(async (db) => {
    const f = await firmaRepo.firmantePorExterno(db, idExterno);
    if (!f) throw errores.noEncontrado('Solicitud de firma no encontrada.');
    return {
      documento: { tipo: f.tipo, folio: f.folio }, firmante: { nombre: f.nombre, rut: f.rut_fmt, con_rut: !!f.rut },
      estado: f.estado, estado_documento: f.estado_documento
    };
  });
}

async function firmarSimulada(token, d = {}, ip) {
  const prov = plataforma.proveedor();
  if (!prov.leerToken) throw errores.noEncontrado();
  const idExterno = prov.leerToken(token);
  if (d.accion === 'firmar') {
    if (d.acepto !== true) throw errores.solicitudInvalida('Confirme que leyó el documento y que firma con su identidad.');
    const f = await conSistema((db) => firmaRepo.firmantePorExterno(db, idExterno));
    // En la plataforma real aquí se valida la identidad (Clave Única o firma electrónica avanzada)
    if (f?.rut && v.rut(d.rut, 'Su RUT') !== f.rut) throw errores.solicitudInvalida('El RUT no coincide con el del firmante.');
  }
  return registrarEvento({ firmante: idExterno, evento: d.accion === 'firmar' ? 'firmado' : d.accion === 'rechazar' ? 'rechazado' : null, ip, motivo: d.motivo });
}

// Vista del documento que se firma (sin marca de agua)
async function documentoSimulada(token) {
  const prov = plataforma.proveedor();
  if (!prov.leerToken) throw errores.noEncontrado();
  const f = await conSistema((db) => firmaRepo.firmantePorExterno(db, prov.leerToken(token)));
  if (!f) throw errores.noEncontrado('Solicitud de firma no encontrada.');
  return require('./entrega.servicio').borradorHtml(f, { marca: false });   // require diferido: entrega también usa este módulo
}

/* ---------- Aviso de la plataforma real (POST /api/firma/aviso) ---------- */
function validarAviso(secreto) {
  const esperado = config.firma.secreto;
  const dado = String(secreto || '');
  if (!esperado || dado.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(esperado))) {
    throw errores.noAutenticado('Aviso de firma no autorizado.');
  }
}

/* ---------- Verificación pública por código (HU-22) ---------- */
async function verificar(codigo) {
  const c = String(codigo || '').trim().toUpperCase();
  if (!/^EO-[0-9A-F]{4}-[0-9A-F]{4}$/.test(c)) throw errores.solicitudInvalida('El código tiene el formato EO-XXXX-XXXX.');
  const d = await conSistema((db) => firmaRepo.porCodigo(db, c, config.bd.zonaHoraria));
  if (!d || d.estado !== 'firmado') return { valido: false, codigo: c };
  // De las personas se muestra el primer nombre y las iniciales: basta para reconocerlas sin exponer sus datos
  const nombre = (n) => String(n).split(/\s+/).map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(' ');
  return {
    valido: true, codigo: c, documento: d.tipo, folio: d.folio, firmado: d.firmado, cliente: nombre(d.cliente),
    hash: d.hash_firmado, plataforma: d.firma_proveedor === 'simulador' ? 'Simulador de laboratorio' : 'Plataforma de firma electrónica',
    firmantes: await conSistema(async (db) => (await firmaRepo.firmantes(db, d.id)).map((x) => ({ nombre: nombre(x.nombre), firmado: x.firmado_en })))
  };
}

module.exports = {
  impedimento, enviar, enviarAlAceptar, registrarEvento, archivoFirmadoPersonal, leerFirmado, firmaParaCliente,
  verSimulada, firmarSimulada, documentoSimulada, validarAviso, verificar
};
