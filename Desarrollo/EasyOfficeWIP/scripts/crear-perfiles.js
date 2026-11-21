/* =========================================================
   npm run crear-perfiles            (agregue -- --restablecer para cambiar las contraseñas)
   Crea tres perfiles de prueba listos para ingresar:
     1. Dueño      → usuario del CRM con rol "dueno" (todos los permisos)
     2. Ejecutivo  → usuario del CRM con rol "ejecutivo"
     3. Persona natural → cliente tipo "natural" con acceso a /mi-cuenta,
                          a cargo del ejecutivo anterior

   - Es idempotente: si un perfil ya existe lo deja como está
     (con --restablecer le genera una contraseña nueva y lo reactiva).
   - Las contraseñas se generan al azar, se guardan solo como hash bcrypt
     y se muestran una vez en la terminal; además se anotan al final de
     credenciales-demo.txt (ignorado por git).
   - Los datos de cada perfil se cambian en PERFILES, más abajo.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/datos/conexion');

const PERFILES = {
  dueno:     { nombre: 'Perfil Dueño',     email: 'perfil.dueno@easyoffice.test',     rol: 'dueno' },
  ejecutivo: { nombre: 'Perfil Ejecutivo', email: 'perfil.ejecutivo@easyoffice.test', rol: 'ejecutivo' },
  persona: {
    rutCuerpo: '17345678',                    // el dígito verificador se calcula solo
    nombre: 'PERFIL PERSONA NATURAL',         // razon_social de una persona natural = nombre completo
    email: 'perfil.persona@easyoffice.test',
    celular: '912345678',
    giro: 'SERVICIOS PROFESIONALES'
  }
};

const restablecer = process.argv.includes('--restablecer');
const ARCHIVO_CREDENCIALES = path.join(__dirname, '..', 'credenciales-demo.txt');

// Dígito verificador del RUT chileno (módulo 11), igual que fn_rut_valido()
function rutCompleto(cuerpo) {
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  return `${cuerpo}-${resto === 11 ? '0' : resto === 10 ? 'K' : resto}`;
}

// 14 caracteres sin símbolos ambiguos (0/O, 1/l/I)
function generarClave() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(14), (b) => abc[b % abc.length]).join('');
}

async function rolId(db, rol) {
  const r = await db.query('SELECT id FROM roles WHERE rol = $1', [rol]);
  if (!r.rows[0]) throw new Error(`No existe el rol "${rol}" en la tabla roles. Cargue primero easyoffice_v2.sql.`);
  return r.rows[0].id;
}

/** Crea el usuario del CRM o lo deja/restablece. Devuelve { id, clave|null, estado } */
async function asegurarUsuario(db, p) {
  const idRol = await rolId(db, p.rol);
  const existente = (await db.query('SELECT id FROM usuarios WHERE email = $1', [p.email])).rows[0];
  if (existente && !restablecer) return { id: existente.id, clave: null, estado: 'ya existía' };

  const clave = generarClave();
  const hash = await bcrypt.hash(clave, 12);
  if (existente) {
    await db.query(
      `UPDATE usuarios SET password_hash = $1, rol_id = $2, activo = true,
              intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $3`,
      [hash, idRol, existente.id]);
    return { id: existente.id, clave, estado: 'contraseña restablecida' };
  }
  const r = await db.query(
    'INSERT INTO usuarios (nombre, email, rol_id, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [p.nombre, p.email, idRol, hash]);
  return { id: r.rows[0].id, clave, estado: 'creado' };
}

/** Cliente persona natural + su cuenta del portal */
async function asegurarPersona(db, p, registradoPor, ejecutivoId) {
  const rut = rutCompleto(p.rutCuerpo);
  let cliente = (await db.query('SELECT id, tipo_persona, email FROM clientes WHERE rut = $1', [rut])).rows[0];
  let estado = 'ya existía';

  if (cliente && cliente.tipo_persona !== 'natural') {
    throw new Error(`El RUT ${rut} ya es de un cliente persona jurídica. Cambie PERFILES.persona.rutCuerpo.`);
  }
  if (!cliente) {
    cliente = (await db.query(
      `INSERT INTO clientes (rut, tipo_persona, razon_social, giro_principal, email, celular,
                             origen, registrado_por)
       VALUES ($1, 'natural', $2, $3, $4, $5, 'crm', $6) RETURNING id, email`,
      [rut, p.nombre, p.giro, p.email, p.celular, registradoPor])).rows[0];
    estado = 'creado';
    // Ejecutivo a cargo: la columna existe desde easyoffice_v2_cartera.sql
    const conCartera = (await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'clientes' AND column_name = 'ejecutivo_id'`)).rowCount;
    if (conCartera) await db.query('UPDATE clientes SET ejecutivo_id = $1 WHERE id = $2', [ejecutivoId, cliente.id]);
    else console.warn('Aviso: falta easyoffice_v2_cartera.sql (clientes.ejecutivo_id); el cliente no queda a cargo del ejecutivo.');
  }

  // La persona natural entra con el correo del cliente (clientes.email)
  const email = cliente.email || p.email;
  const cuenta = (await db.query(
    'SELECT password_hash IS NOT NULL AS con_clave FROM cuentas_portal WHERE cliente_id = $1 AND email = $2',
    [cliente.id, email])).rows[0];
  if (cuenta?.con_clave && !restablecer) return { id: cliente.id, rut, email, clave: null, estado };

  const clave = generarClave();
  const hash = await bcrypt.hash(clave, 12);
  await db.query(
    `INSERT INTO cuentas_portal (cliente_id, email, password_hash, clave_definida_en, activo, registrado_por)
     VALUES ($1, $2, $3, now(), true, $4)
     ON CONFLICT (cliente_id, email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash, clave_definida_en = now(), activo = true`,
    [cliente.id, email, hash, registradoPor]);
  return { id: cliente.id, rut, email, clave, estado: estado === 'creado' ? 'creado' : 'contraseña restablecida' };
}

(async () => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const dueno = await asegurarUsuario(db, PERFILES.dueno);
    // La auditoría y los valores por defecto (registrado_por) quedan a nombre del dueño
    await db.query("SELECT set_config('app.usuario_actual', $1, true), set_config('app.rol_actual', 'dueno', true)",
      [String(dueno.id)]);
    const ejecutivo = await asegurarUsuario(db, PERFILES.ejecutivo);
    const persona = await asegurarPersona(db, PERFILES.persona, dueno.id, ejecutivo.id);
    await db.query('COMMIT');

    const linea = (titulo, ruta, datos, r) =>
      `${titulo} -> ${ruta}\n${datos}\n  Contraseña: ${r.clave ?? '(sin cambios; use --restablecer para generar una nueva)'}\n`;
    const resumen = [
      linea(`Dueño (rol dueno) · ${dueno.estado}`, '/crm',
        `  Correo:     ${PERFILES.dueno.email}`, dueno),
      linea(`Ejecutivo (rol ejecutivo) · ${ejecutivo.estado}`, '/crm',
        `  Correo:     ${PERFILES.ejecutivo.email}`, ejecutivo),
      linea(`Persona natural · ${persona.estado}`, '/mi-cuenta  (elegir "Persona")',
        `  Cliente:    ${PERFILES.persona.nombre} (RUT ${persona.rut}), a cargo de ${PERFILES.ejecutivo.nombre}\n` +
        `  Correo:     ${persona.email}`, persona)
    ].join('\n');

    console.log('\n' + resumen);
    if ([dueno, ejecutivo, persona].some((r) => r.clave)) {
      fs.appendFileSync(ARCHIVO_CREDENCIALES,
        `\n--- Perfiles de prueba (npm run crear-perfiles, ${new Date().toISOString().slice(0, 10)}) ---\n${resumen}`);
      console.log(`Las contraseñas nuevas quedaron anotadas en ${path.basename(ARCHIVO_CREDENCIALES)} (no se sube a git).`);
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('\n✘ ' + err.message);
    process.exitCode = 1;
  } finally {
    db.release();
    await pool.end();
  }
})();
