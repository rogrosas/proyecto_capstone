/* =========================================================
   CAPA DE NEGOCIO · Portal de clientes con correo y contraseña.

   Ingreso:
     PERSONA  correo del cliente (clientes.email) + contraseña.
     EMPRESA  RUT de la empresa + correo de una persona vinculada
              (representante legal o autorizada en el CRM) + contraseña.
   La contraseña es por persona y por cliente (cuentas_portal, bcrypt).

   Crear o recuperar la contraseña:
     1. La persona indica empresa/persona, (RUT) y correo. Si está vinculada,
        se le envía un enlace por cada cliente (una persona puede tener varias empresas).
     2. El enlace lleva un token firmado (HMAC-SHA256) con el cliente, el correo,
        el vencimiento (15 min) y un identificador único: no se guarda en la BD
        y solo se puede usar una vez.
     3. Al abrirlo define su contraseña y queda con la sesión iniciada.
   Las respuestas no revelan si un correo o RUT es cliente.
   ========================================================= */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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

const MENSAJE_ENVIADO = 'Si los datos corresponden a una cuenta de Easy Office, le enviamos un enlace para crear su contraseña. Revise su bandeja de entrada (y la carpeta de spam). El enlace vence en 15 minutos.';
const DATOS_INCORRECTOS = 'Los datos de acceso no son correctos. Si aún no tiene contraseña, use "Crear o recuperar contraseña".';

// Hash de relleno: un correo sin cuenta tarda lo mismo que uno con cuenta
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
const TIPOS = { empresa: 'juridica', persona: 'natural' };

/* ---------- límite de intentos por IP y por correo ---------- */
const solicitudes = new Map(); // clave -> { n, desde }
function excedido(clave, max) {
  const ahora = Date.now();
  const r = solicitudes.get(clave);
  if (!r || ahora - r.desde > config.cliente.ventanaMs) { solicitudes.set(clave, { n: 1, desde: ahora }); return false; }
  r.n++;
  return r.n > max;
}

// Ingreso: solo cuentan los intentos fallidos (como el login del CRM), así varios
// clientes detrás de la misma IP no se bloquean entre sí por ingresar bien.
function bloqueado(clave) {
  const r = solicitudes.get(clave);
  return !!r && Date.now() - r.desde <= config.cliente.ventanaMs && r.n >= config.login.maxIntentos;
}
function sumarFallo(...claves) {
  for (const clave of claves) excedido(clave, Infinity);
}

/* ---------- datos de acceso ---------- */
// { tipo: 'empresa' | 'persona', rut (empresa), email } → { tipo de cliente, rut normalizado, email }
function leerAcceso(datos) {
  const tipo = TIPOS[datos?.tipo];
  if (!tipo) throw errores.solicitudInvalida('Indique si ingresa como empresa o como persona.');
  const rut = tipo === 'juridica' ? v.rut(datos.rut, 'RUT de la empresa') : null;
  const email = v.email(datos.email, 'Correo', { opcional: false });
  return { tipo, rut, email };
}

function validarClave(password) {
  const p = String(password ?? '');
  if (p.length < 8) throw errores.solicitudInvalida('La contraseña debe tener al menos 8 caracteres.');
  if (Buffer.byteLength(p) > 72) throw errores.solicitudInvalida('La contraseña es demasiado larga (máximo 72 caracteres).');
  return p;
}

/* ---------- token firmado ---------- */
const b64 = (s) => Buffer.from(s).toString('base64url');
const firmar = (datos) => crypto.createHmac('sha256', SECRETO).update(datos).digest('base64url');

function crearToken(clienteId, tipo, email) {
  const carga = b64(JSON.stringify({
    c: clienteId,
    t: tipo,
    e: email,
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

function correoClave(email, enlaces) {
  const filas = enlaces.map(({ cliente, url }) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #E4E7E9;">
      <div style="font-weight:600;color:#282828;">${esc(cliente.razon_social)}</div>
      <div style="font-size:12px;color:#69727D;">RUT ${esc(cliente.rut_fmt)}</div>
    </td><td style="padding:10px 0;border-bottom:1px solid #E4E7E9;text-align:right;">
      <a href="${esc(url)}" style="background:#24D356;color:#fff;text-decoration:none;padding:10px 18px;border-radius:3px;font-weight:600;display:inline-block;">Crear contraseña</a>
    </td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#333;">
    <h2 style="font-family:Georgia,serif;color:#282828;">Su contraseña de Easy Office</h2>
    <p>Recibimos una solicitud para crear o cambiar la contraseña del correo <b>${esc(email)}</b>.
    ${enlaces.length > 1 ? 'Este correo está vinculado a varias cuentas; cada una tiene su propia contraseña:' : 'Use el botón para definirla:'}</p>
    <table style="width:100%;border-collapse:collapse;">${filas}</table>
    <p style="font-size:12px;color:#69727D;margin-top:20px;">El enlace vence en 15 minutos y sirve una sola vez.
    Si usted no lo solicitó, ignore este mensaje: su contraseña actual sigue igual.</p></div>`;
  const texto = `Su contraseña de Easy Office\n\n${enlaces.map(({ cliente, url }) => `${cliente.razon_social}: ${url}`).join('\n')}\n\nEl enlace vence en 15 minutos y sirve una sola vez.`;
  return { para: email, asunto: 'Cree su contraseña de Easy Office', html, texto };
}

/* ---------- sesión ---------- */
async function abrirSesion(cliente, email) {
  const sesion = { id: cliente.id, razon_social: cliente.razon_social, rut: cliente.rut_fmt, email, tipo: cliente.tipo_persona };
  const token = crypto.randomBytes(32).toString('hex');
  sesionesRepo.guardarCliente(token, sesion, Date.now() + config.cliente.duracionMs);
  try {
    await portalRepo.marcarIngreso(cliente.id, email);
    await portalRepo.registrarAcceso(cliente.id, 'LOGIN');
  } catch (err) { console.warn('[portal] auditoría:', err.message); }
  return { token, cliente: sesion };
}

/* ---------- casos de uso ---------- */

// Devuelve { token de sesión, cliente } o lanza error con un mensaje que no revela qué dato falló
async function iniciarSesion(datos, ip) {
  const { tipo, rut, email } = leerAcceso(datos);
  const password = String(datos?.password ?? '');
  if (!password) throw errores.solicitudInvalida('Ingrese su contraseña.');
  const claves = ['ingreso-ip:' + ip, 'ingreso:' + email];
  if (claves.some(bloqueado)) throw errores.demasiadosIntentos('Demasiados intentos. Espere 15 minutos e intente de nuevo.');
  const cuentas = (await portalRepo.vinculos(email, tipo, rut)).filter((c) => c.activo && c.password_hash);
  if (!cuentas.length) {
    await bcrypt.compare(password, HASH_FALSO);
    sumarFallo(...claves);
    throw errores.noAutenticado(DATOS_INCORRECTOS);
  }
  // Una persona natural no indica RUT: puede haber más de un cliente con su correo
  for (const c of cuentas) {
    if (await bcrypt.compare(password, c.password_hash)) {
      solicitudes.delete('ingreso:' + email);
      return abrirSesion(c, email);
    }
  }
  sumarFallo(...claves);
  throw errores.noAutenticado(DATOS_INCORRECTOS);
}

async function solicitarClave(datos, ip) {
  const { tipo, rut, email } = leerAcceso(datos);
  if (excedido('clave-ip:' + ip, config.cliente.maxSolicitudes) || excedido('clave:' + email, config.cliente.maxSolicitudes)) {
    throw errores.demasiadosIntentos('Demasiadas solicitudes. Espere unos minutos e intente de nuevo.');
  }
  const clientes = (await portalRepo.vinculos(email, tipo, rut)).filter((c) => c.activo);
  if (clientes.length) {
    const enlaces = clientes.map((cliente) => ({ cliente, url: `${config.appUrl}/mi-cuenta?clave=${crearToken(cliente.id, tipo, email)}` }));
    try {
      await correo.enviar(correoClave(email, enlaces));
      if (correo.modoDesarrollo()) enlaces.forEach(({ cliente, url }) => console.log(`[portal · desarrollo] Enlace de contraseña para ${email} en ${cliente.razon_social}: ${url}`));
    } catch (err) {
      console.error('[portal] no se pudo enviar el correo de contraseña:', err.message);
      throw errores.sinBaseDatos('No pudimos enviar el correo en este momento. Intente más tarde.');
    }
  }
  return { mensaje: MENSAJE_ENVIADO };
}

// Define la contraseña con el enlace del correo y deja la sesión iniciada
async function definirClave(token, password) {
  const datos = leerToken(token);
  const invalido = errores.noAutenticado('El enlace no es válido o ya venció. Pida uno nuevo.');
  if (!datos || typeof datos.x !== 'number' || datos.x < Date.now()) throw invalido;
  const clave = validarClave(password);
  // El vínculo pudo cambiar después de enviar el enlace (otro correo, acceso quitado)
  const cliente = (await portalRepo.vinculos(datos.e, datos.t)).find((c) => c.id === datos.c && c.activo);
  if (!cliente) throw invalido;
  if (!sesionesRepo.consumirEnlace(datos.n, datos.x)) throw errores.noAutenticado('Este enlace ya se usó. Pida uno nuevo.');

  await portalRepo.guardarClave(cliente.id, datos.e, await bcrypt.hash(clave, 12));
  return abrirSesion(cliente, datos.e);
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
        id: d.id, tipo: d.tipo, folio: d.folio, estado: d.estado, generado: d.generado, firmado: d.firmado, codigo: d.codigo_verificacion,
        estado_cliente: d.estado_cliente, publicado: d.publicado, aceptado: d.aceptado
      })),
      pagos: pagos.map((p) => ({ fecha: p.fecha, referencia: p.referencia, monto: p.monto, pasarela: p.pasarela, estado: p.estado, cuota: p.cuota, total_cuotas: p.total_cuotas }))
    };
  });
}

module.exports = { iniciarSesion, solicitarClave, definirClave, validarSesion, cerrarSesion, panel };
