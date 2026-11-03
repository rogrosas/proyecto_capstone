/* =========================================================
   CAPA DE NEGOCIO · Autenticación del personal.
   Reglas: contraseña bcrypt, usuario activo, límite de intentos por IP,
   bloqueo temporal de la cuenta tras varias claves malas seguidas,
   segundo factor TOTP opcional (HU-04), recuperación de la contraseña con
   un enlace de un solo uso, sesión con vencimiento y registro de LOGIN /
   LOGOUT en auditoría.
   ========================================================= */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const { errores } = require('../../comun/errores');
const totp = require('../../comun/totp');
const { esc, boton, cuerpo, titulo, pie } = require('../../comun/correos');
const correo = require('../../datos/correo');
const { esAdmin } = require('../roles');
const usuariosRepo = require('../../datos/repositorios/usuarios.repositorio');
const sesionesRepo = require('../../datos/repositorios/sesiones.repositorio');

// Hash de relleno: un correo inexistente tarda lo mismo que uno válido
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
const ES_BCRYPT = /^\$2[aby]\$/;
const MIN_CLAVE = 10;

/* ---------- límite de intentos por IP ---------- */
const intentos = new Map(); // ip -> { n, desde }

function bloqueado(ip) {
  const r = intentos.get(ip);
  return !!r && Date.now() - r.desde <= config.login.ventanaMs && r.n >= config.login.maxIntentos;
}

function sumarIntento(ip) {
  const r = intentos.get(ip);
  if (!r || Date.now() - r.desde > config.login.ventanaMs) intentos.set(ip, { n: 1, desde: Date.now() });
  else r.n++;
}

async function registrarAcceso(id, accion) {
  try {
    await usuariosRepo.registrarAcceso(id, accion);
  } catch (err) {
    console.warn(`[auth] no se pudo registrar ${accion} en auditoría:`, err.message);
  }
}

async function abrirSesion(u, ip) {
  let permisos = [];
  try { permisos = await usuariosRepo.permisosDe(u.rol); } catch { /* sin permisos configurados */ }
  const usuario = { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, admin: esAdmin(u.rol), permisos };
  const token = crypto.randomBytes(32).toString('hex');
  sesionesRepo.guardar(token, usuario, Date.now() + config.sesion.duracionMs);
  intentos.delete(ip);
  await usuariosRepo.ingresoExitoso(u.id);
  await registrarAcceso(u.id, 'LOGIN');
  return { token, usuario };
}

/* ---------- casos de uso ---------- */

/*
 * Paso 1: correo y contraseña. Devuelve { token, usuario } o, si el usuario tiene
 * segundo factor, { desafio } para el paso 2 (iniciarConCodigo).
 */
async function iniciarSesion(email, password, ip) {
  if (bloqueado(ip)) throw errores.demasiadosIntentos('Demasiados intentos. Espere 15 minutos e intente de nuevo.');

  email = String(email || '').trim();
  password = String(password || '');
  if (!email || !password) throw errores.solicitudInvalida('Ingrese correo y contraseña.');

  const u = await usuariosRepo.buscarPorEmail(email);
  const hash = u?.password_hash || HASH_FALSO;
  let ok = false;
  if (ES_BCRYPT.test(hash)) ok = await bcrypt.compare(password, hash);
  else console.warn(`[auth] el usuario ${u.id} no tiene un hash bcrypt; restablezca su contraseña con "npm run crear-usuario".`);

  if (u?.bloqueado) throw errores.demasiadosIntentos('La cuenta está bloqueada por varios intentos fallidos. Espere 15 minutos o pida a un administrador que la desbloquee.');
  if (!u || !ok) {
    sumarIntento(ip);
    if (u) {
      const n = await usuariosRepo.registrarFallo(u.id, config.login.maxFallosUsuario, config.login.bloqueoMs);
      if (n >= config.login.maxFallosUsuario) throw errores.demasiadosIntentos('Demasiadas contraseñas incorrectas: la cuenta quedó bloqueada por 15 minutos.');
    }
    throw errores.noAutenticado('Correo o contraseña incorrectos.');
  }
  if (!u.activo) throw errores.sinPermiso('Usuario desactivado.');

  if (u.totp_activo) {
    const desafio = crypto.randomBytes(24).toString('base64url');
    desafios.set(desafio, { usuarioId: u.id, expira: Date.now() + config.login.desafioMs, intentos: 0 });
    return { desafio };
  }
  return abrirSesion(u, ip);
}

/* ---------- Segundo factor: paso 2 del ingreso ---------- */
const desafios = new Map();   // desafio -> { usuarioId, expira, intentos }

async function iniciarConCodigo(desafio, codigo, ip) {
  for (const [k, x] of desafios) if (x.expira < Date.now()) desafios.delete(k);
  const d = desafios.get(String(desafio || ''));
  if (!d) throw errores.noAutenticado('El ingreso venció. Escriba de nuevo su correo y contraseña.');
  const u = await usuariosRepo.porId(d.usuarioId);
  if (!u?.activo || !u.totp_activo) { desafios.delete(desafio); throw errores.noAutenticado('Escriba de nuevo su correo y contraseña.'); }
  let valido = false;
  try { valido = totp.verificar(totp.descifrar(u.totp_secreto, config.login.claveTotp), codigo); } catch (err) {
    console.error('[auth] no se pudo leer el segundo factor:', err.message);
    throw errores.sinBaseDatos('No se pudo verificar el código: revise TOTP_CLAVE en el servidor.');
  }
  if (!valido) {
    sumarIntento(ip);
    if (++d.intentos >= 5) { desafios.delete(desafio); throw errores.noAutenticado('Demasiados códigos incorrectos. Ingrese de nuevo.'); }
    throw errores.noAutenticado('Código incorrecto. Revise la hora de su teléfono y escriba el código actual.');
  }
  desafios.delete(desafio);
  return abrirSesion(u, ip);
}

/* ---------- Segundo factor: activar y desactivar (el propio usuario) ---------- */
const pendientes = new Map();   // usuarioId -> { secreto, expira }

function exigirClaveTotp() {
  if (!totp.claveValida(config.login.claveTotp)) {
    throw errores.conflicto('El servidor no tiene configurada TOTP_CLAVE: pida al administrador que la agregue al .env.');
  }
}

async function seguridad(usuario) {
  const u = await usuariosRepo.porId(usuario.id);
  return { totp_activo: !!u?.totp_activo, totp_disponible: totp.claveValida(config.login.claveTotp) };
}

async function iniciarTotp(usuario) {
  exigirClaveTotp();
  const secreto = totp.nuevoSecreto();
  pendientes.set(usuario.id, { secreto, expira: Date.now() + 10 * 60 * 1000 });
  return { secreto: secreto.match(/.{1,4}/g).join(' '), uri: totp.uri(usuario.email, secreto) };
}

async function activarTotp(usuario, codigo) {
  exigirClaveTotp();
  const p = pendientes.get(usuario.id);
  if (!p || p.expira < Date.now()) throw errores.conflicto('Vuelva a empezar la activación: el código de configuración venció.');
  if (!totp.verificar(p.secreto, codigo)) throw errores.solicitudInvalida('El código no coincide. Escriba el que muestra la aplicación ahora.');
  await usuariosRepo.guardarTotp(usuario.id, totp.cifrar(p.secreto, config.login.claveTotp));
  pendientes.delete(usuario.id);
  return { ok: true };
}

async function desactivarTotp(usuario, codigo) {
  const u = await usuariosRepo.porId(usuario.id);
  if (!u?.totp_activo) return { ok: true };
  exigirClaveTotp();
  if (!totp.verificar(totp.descifrar(u.totp_secreto, config.login.claveTotp), codigo)) throw errores.solicitudInvalida('El código no coincide.');
  await usuariosRepo.guardarTotp(usuario.id, null);
  return { ok: true };
}

/* ---------- Recuperar la contraseña del personal ---------- */
// El enlace lleva el id, el vencimiento y un trozo del hash actual: al cambiar la clave, los enlaces anteriores dejan de servir
const SECRETO_ENLACE = config.cliente.secreto || crypto.randomBytes(32).toString('hex');
const sellar = (texto) => crypto.createHmac('sha256', SECRETO_ENLACE).update('crm-clave:' + texto).digest('base64url');
const solicitudes = new Map();   // ip|correo -> { n, desde }

function limiteSolicitud(clave) {
  const r = solicitudes.get(clave);
  if (!r || Date.now() - r.desde > config.login.ventanaMs) { solicitudes.set(clave, { n: 1, desde: Date.now() }); return false; }
  return ++r.n > 5;
}

async function solicitarClave(email, ip) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw errores.solicitudInvalida('Ingrese su correo corporativo.');
  const respuesta = { ok: true, mensaje: 'Si el correo pertenece a un usuario activo, le enviamos un enlace para crear una nueva contraseña (vence en 30 minutos).' };
  if (limiteSolicitud('ip:' + ip) || limiteSolicitud('mail:' + email)) return respuesta;   // misma respuesta: no revela nada
  const u = await usuariosRepo.buscarPorEmail(email);
  if (!u?.activo) return respuesta;
  const datos = Buffer.from(JSON.stringify({ u: u.id, e: Date.now() + config.login.enlaceClaveMs, h: u.password_hash.slice(-12) })).toString('base64url');
  const url = `${config.appUrl}/crm?clave=${datos}.${sellar(datos)}`;
  await correo.enviar({
    para: u.email, asunto: 'Crear una nueva contraseña del CRM de Easy Office',
    texto: `Para crear una nueva contraseña del CRM entre aquí (vence en 30 minutos): ${url}. Si no lo pidió, ignore este correo.`,
    html: cuerpo(`${titulo('Nueva contraseña del CRM')}<p>Hola ${esc(u.nombre)}: recibimos un pedido para crear una nueva contraseña.</p>
      ${boton(url, 'Crear nueva contraseña')}<p style="font-size:13px;color:#666;">El enlace sirve una sola vez y vence en 30 minutos. Si no lo pidió usted, ignore este correo: su contraseña actual sigue igual.</p>${pie}`)
  });
  if (!config.correo.host) console.log(`[auth] Enlace de nueva contraseña para ${u.email} en ${url}`);
  return respuesta;
}

async function definirClave(token, password) {
  const [datos, sello] = String(token || '').split('.');
  const esperado = datos ? sellar(datos) : '';
  if (!datos || !sello || sello.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sello), Buffer.from(esperado))) {
    throw errores.noAutenticado('El enlace no es válido. Pida uno nuevo.');
  }
  const { u: id, e, h } = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
  if (e < Date.now()) throw errores.noAutenticado('El enlace venció. Pida uno nuevo.');
  password = String(password || '');
  if (password.length < MIN_CLAVE) throw errores.solicitudInvalida(`La contraseña debe tener al menos ${MIN_CLAVE} caracteres.`);
  const u = await usuariosRepo.porId(id);
  if (!u?.activo || u.password_hash.slice(-12) !== h || !sesionesRepo.consumirEnlace('crm:' + datos, e)) {
    throw errores.noAutenticado('Este enlace ya se usó. Pida uno nuevo.');
  }
  await usuariosRepo.cambiarClave(id, await bcrypt.hash(password, 12));
  return { ok: true, mensaje: 'Contraseña actualizada. Ingrese con su correo y la nueva contraseña.' };
}

async function cerrarSesion(token) {
  const s = token && sesionesRepo.obtener(token);
  if (!s) return;
  sesionesRepo.eliminar(token);
  await registrarAcceso(s.usuario.id, 'LOGOUT');
}

// Devuelve el usuario de una sesión vigente o null
function validarSesion(token) {
  const s = token && sesionesRepo.obtener(token);
  if (!s) return null;
  if (s.expira < Date.now()) {
    sesionesRepo.eliminar(token);
    return null;
  }
  return s.usuario;
}

module.exports = {
  iniciarSesion, iniciarConCodigo, cerrarSesion, validarSesion,
  seguridad, iniciarTotp, activarTotp, desactivarTotp, solicitarClave, definirClave
};
