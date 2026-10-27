/* =========================================================
   npm run crear-usuario
   Crea un usuario del personal para el CRM, o le restablece la
   contraseña si el correo ya existe. La contraseña se escribe en la
   terminal (oculta) y se guarda solo como hash bcrypt.
   ========================================================= */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/datos/conexion');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let silencio = false;
rl._writeToOutput = function (s) {
  if (!silencio) rl.output.write(s);
  else if (s.includes('\n')) rl.output.write('\n');
};
const preguntar = (q) => new Promise((ok) => rl.question(q, (r) => ok(r.trim())));
async function preguntarOculto(q) {
  process.stdout.write(q);
  silencio = true;
  const r = await new Promise((ok) => rl.question('', ok));
  silencio = false;
  return r;
}

(async () => {
  try {
    let roles = (await pool.query('SELECT id, rol FROM roles ORDER BY id')).rows;
    if (!roles.length) {
      const r = await preguntar('La tabla roles está vacía. ¿Crear los roles "admin" y "ejecutivo"? (s/n) ');
      if (r.toLowerCase() !== 's') throw new Error('Sin roles no se puede crear un usuario.');
      await pool.query("INSERT INTO roles (rol) VALUES ('admin'), ('ejecutivo')");
      roles = (await pool.query('SELECT id, rol FROM roles ORDER BY id')).rows;
    }

    const email = (await preguntar('Correo del usuario: ')).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Correo inválido.');

    const existente = (await pool.query('SELECT id, nombre FROM usuarios WHERE email = $1', [email])).rows[0];
    let nombre = existente?.nombre;
    let rolId = null;

    if (existente) {
      const r = await preguntar(`Ya existe "${existente.nombre}". ¿Restablecer su contraseña? (s/n) `);
      if (r.toLowerCase() !== 's') throw new Error('Cancelado.');
    } else {
      nombre = await preguntar('Nombre completo: ');
      if (!nombre) throw new Error('El nombre es obligatorio.');
      console.log('Roles: ' + roles.map((x, i) => `${i + 1}) ${x.rol}`).join('   '));
      const i = Number(await preguntar('Número del rol: ')) - 1;
      if (!roles[i]) throw new Error('Rol inválido.');
      rolId = roles[i].id;
    }

    const p1 = await preguntarOculto('Contraseña (mínimo 10 caracteres): ');
    if (p1.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');
    const p2 = await preguntarOculto('Repita la contraseña: ');
    if (p1 !== p2) throw new Error('Las contraseñas no coinciden.');

    const hash = await bcrypt.hash(p1, 12);
    if (existente) {
      await pool.query('UPDATE usuarios SET password_hash = $1, activo = true WHERE id = $2', [hash, existente.id]);
      console.log(`\n✔ Contraseña restablecida para ${nombre} <${email}>.`);
    } else {
      const r = await pool.query(
        'INSERT INTO usuarios (nombre, email, rol_id, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [nombre, email, rolId, hash]);
      console.log(`\n✔ Usuario #${r.rows[0].id} creado: ${nombre} <${email}>.`);
    }
  } catch (err) {
    console.error('\n✘ ' + err.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await pool.end();
  }
})();
