/* =========================================================
   CAPA DE DATOS · Portal de clientes (/mi-cuenta).
   Usa solo tablas existentes: clientes (email como identificador del
   acceso) y registros_actividad (ingresos y salidas del portal).
   ========================================================= */
const { consultaSistema } = require('../conexion');

// Clientes con ese correo (un mismo correo puede corresponder a varias empresas o personas)
async function clientesPorEmail(email) {
  const r = await consultaSistema(
    `SELECT id, razon_social, fn_rut_formato(rut) AS rut_fmt, email
       FROM clientes WHERE email = $1 ORDER BY razon_social`, [email]);
  return r.rows;
}

// Datos mínimos para validar que el cliente sigue existiendo con ese correo
async function clientePorId(id) {
  const r = await consultaSistema(
    'SELECT id, razon_social, fn_rut_formato(rut) AS rut_fmt, email FROM clientes WHERE id = $1', [id]);
  return r.rows[0] || null;
}

/*
 * Ingreso o salida de un cliente en el portal. usuario_id va NULL porque el cliente
 * no es usuario del personal; tabla_afectada = 'clientes' y registro_id = su id
 * lo identifican en la auditoría.
 */
async function registrarAcceso(clienteId, accion) {
  await consultaSistema(
    "INSERT INTO registros_actividad (usuario_id, tabla_afectada, registro_id, accion) VALUES (NULL, 'clientes', $1, $2)",
    [String(clienteId), accion]);
}

module.exports = { clientesPorEmail, clientePorId, registrarAcceso };
