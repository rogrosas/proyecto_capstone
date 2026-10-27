/* =========================================================
   CAPA DE NEGOCIO · Autenticación del personal.
   Reglas: contraseña bcrypt, usuario activo, límite de intentos por IP,
   sesión con vencimiento y registro de LOGIN / LOGOUT en auditoría.
   ========================================================= */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const { errores } = require('../../comun/errores');
const { esAdmin } = require('../roles');
const usuariosRepo = require('../../datos/repositorios/usuarios.repositorio');
const sesionesRepo = require('../../datos/repositorios/sesiones.repositorio');

// Hash de relleno: un correo inexistente tarda lo mismo que uno válido
const HASH_FALSO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
const ES_BCRYPT = /^\$2[aby]\$/;

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

/* ---------- casos de uso ---------- */

// Devuelve { token, usuario } o lanza AppError
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

  if (!u || !ok) {
    sumarIntento(ip);
    throw errores.noAutenticado('Correo o contraseña incorrectos.');
  }
  if (!u.activo) throw errores.sinPermiso('Usuario desactivado.');

  let permisos = [];
  try { permisos = await usuariosRepo.permisosDe(u.rol); } catch { /* sin permisos configurados */ }
  const usuario = { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, admin: esAdmin(u.rol), permisos };
  const token = crypto.randomBytes(32).toString('hex');
  sesionesRepo.guardar(token, usuario, Date.now() + config.sesion.duracionMs);
  intentos.delete(ip);
  await registrarAcceso(u.id, 'LOGIN');
  return { token, usuario };
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

module.exports = { iniciarSesion, cerrarSesion, validarSesion };
