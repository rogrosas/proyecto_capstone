/* =========================================================
   CAPA DE NEGOCIO · Correspondencia del domicilio tributario (HU-31).
   Flujo: recibida → (escaneo) digitalizada → notificada al cliente → retirada,
   o devuelta al remitente. Fiscal, judicial y laboral son urgentes; el plazo
   de aviso por defecto es de 24 horas (lo fija la base).
   El cliente la ve en Mi cuenta (con el escaneo) y queda registrado cuándo la leyó.
   ========================================================= */
const crypto = require('crypto');
const config = require('../../config');
const { conUsuario, conSistema, conCliente } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const v = require('../validacion');
const archivos = require('../../datos/archivos');
const correo = require('../../datos/correo');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const clientesRepo = require('../../datos/repositorios/clientes.repositorio');
const repo = require('../../datos/repositorios/correspondencia.repositorio');
const { esc, boton, cuerpo, titulo, pie } = require('../../comun/correos');

const TIPOS = ['fiscal', 'judicial', 'laboral', 'municipal', 'bancaria', 'comercial', 'otra'];
const FILTROS = ['', 'pendientes', 'por_retirar', 'recibida', 'digitalizada', 'notificada', 'retirada', 'devuelta'];
const ZONA = config.bd.zonaHoraria;
const MAX_ESCANEO = 10 * 1024 * 1024;
// Formatos del escaneo por su firma binaria (no por la extensión)
const FORMATOS = [
  { ext: 'pdf', tipo: 'application/pdf', es: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { ext: 'jpg', tipo: 'image/jpeg', es: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ext: 'png', tipo: 'image/png', es: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) }
];

async function listar(usuario, { estado, q }) {
  const filtro = FILTROS.includes(estado) ? estado : 'pendientes';
  return { correspondencia: await conUsuario(usuario, (db) => repo.listar(db, { filtro, texto: String(q || '').trim().slice(0, 80) }, ZONA, 300)) };
}

async function registrar(usuario, d = {}) {
  const c = {
    cliente_id: v.id(d.cliente_id, 'Cliente'),
    sucursal_id: v.id(d.sucursal_id, 'Sucursal', { opcional: true }),
    remitente: v.texto(d.remitente, 'Remitente', { max: 200 }),
    tipo: v.opcion(d.tipo, TIPOS, 'Tipo'),
    descripcion: v.texto(d.descripcion, 'Descripción', { opcional: true, max: 1000 }),
    urgente: v.booleano(d.urgente)
  };
  const id = await conUsuario(usuario, async (db) => {
    if (!(await clientesRepo.obtener(db, c.cliente_id))) throw errores.noEncontrado('Cliente no encontrado o fuera de su cartera.');
    c.sucursal_id ||= await repo.sucursalDe(db, c.cliente_id);
    return repo.crear(db, c);
  });
  const r = { id };
  if (v.booleano(d.notificar)) r.notificada = (await notificar(usuario, id)).ok;
  return r;
}

async function obtener(usuario, id) {
  const c = await conUsuario(usuario, (db) => repo.obtener(db, v.id(id, 'Correspondencia'), ZONA));
  if (!c) throw errores.noEncontrado('Correspondencia no encontrada o de un cliente fuera de su cartera.');
  return c;
}

// Escaneo (PDF, JPG o PNG): queda en la carpeta de contratos, en correspondencia/<año>/
async function subirEscaneo(usuario, id, contenido) {
  const c = await obtener(usuario, id);
  if (!Buffer.isBuffer(contenido) || !contenido.length) throw errores.solicitudInvalida('Adjunte el escaneo.');
  if (contenido.length > MAX_ESCANEO) throw errores.solicitudInvalida('El escaneo supera 10 MB.');
  const f = FORMATOS.find((x) => x.es(contenido));
  if (!f) throw errores.solicitudInvalida('El escaneo debe ser PDF, JPG o PNG.');
  const ruta = `correspondencia/${new Date().getFullYear()}/C${c.id}-${crypto.randomBytes(4).toString('hex')}.${f.ext}`;
  await archivos.guardar(ruta, contenido);
  await conUsuario(usuario, (db) => repo.guardarArchivo(db, c.id, ruta));
  return { ok: true };
}

async function notificar(usuario, id) {
  const c = await obtener(usuario, id);
  if (!['recibida', 'digitalizada', 'notificada'].includes(c.estado)) throw errores.conflicto('Esta correspondencia ya fue retirada o devuelta.');
  const destinos = await portalRepo.contactos(c.cliente_id);
  if (!destinos.length) throw errores.conflicto('El cliente no tiene correo registrado: avísele por teléfono y márquela como retirada al entregarla.');
  for (const para of destinos) {
    await correo.enviar({
      para, asunto: `${c.urgente ? 'URGENTE · ' : ''}Recibimos correspondencia para ${c.cliente}`,
      texto: `Recibimos en su domicilio tributario correspondencia de ${c.remitente} (${c.tipo}). ${c.con_archivo ? 'Puede ver el escaneo en Mi cuenta.' : 'Puede retirarla en nuestra oficina.'}`,
      html: cuerpo(`${titulo(c.urgente ? 'Correspondencia urgente' : 'Recibimos correspondencia para usted')}
        <p>En su domicilio tributario (${esc(c.sucursal)}) llegó correspondencia:</p>
        <p style="background:#F4F6F7;padding:10px 14px;border-left:3px solid ${c.urgente ? '#D8402F' : '#24D356'};">
          <b>${esc(c.remitente)}</b> · ${esc(c.tipo)}${c.descripcion ? `<br>${esc(c.descripcion)}` : ''}</p>
        <p>${c.con_archivo ? 'Puede ver el escaneo en Mi cuenta.' : 'Puede retirarla en nuestra oficina o pedirnos que la escaneemos.'}${c.urgente ? ' Por su tipo, le recomendamos revisarla hoy.' : ''}</p>
        ${boton(`${config.appUrl}/mi-cuenta`, 'Ver en Mi cuenta')}${pie}`)
    });
  }
  if (c.estado !== 'notificada') await conUsuario(usuario, (db) => repo.cambiarEstado(db, c.id, 'notificada', ['recibida', 'digitalizada']));
  return { ok: true, enviados: destinos.length };
}

async function cambiarEstado(usuario, id, d = {}) {
  const estado = v.opcion(d.estado, ['retirada', 'devuelta'], 'Estado');
  const c = await obtener(usuario, id);
  if (!(await conUsuario(usuario, (db) => repo.cambiarEstado(db, c.id, estado, ['recibida', 'digitalizada', 'notificada'])))) throw errores.conflicto('Esta correspondencia ya fue retirada o devuelta.');
  return { ok: true };
}

const tipoArchivo = (ruta) => FORMATOS.find((f) => ruta.endsWith('.' + f.ext))?.tipo || 'application/octet-stream';

async function archivo(usuario, id) {
  const c = await obtener(usuario, id);
  if (!c.url_archivo) throw errores.noEncontrado('Esta correspondencia no tiene escaneo.');
  return { nombre: c.url_archivo.split('/').pop(), tipo: tipoArchivo(c.url_archivo), contenido: await archivos.leer(c.url_archivo) };
}

/* ---------- Portal del cliente ---------- */
async function delCliente(sesion) {
  return { correspondencia: await conCliente((db) => repo.porCliente(db, sesion.id, ZONA)) };
}

async function archivoCliente(sesion, id) {
  id = v.id(id, 'Correspondencia');
  const c = await conSistema(async (db) => {
    const x = await repo.delCliente(db, id, sesion.id);
    if (x && x.estado !== 'recibida') await repo.marcarLeida(db, id, sesion.id);   // abrir el escaneo cuenta como leída
    return x;
  });
  if (!c || c.estado === 'recibida') throw errores.noEncontrado('Correspondencia no encontrada.');
  if (!c.url_archivo) throw errores.noEncontrado('Esta correspondencia no tiene escaneo: puede retirarla en nuestra oficina.');
  return { nombre: c.url_archivo.split('/').pop(), tipo: tipoArchivo(c.url_archivo), contenido: await archivos.leer(c.url_archivo) };
}

async function marcarLeida(sesion, id) {
  id = v.id(id, 'Correspondencia');
  await conSistema((db) => repo.marcarLeida(db, id, sesion.id));
  return { ok: true };
}

module.exports = { TIPOS, listar, registrar, subirEscaneo, notificar, cambiarEstado, archivo, delCliente, archivoCliente, marcarLeida };
