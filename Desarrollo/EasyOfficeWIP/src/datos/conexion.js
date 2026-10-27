/* =========================================================
   CAPA DE DATOS · Conexión a PostgreSQL (base EO_ER)

   conUsuario(): abre una transacción, adopta el rol de base de datos
   del usuario (rol_admin o rol_ejecutivo) y fija app.usuario_actual /
   app.rol_actual. Así PostgreSQL aplica la seguridad por fila y la
   auditoría definidas en easyoffice_er.sql.

   consultaSistema(): consulta con el usuario de conexión, solo para el
   inicio de sesión y el registro de accesos.
   ========================================================= */
const { Pool, types } = require('pg');

// Las columnas date se entregan como texto 'YYYY-MM-DD' (sin conversión a hora local)
types.setTypeParser(1082, (v) => v);
const config = require('../config');
const { AppError, errores } = require('../comun/errores');

const pool = new Pool({ max: config.bd.maxConexiones, idleTimeoutMillis: config.bd.inactividadMs });
pool.on('error', (err) => console.error('[bd] error en conexión inactiva:', err.message));

// Traduce los códigos de error de PostgreSQL a errores de la aplicación
// https://www.postgresql.org/docs/current/errcodes-appendix.html
function traducir(err) {
  if (err instanceof AppError) return err;
  // Fallas de conexión: clase 08 de PostgreSQL, errores de red o de autenticación del driver
  if (/^08/.test(err.code || '') || /^SASL|password/i.test(err.message || '')) {
    console.error('[bd] sin conexión:', err.message);
    return errores.sinBaseDatos();
  }
  switch (err.code) {
    case '42501': return errores.sinPermiso();
    case '23503':
      // Borrar algo referido ("update or delete on…") o referir algo que no existe ("insert or update on…").
      // El texto sale en el idioma del servidor: PostgreSQL en español dice "update o delete en…".
      return /^update (or|o) delete/i.test(err.message)
        ? errores.conflicto('No se puede eliminar: el registro tiene datos asociados (contratos, documentos, pagos u otros).')
        : errores.solicitudInvalida('Se hace referencia a un registro que no existe (revise la comuna, cliente, servicio u otra selección).');
    case '23505': return errores.conflicto('Ya existe un registro con esos datos.');
    case '23502': return errores.solicitudInvalida(`Falta un dato obligatorio (${err.column || 'campo requerido'}).`);
    case '23514': return errores.solicitudInvalida('Los datos no cumplen las reglas de la base de datos (por ejemplo, RUT inválido).');
    case '22P02':
    case '22023': return errores.solicitudInvalida();
    case '28P01':
    case '3D000':
    case 'ECONNREFUSED': return errores.sinBaseDatos();
    default:
      console.error('[bd]', err.code || '', err.message);
      return new AppError(500, 'Error al consultar la base de datos.');
  }
}

/**
 * Ejecuta fn(db) en una transacción con la identidad del usuario.
 * usuario = { id, rol, admin }
 */
async function conUsuario(usuario, fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    throw traducir(err);
  }
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.usuario_actual', $1, true), set_config('app.rol_actual', $2, true)",
      [String(usuario.id), String(usuario.rol).toLowerCase()]);
    // Literal fijo: nunca se arma con datos del usuario
    await client.query(usuario.admin ? 'SET LOCAL ROLE rol_admin' : 'SET LOCAL ROLE rol_ejecutivo');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw traducir(err);
  } finally {
    client.release();
  }
}

/**
 * Transacción del portal de clientes: SOLO LECTURA.
 * Los clientes no son usuarios del personal, así que las políticas RLS (pensadas para
 * ejecutivos) no los representan. La restricción se garantiza así:
 *   - la transacción es READ ONLY: el portal no puede escribir nada;
 *   - cada consulta de los repositorios filtra por cliente_id, que la capa de negocio
 *     toma de la sesión (nunca de la petición).
 */
async function conCliente(fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    throw traducir(err);
  }
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('app.usuario_actual', '', true), set_config('app.rol_actual', 'admin', true)");
    await client.query('SET LOCAL ROLE rol_admin');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw traducir(err);
  } finally {
    client.release();
  }
}

/**
 * Transacción del sistema, sin usuario del personal: la compra en la tienda y las acciones
 * del cliente en el portal que escriben (aceptar un documento, enviar un ticket).
 * Corre con el usuario de conexión; las capas de arriba filtran siempre por el cliente.
 * app_usuario() queda vacío: registrado_por y ejecutivo_id quedan NULL (origen web).
 */
async function conSistema(fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    throw traducir(err);
  }
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.usuario_actual', '', true), set_config('app.rol_actual', '', true)");
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw traducir(err);
  } finally {
    client.release();
  }
}

async function consultaSistema(sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    throw traducir(err);
  }
}

module.exports = { pool, conUsuario, conCliente, conSistema, consultaSistema };
