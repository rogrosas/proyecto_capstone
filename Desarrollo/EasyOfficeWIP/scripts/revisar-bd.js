/* =========================================================
   npm run db:revisar
   Comprueba la conexión a PostgreSQL y que la base tenga lo que
   el CRM necesita. No modifica nada.
   ========================================================= */
const { pool } = require('../src/datos/conexion');

const ok = (t) => console.log('  ✔ ' + t);
const mal = (t) => console.log('  ✘ ' + t);
const info = (t) => console.log('    ' + t);

(async () => {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    console.log(`\nBase: ${u.pathname.slice(1)} en ${u.host} como ${decodeURIComponent(u.username)} (DATABASE_URL)\n`);
  } else console.log(`\nBase: ${process.env.PGDATABASE || '(sin PGDATABASE)'} en ${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432} como ${process.env.PGUSER || '(sin PGUSER)'}\n`);
  if (!process.env.PGPASSWORD && !process.env.DATABASE_URL) {
    mal('No hay contraseña: copie .env.example como .env y complete DATABASE_URL o PGPASSWORD.');
    process.exit(1);
  }

  try {
    const v = (await pool.query('SELECT version(), current_user, current_database()')).rows[0];
    ok(`Conectado a ${v.current_database} (${v.version.split(',')[0]})`);

    // 1. Permiso para adoptar rol_admin / rol_ejecutivo (necesario para la seguridad por fila)
    const r = (await pool.query(`
      SELECT rolsuper,
             pg_has_role(current_user, 'rol_admin', 'MEMBER')     AS admin,
             pg_has_role(current_user, 'rol_ejecutivo', 'MEMBER') AS ejecutivo
        FROM pg_roles WHERE rolname = current_user`)).rows[0];
    if (r.admin && r.ejecutivo) ok(`El usuario ${v.current_user} puede adoptar rol_admin y rol_ejecutivo${r.rolsuper ? ' (es superusuario)' : ''}`);
    else {
      mal(`El usuario ${v.current_user} no puede adoptar rol_admin / rol_ejecutivo.`);
      info(`Solución (en pgAdmin, Query Tool): GRANT rol_admin, rol_ejecutivo TO ${v.current_user};`);
    }

    // 2. Tablas del modelo
    const tablas = ['usuarios', 'roles', 'clientes', 'contratos', 'contrato_servicios', 'servicios',
      'documentos', 'pagos', 'alertas', 'sucursales', 'empresas_emisoras', 'registros_actividad',
      'tienda_familias', 'tienda_planes',    // si faltan: ejecutar easyoffice_v2_tienda.sql
      'archivos'];                           // si falta: ejecutar easyoffice_v2_archivos.sql
    console.log('\n  Registros por tabla:');
    for (const t of tablas) {
      try {
        const n = (await pool.query(`SELECT count(*) FROM ${t}`)).rows[0].count;
        info(`${t.padEnd(22)} ${n}`);
      } catch (e) {
        mal(`${t}: ${e.message}`);
      }
    }

    // 3. Migraciones de "base de datos/scripts" que le faltan a esta base (una base creada con
    //    easyoffice_v2.sql completo ya las tiene todas). Se reconocen por lo que crea cada una.
    const existe = async (sql) => Boolean((await pool.query(sql)).rows[0]?.ok);
    const tabla = (t) => `SELECT to_regclass('${t}') IS NOT NULL AS ok`;
    const columna = (t, c) => `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '${t}' AND column_name = '${c}') AS ok`;
    const funcion = (f) => `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '${f}') AS ok`;
    const MIGRACIONES = [
      ['easyoffice_v2_cuentas_portal.sql', 'contraseñas del portal de clientes', tabla('cuentas_portal')],
      ['easyoffice_v2_documentos_tienda.sql', 'documentos de la tienda y tickets', columna('documentos', 'estado_cliente')],
      ['easyoffice_v2_trl4.sql', 'avisos, firma electrónica y verificación', tabla('documento_firmantes')],
      ['easyoffice_v2_tickets_conversacion.sql', 'tickets como conversación', tabla('ticket_mensajes')],
      ['easyoffice_v2_comunas_permisos.sql', '346 comunas y permisos de tickets', funcion('fn_cliente_con_ticket')],
      ['easyoffice_v2_cartera.sql', 'ejecutivo a cargo de cada cliente', columna('clientes', 'ejecutivo_id')],
      ['easyoffice_v2_tienda.sql', 'servicios y planes de la tienda (CRM → Tienda)', tabla('tienda_planes')],
      ['easyoffice_v2_archivos.sql', 'Word y PDF guardados en la base', tabla('archivos')]
    ];
    const faltan = [];
    for (const [archivo, que, sql] of MIGRACIONES) if (!(await existe(sql))) faltan.push([archivo, que]);
    console.log('');
    if (!faltan.length) ok('La base tiene todas las migraciones.');
    else {
      mal(`Faltan ${faltan.length} migración(es). Ejecútelas en este orden (npm run db:migrar -- <archivo>, o en el SQL Editor de Neon):`);
      faltan.forEach(([archivo, que]) => info(`${archivo.padEnd(40)} ${que}`));
    }

    // 4. Roles y usuarios del CRM
    const roles = (await pool.query('SELECT id, rol FROM roles ORDER BY id')).rows;
    console.log('');
    if (!roles.length) mal('La tabla roles está vacía: "npm run crear-usuario" ofrece crear admin y ejecutivo.');
    else {
      ok('Roles: ' + roles.map((x) => `${x.rol} (id ${x.id})`).join(', '));
      const admins = roles.filter((x) => ['admin', 'dueno'].includes(x.rol.toLowerCase()));
      if (!admins.length) info('Ningún rol se llama "admin" o "dueno": la BD (app_es_admin) no dará vista completa a nadie.');
    }

    const us = (await pool.query(`
      SELECT u.id, u.nombre, u.email, u.activo, r.rol,
             CASE WHEN u.password_hash ~ '^\\$2[aby]\\$' THEN 'bcrypt' ELSE 'otro formato' END AS hash
        FROM usuarios u JOIN roles r ON r.id = u.rol_id ORDER BY u.id`)).rows;
    if (!us.length) mal('No hay usuarios del personal: cree uno con "npm run crear-usuario".');
    else {
      ok(`${us.length} usuario(s) del personal:`);
      us.forEach((u) => info(`#${u.id} ${u.nombre} <${u.email}> · ${u.rol} · ${u.activo ? 'activo' : 'inactivo'} · contraseña ${u.hash}`));
      if (us.some((u) => u.hash !== 'bcrypt')) info('Los usuarios con "otro formato" no podrán ingresar: restablezca su contraseña con "npm run crear-usuario".');
    }
    console.log('');
  } catch (err) {
    mal('No se pudo conectar: ' + err.message);
    if (err.code === '28P01') info('Contraseña o usuario incorrectos en .env.');
    if (err.code === '3D000') info('La base indicada en PGDATABASE no existe (en pgAdmin se llama EO_ER).');
    if (err.code === 'ECONNREFUSED') info('PostgreSQL no está escuchando en ese host/puerto.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
