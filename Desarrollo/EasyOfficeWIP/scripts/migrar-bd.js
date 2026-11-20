/* =========================================================
   npm run db:migrar -- <archivo.sql>
   Ejecuta una migración de "base de datos/scripts" sobre la base que usa la
   aplicación: DATABASE_URL (Neon) si está en .env, o si no la local (PG*).
   Sirve cuando no hay pgAdmin (por ejemplo, la base de Neon).
   - Solo acepta archivos de esa carpeta (sin rutas).
   - Cada migración trae su propio BEGIN/COMMIT: si algo falla, no queda nada a medias.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'base de datos', 'scripts');
const archivo = process.argv[2];

(async () => {
  const disponibles = fs.readdirSync(SCRIPTS_DIR).filter((f) => /^easyoffice_v2_.+\.sql$/.test(f));
  if (!archivo || !disponibles.includes(archivo)) {
    console.error('Uso: npm run db:migrar -- <archivo.sql>\nMigraciones disponibles:\n' + disponibles.map((f) => '  ' + f).join('\n'));
    process.exit(1);
  }
  const db = new Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  db.on('notice', () => {});
  await db.connect();
  try {
    const u = (await db.query('SELECT current_user, current_database(), inet_server_addr() AS host')).rows[0];
    console.log(`\nBase ${u.current_database} como ${u.current_user} (${process.env.DATABASE_URL ? 'DATABASE_URL' : 'base local'})`);
    process.stdout.write(`  Ejecutando ${archivo}… `);
    await db.query(fs.readFileSync(path.join(SCRIPTS_DIR, archivo), 'utf8'));
    console.log('listo\n');
  } catch (err) {
    console.error('\nError:', err.message, '\n(No se aplicó nada: la migración corre en una transacción.)');
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
