/* =========================================================
   CAPA DE DATOS · Portal de clientes (/mi-cuenta).
   clientes y representantes_legales dicen quién está vinculado a cada
   cliente; cuentas_portal guarda la contraseña de cada persona vinculada
   y las personas autorizadas desde el CRM; registros_actividad, los
   ingresos y salidas del portal.
   ========================================================= */
const { consultaSistema } = require('../conexion');

/*
 * Clientes del tipo indicado a los que está vinculado un correo:
 *   natural  → el correo del cliente (clientes.email)
 *   juridica → el correo del representante legal o de una persona autorizada en el CRM
 * Con rut, solo ese cliente. Trae la cuenta del portal si ya existe (hash y estado).
 */
async function vinculos(email, tipo, rut = null) {
  const r = await consultaSistema(
    `WITH v AS (
       SELECT c.id AS cliente_id
         FROM clientes c
         LEFT JOIN representantes_legales r ON r.id = c.representante_legal_id
        WHERE (c.tipo_persona = 'natural'  AND c.email = $1::citext)
           OR (c.tipo_persona = 'juridica' AND r.email = $1::citext)
       UNION
       SELECT cliente_id FROM cuentas_portal WHERE email = $1::citext AND autorizado
     )
     SELECT c.id, c.tipo_persona, c.razon_social, fn_rut_formato(c.rut) AS rut_fmt,
            cp.id AS cuenta_id, cp.password_hash, COALESCE(cp.activo, true) AS activo
       FROM v
       JOIN clientes c ON c.id = v.cliente_id
       LEFT JOIN cuentas_portal cp ON cp.cliente_id = c.id AND cp.email = $1::citext
      WHERE c.tipo_persona = $2 AND ($3::text IS NULL OR c.rut = $3)
      ORDER BY c.razon_social`, [email, tipo, rut]);
  return r.rows;
}

// Correos de quienes pueden ingresar por un cliente (para avisarles de un documento o un ticket)
async function contactos(clienteId) {
  const r = await consultaSistema(
    `SELECT DISTINCT lower(x.email) AS email FROM (
       SELECT c.email FROM clientes c WHERE c.id = $1 AND c.tipo_persona = 'natural'
       UNION ALL
       SELECT r.email FROM clientes c JOIN representantes_legales r ON r.id = c.representante_legal_id
        WHERE c.id = $1 AND c.tipo_persona = 'juridica'
       UNION ALL
       SELECT cp.email FROM cuentas_portal cp WHERE cp.cliente_id = $1 AND cp.autorizado
     ) x
     WHERE x.email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM cuentas_portal b WHERE b.cliente_id = $1 AND b.email = x.email AND NOT b.activo)`, [clienteId]);
  return r.rows.map((x) => x.email);
}

// Crea la cuenta del portal o le cambia la contraseña
async function guardarClave(clienteId, email, hash) {
  await consultaSistema(
    `INSERT INTO cuentas_portal (cliente_id, email, password_hash, clave_definida_en)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (cliente_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, clave_definida_en = now()`,
    [clienteId, email, hash]);
}

async function marcarIngreso(clienteId, email) {
  await consultaSistema('UPDATE cuentas_portal SET ultimo_ingreso = now() WHERE cliente_id = $1 AND email = $2', [clienteId, email]);
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

module.exports = { vinculos, contactos, guardarClave, marcarIngreso, registrarAcceso };
