/* =========================================================
   PRUEBAS · Entorno de laboratorio para las pruebas automáticas.

   Cada archivo de pruebas arma su propio ambiente aislado:
   - una base NUEVA (eo_prueba_<proceso>_<hora>) creada con los scripts de
     "base de datos" (easyoffice_v2.sql + datos de muestra): nunca toca EO_ER;
   - la aplicación en un puerto libre, con carpetas temporales para los
     contratos Word y los correos;
   - usuarios de prueba con contraseñas aleatorias.
   Al terminar se borran la base y las carpetas.

   Necesita en .env (o en el entorno) los datos de conexión de PostgreSQL:
   PGHOST, PGPORT, PGUSER y PGPASSWORD de un usuario que pueda crear bases.
   ========================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const BD_DIR = path.resolve(__dirname, '..', '..', '..', 'base de datos');
const SCRIPTS = ['easyoffice_v2.sql', 'easyoffice_v2_datos_muestra.sql'];
const PREFIJO = 'eo_prueba_';

let estado = null;

const clave = () => crypto.randomBytes(9).toString('base64url') + 'a1';

async function crearBase() {
  const nombre = `${PREFIJO}${process.pid}_${Date.now().toString(36)}`;
  const admin = new Client({ database: 'postgres' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nombre}`);
  await admin.end();

  const db = new Client({ database: nombre });
  await db.connect();
  // Silencia los NOTICE de los scripts
  db.on('notice', () => {});
  for (const s of SCRIPTS) await db.query(fs.readFileSync(path.join(BD_DIR, s), 'utf8'));

  const cred = { admin: ['diego.munoz@easyoffice.cl', clave()], ejec: ['ejecutiva.prueba@easyoffice.test', clave()] };
  await db.query('UPDATE usuarios SET password_hash = $1 WHERE email = $2', [bcrypt.hashSync(cred.admin[1], 4), cred.admin[0]]);
  await db.query(`INSERT INTO usuarios (nombre, email, rol_id, password_hash)
    SELECT 'Ejecutiva Prueba', $1, id, $2 FROM roles WHERE rol = 'ejecutivo'`, [cred.ejec[0], bcrypt.hashSync(cred.ejec[1], 4)]);
  await db.end();
  return { nombre, cred };
}

async function borrarBase(nombre) {
  if (!nombre?.startsWith(PREFIJO)) return;   // nunca borra otra base
  const admin = new Client({ database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
  await admin.end();
}

/** Arma el ambiente y levanta la aplicación. Devuelve { url, cred, sesion, correos, sql }. */
async function iniciar() {
  const { nombre, cred } = await crearBase();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-prueba-'));
  const contratos = path.join(tmp, 'contratos');
  const correos = path.join(tmp, 'correos');
  fs.mkdirSync(contratos);
  // Las plantillas Word de la carpeta real se copian: la aplicación escribe en la copia
  for (const f of fs.readdirSync(path.join(BD_DIR, 'Contratos'))) {
    if (f.toLowerCase().endsWith('.docx')) fs.copyFileSync(path.join(BD_DIR, 'Contratos', f), path.join(contratos, f));
  }

  // La configuración se lee al cargar los módulos: el entorno va antes del require
  Object.assign(process.env, {
    PGDATABASE: nombre, CONTRATOS_DIR: contratos, CORREOS_DIR: correos,
    CLIENTE_SECRETO: crypto.randomBytes(32).toString('hex'),
    SMTP_HOST: '', FIRMA_PROVEEDOR: 'simulador', PAGO_PROVEEDOR: 'simulador', AVISOS_AUTOMATICOS: 'no',
    TOTP_CLAVE: crypto.randomBytes(32).toString('hex')
  });
  const silencio = console.log;
  console.log = () => {};   // los avisos de correo en desarrollo ensucian la salida de las pruebas
  const app = require('../../src/app');
  const servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const url = `http://localhost:${servidor.address().port}`;

  estado = { nombre, tmp, servidor, silencio };
  return { url, cred, dirContratos: contratos, sesion: (opciones) => sesion(url, opciones), correos: (para) => leerCorreos(correos, para), sql };
}

async function terminar() {
  if (!estado) return;
  const { nombre, tmp, servidor, silencio } = estado;
  estado = null;
  await new Promise((ok) => servidor.close(ok));
  servidor.closeAllConnections?.();
  await require('../../src/datos/conexion').pool.end();
  try { require('../../src/negocio/servicios/avisos.servicio').detener(); } catch { /* sin avisos */ }
  console.log = silencio;
  await borrarBase(nombre);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- Cliente HTTP con cookie de sesión ---------- */
function sesion(base, { ip } = {}) {
  let cookie = '';
  return async (metodo, ruta, datos, { crudo = false, cabeceras = {} } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', cookie, ...(ip ? { 'X-Forwarded-For': ip } : {}), ...cabeceras },
      body: datos === undefined ? undefined : JSON.stringify(datos)
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (crudo) {
      const b = Buffer.from(await r.arrayBuffer());
      return { status: r.status, cabeceras: r.headers, tipo: r.headers.get('content-type'), texto: b.toString('utf8'), largo: b.length, buffer: b };
    }
    const cuerpo = await r.json().catch(() => ({}));
    return { status: r.status, ...cuerpo, cuerpo, cabeceras: r.headers };
  };
}

/* ---------- Correos de desarrollo ---------- */
function leerCorreos(carpeta, para) {
  if (!fs.existsSync(carpeta)) return [];
  return fs.readdirSync(carpeta).filter((f) => f.endsWith('.html')).sort()
    .map((f) => fs.readFileSync(path.join(carpeta, f), 'utf8'))
    .filter((h) => !para || h.startsWith(`<!-- Para: ${para} |`))
    .map((html) => ({
      html,
      asunto: (html.match(/\| Asunto: (.*?)( \| Adjuntos|\s-->)/) || [])[1],
      enlace: (html.match(/href="([^"]*clave=[^"]+)"/) || [])[1]?.replace(/&amp;/g, '&'),
      token: (html.match(/clave=([A-Za-z0-9_.\-]+)/) || [])[1],
      adjuntos: ((html.match(/\| Adjuntos: (.*?) -->/) || [])[1] || '').split(', ').filter(Boolean).map((n) => path.join(carpeta, n))
    }));
}

/* ---------- Consultas directas a la base de prueba (superusuario, sin RLS) ---------- */
async function sql(texto, params) {
  const db = new Client({ database: process.env.PGDATABASE });
  await db.connect();
  try { return (await db.query(texto, params)).rows; } finally { await db.end(); }
}

module.exports = { iniciar, terminar, sql };

/* ---------- Pasos de un flujo: cada paso es una prueba; se ejecutan en orden y comparten resultados ---------- */
// const emp = paso('crear empresa', () => A('POST', ...));  → emp.id está disponible en los pasos siguientes
function pasos(it, assert) {
  return (nombre, fn, esperado = (r) => r.status < 300) => {
    const caja = {};
    it(nombre, async () => {
      const r = await fn();
      Object.assign(caja, r);
      assert.ok(esperado(r), `${r.status} ${r.error || JSON.stringify(r.cuerpo ?? r).slice(0, 300)}`);
    });
    return caja;
  };
}

module.exports.pasos = pasos;

/* ---------- Compra en la tienda pasando por la pasarela simulada ---------- */
// Compra y aprueba el pago: devuelve el resultado final (documentos, cuenta) con el status de la compra
async function comprarYPagar(T, datos) {
  const r = await T('POST', '/api/tienda/compras', datos);
  if (!r.pago?.url) return r;
  const token = new URL(r.pago.url, 'http://x').searchParams.get('t');
  const p = await T('POST', `/api/tienda/pago/${token}`, { accion: 'aprobar' });
  return { ...p, status: p.status === 200 ? r.status : p.status, token };
}

module.exports.comprarYPagar = comprarYPagar;
