/* =========================================================
   CAPA DE PRESENTACIÓN · Cookies de sesión.
   Dos cookies separadas, cada una restringida a su ruta de API:
   personal (eo_crm → /api/crm) y clientes (eo_cli → /api/cliente).
   ========================================================= */
const config = require('../../config');

function leer(req, nombre) {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

function escribir(res, { cookie, ruta }, token, maxAgeMs) {
  const seguro = config.produccion ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${cookie}=${token}; HttpOnly; SameSite=Strict; Path=${ruta}; Max-Age=${Math.floor(maxAgeMs / 1000)}${seguro}`);
}

// Personal del CRM
const leerSesion = (req) => leer(req, config.sesion.cookie);
const escribirSesion = (res, token, maxAgeMs) => escribir(res, config.sesion, token, maxAgeMs);
const borrarSesion = (res) => escribir(res, config.sesion, '', 0);

// Clientes del portal
const leerSesionCliente = (req) => leer(req, config.cliente.cookie);
const escribirSesionCliente = (res, token, maxAgeMs) => escribir(res, config.cliente, token, maxAgeMs);
const borrarSesionCliente = (res) => escribir(res, config.cliente, '', 0);

module.exports = { leerSesion, escribirSesion, borrarSesion, leerSesionCliente, escribirSesionCliente, borrarSesionCliente };
