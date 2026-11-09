/* =========================================================
   npm run db:cargar            (esquema + datos de muestra)
   npm run db:cargar -- --vacia (solo el esquema)

   Carga la base en la nube (Neon, Supabase…) indicada en DATABASE_URL con
   los scripts de "base de datos/scripts", sin necesidad de pgAdmin ni psql.
   - Solo trabaja sobre DATABASE_URL: nunca toca la base local EO_ER.
   - Se niega a seguir si la base ya tiene las tablas (no borra nada).
   - Al final le da al usuario de conexión los roles rol_admin, rol_ejecutivo y
     rol_portal, que la aplicación adopta en cada transacción (en la nube ese
     usuario no es superusuario, así que necesita ser miembro).
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'base de datos', 'scripts');
const scripts = ['easyoffice_v2.sql'];
if (!process.argv.includes('--vacia')) scripts.push('easyoffice_v2_datos_muestra.sql');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL en .env (la cadena de conexión que entrega Neon).');
    process.exit(1);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  db.on('notice', () => {});
  await db.connect();
  try {
    const u = (await db.query('SELECT current_user, current_database()')).rows[0];
    console.log(`\nBase ${u.current_database} como ${u.current_user}\n`);

    if ((await db.query("SELECT to_regclass('public.clientes') AS t")).rows[0].t) {
      console.error('La base ya tiene las tablas de Easy Office: no se cargó nada.');
      console.error('Para empezar de cero, cree una base nueva en el panel de Neon (o bórrela y vuelva a crearla).');
      process.exitCode = 1;
      return;
    }

    for (const s of scripts) {
      process.stdout.write(`  Ejecutando ${s}… `);
      await db.query(fs.readFileSync(path.join(SCRIPTS_DIR, s), 'utf8'));
      console.log('listo');
    }

    await db.query(`GRANT rol_admin, rol_ejecutivo, rol_portal TO "${u.current_user.replace(/"/g, '""')}"`);
    console.log(`  ${u.current_user} puede adoptar rol_admin, rol_ejecutivo y rol_portal`);
    console.log('\nSiguiente paso: npm run crear-usuario  (usuario del CRM para entrar a /crm)\n');
  } catch (err) {
    console.error('\nError:', err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
