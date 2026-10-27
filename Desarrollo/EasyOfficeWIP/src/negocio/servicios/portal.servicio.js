/* =========================================================
   CAPA DE NEGOCIO · Portal de clientes con enlace mágico.

   1. El cliente escribe su correo. Si existe en clientes.email, se le envía
      un enlace por cada cliente asociado (una persona puede tener varias empresas).
   2. El enlace lleva un token firmado (HMAC-SHA256) con el id del cliente, el correo,
      el vencimiento (15 min) y un identificador único: no se guarda nada en la BD
      y solo se puede usar una vez.
   3. Al abrirlo se crea una sesión de cliente, separada de la del personal.
   La respuesta al pedir el enlace es siempre la misma, exista o no el correo,
   para no revelar quién es cliente.
   ========================================================= */
const crypto = require('crypto');
const config = require('../../config');
const { errores } = require('../../comun/errores');
const { conCliente } = require('../../datos/conexion');
const correo = require('../../datos/correo');
const portalRepo = require('../../datos/repositorios/portal.repositorio');
const sesionesRepo = require('../../datos/repositorios/sesiones.repositorio');
const clientesRepo = require('../../datos/repositorios/clientes.repositorio');
const representantesRepo = require('../../datos/repositorios/representantes.repositorio');
const direccionesRepo = require('../../datos/repositorios/direcciones.repositorio');
const contratosRepo = require('../../datos/repositorios/contratos.repositorio');
const documentosRepo = require('../../datos/repositorios/documentos.repositorio');
const pagosRepo = require('../../datos/repositorios/pagos.repositorio');
const v = require('../validacion');

const SECRETO = config.cliente.secreto || crypto.randomBytes(32).toString('hex');
if (!config.cliente.secreto) {
  console.warn('[portal] Falta CLIENTE_SECRETO en .env: se generó uno temporal (los enlaces enviados dejan de servir al reiniciar).');
}

const MENSAJE_ENVIADO = 'Si el correo está registrado, le enviamos un enlace de acceso. Revise su bandeja de entrada (y la carpeta de spam). El enlace vence en 15 minutos.';

/* ---------- límite de solicitudes por IP y por correo ---------- */
const solicitudes = new Map(); // clave -> { n, desde }
function excedido(clave) {
  const ahora = Date.now();
  const r = solicitudes.get(clave);
  if (!r || ahora - r.desde > config.cliente.ventanaMs) { solicitudes.set(clave, { n: 1, desde: ahora }); return false; }
  r.n++;
  return r.n > config.cliente.maxSolicitudes;
}

/* ---------- token firmado ---------- */
const b64 = (s) => Buffer.from(s).toString('base64url');
const firmar = (datos) => crypto.createHmac('sha256', SECRETO).update(datos).digest('base64url');

function crearToken(cliente) {
  const carga = b64(JSON.stringify({
    c: cliente.id,
    e: String(cliente.email).toLowerCase(),
    x: Date.now() + config.cliente.enlaceMs,
    n: crypto.randomBytes(12).toString('hex')
  }));
  return `${carga}.${firmar(carga)}`;
}

function leerToken(token) {
  const [carga, firma] = String(token || '').split('.');
  if (!carga || !firma) return null;
  const esperada = firmar(carga);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try { return JSON.parse(Buffer.from(carga, 'base64url').toString()); } catch { return null; }
}

/* ---------- correo ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function correoAcceso(email, enlaces) {
  const filas = enlaces.map(({ cliente, url }) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #E4E7E9;">
      <div style="font-weight:600;color:#282828;">${esc(cliente.razon_social)}</div>
      <div style="font-size:12px;color:#69727D;">RUT ${esc(cliente.rut_fmt)}</div>
    </td><td style="padding:10px 0;border-bottom:1px solid #E4E7E9;text-align:right;">
      <a href="${esc(url)}" style="background:#24D356;color:#fff;text-decoration:none;padding:10px 18px;border-radius:3px;font-weight:600;display:inline-block;">Ingresar</a>
    </td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#333;">
    <h2 style="font-family:Georgia,serif;color:#282828;">Acceso a su cuenta Easy Office</h2>
    <p>Recibimos una solicitud para ingresar a su cuenta con el correo <b>${esc(email)}</b>.
    ${enlaces.length > 1 ? 'Este correo está asociado a varias cuentas; elija a cuál ingresar:' : 'Use el botón para ingresar:'}</p>
    <table style="width:100%;border-collapse:collapse;">${filas}</table>
    <p style="font-size:12px;color:#69727D;margin-top:20px;">El enlace vence en 15 minutos y sirve una sola vez.
    Si usted no lo solicitó, ignore este mensaje: nadie puede ingresar sin acceso a su correo.</p></div>`;
  const texto = `Acceso a su cuenta Easy Office\n\n${enlaces.map(({ cliente, url }) => `${cliente.razon_social}: ${url}`).join('\n')}\n\nEl enlace vence en 15 minutos y sirve una sola vez.`;
  return { para: email, asunto: 'Su enlace de acceso a Easy Office', html, texto };
}

/* ---------- casos de uso ---------- */

async function solicitarAcceso(emailIngresado, ip) {
  const email = v.email(emailIngresado, 'Correo', { opcional: false });
  if (excedido('ip:' + ip) || excedido('correo:' + email)) {
    throw errores.demasiadosIntentos('Demasiadas solicitudes. Espere unos minutos e intente de nuevo.');
  }
  const clientes = await portalRepo.clientesPorEmail(email);
  if (clientes.length) {
    const enlaces = clientes.map((cliente) => ({ cliente, url: `${config.appUrl}/mi-cuenta?acceso=${crearToken(cliente)}` }));
    try {
      await correo.enviar(correoAcceso(email, enlaces));
      if (correo.modoDesarrollo()) enlaces.forEach(({ cliente, url }) => console.log(`[portal · desarrollo] Enlace para ${cliente.razon_social}: ${url}`));
    } catch (err) {
      console.error('[portal] no se pudo enviar el correo de acceso:', err.message);
      throw errores.sinBaseDatos('No pudimos enviar el correo en este momento. Intente más tarde.');
    }
  }
  return { mensaje: MENSAJE_ENVIADO };
}

// Devuelve { token de sesión, cliente } o lanza error si el enlace no sirve
async function verificarEnlace(token) {
  const datos = leerToken(token);
  const invalido = errores.noAutenticado('El enlace no es válido o ya venció. Pida uno nuevo.');
  if (!datos || typeof datos.x !== 'number' || datos.x < Date.now()) throw invalido;
  const cliente = await portalRepo.clientePorId(datos.c);
  // El correo del cliente pudo cambiar después de enviar el enlace
  if (!cliente || String(cliente.email || '').toLowerCase() !== datos.e) throw invalido;
  if (!sesionesRepo.consumirEnlace(datos.n, datos.x)) throw errores.noAutenticado('Este enlace ya se usó. Pida uno nuevo.');

  const sesion = { id: cliente.id, razon_social: cliente.razon_social, rut: cliente.rut_fmt, email: cliente.email };
  const tokenSesion = crypto.randomBytes(32).toString('hex');
  sesionesRepo.guardarCliente(tokenSesion, sesion, Date.now() + config.cliente.duracionMs);
  try { await portalRepo.registrarAcceso(cliente.id, 'LOGIN'); } catch (err) { console.warn('[portal] auditoría:', err.message); }
  return { token: tokenSesion, cliente: sesion };
}

function validarSesion(token) {
  const s = token && sesionesRepo.obtenerCliente(token);
  if (!s) return null;
  if (s.expira < Date.now()) { sesionesRepo.eliminarCliente(token); return null; }
  return s.cliente;
}

async function cerrarSesion(token) {
  const s = token && sesionesRepo.obtenerCliente(token);
  if (!s) return;
  sesionesRepo.eliminarCliente(token);
  try { await portalRepo.registrarAcceso(s.cliente.id, 'LOGOUT'); } catch (err) { console.warn('[portal] auditoría:', err.message); }
}

/*
 * Panel del cliente. El id sale SIEMPRE de la sesión; los repositorios filtran por él
 * y la transacción es de solo lectura.
 */
async function panel(sesion) {
  return conCliente(async (db) => {
    const cliente = await clientesRepo.obtener(db, sesion.id);
    if (!cliente) throw errores.noAutenticado('Su cuenta ya no está disponible.');
    const representante = await representantesRepo.obtener(db, cliente.representante_legal_id);
    if (representante) representante.direccion = await direccionesRepo.obtener(db, representante.direccion_id);
    const contratos = await contratosRepo.porCliente(db, sesion.id);
    for (const k of contratos) k.detalle_servicios = await contratosRepo.servicios(db, k.id);
    const documentos = await documentosRepo.porCliente(db, sesion.id);
    const pagos = await pagosRepo.porCliente(db, sesion.id);
    return {
      cliente: {
        razon_social: cliente.razon_social, nombre_fantasia: cliente.nombre_fantasia, rut: cliente.rut_fmt,
        giro: cliente.giro_principal, email: cliente.email, celular: cliente.celular, desde: cliente.creado_en
      },
      representante: representante && {
        nombre: representante.nombre_completo, rut: representante.rut_fmt,
        domicilio: representante.direccion ? `${representante.direccion.texto}, ${representante.direccion.region}` : null
      },
      contratos: contratos.map((k) => ({
        folio: k.folio, estado: k.estado, inicio: k.inicio, vence: k.vence, dias: k.dias, duracion_meses: k.duracion_meses,
        emisora: k.emisora, sucursal: k.sucursal, ejecutivo: k.ejecutivo,
        total: k.total_servicios, pagado: k.pagado, saldo: k.saldo,
        servicios: k.detalle_servicios.map((s) => ({ nombre: s.nombre, precio: s.precio, ciclo: s.ciclo_pago }))
      })),
      documentos: documentos.map((d) => ({
        tipo: d.tipo, folio: d.folio, estado: d.estado, generado: d.generado, firmado: d.firmado, codigo: d.codigo_verificacion
      })),
      pagos: pagos.map((p) => ({ fecha: p.fecha, referencia: p.referencia, monto: p.monto, pasarela: p.pasarela, estado: p.estado, cuota: p.cuota, total_cuotas: p.total_cuotas }))
    };
  });
}

module.exports = { solicitarAcceso, verificarEnlace, validarSesion, cerrarSesion, panel };
