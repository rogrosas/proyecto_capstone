/* Pruebas de la base de datos (TT-02): reglas CHECK, seguridad por fila, auditoría inmutable y disparadores. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const entorno = require('../apoyo/entorno');

let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

// Ejecuta fn(db) como lo hace la aplicación: rol de base de datos + usuario actual. Siempre deshace los cambios.
async function como(rol, usuarioId, fn) {
  const db = new Client({ database: process.env.PGDATABASE });
  await db.connect();
  db.on('notice', () => {});
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.usuario_actual', $1, true), set_config('app.rol_actual', $2, true)",
      [String(usuarioId ?? ''), rol === 'rol_admin' ? 'admin' : 'ejecutivo']);
    if (rol) await db.query(`SET LOCAL ROLE ${rol}`);
    return await fn(db);
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
}
const idDe = async (email) => (await entorno.sql('SELECT id FROM usuarios WHERE email = $1', [email]))[0].id;
const rechaza = (promesa, patron) => assert.rejects(promesa, patron);

describe('reglas de la base de datos', () => {
  it('rechaza un RUT con dígito verificador incorrecto', async () => {
    const admin = await idDe(ctx.cred.admin[0]);
    await como('rol_admin', admin, (db) => rechaza(
      db.query("INSERT INTO clientes (rut, tipo_persona, razon_social) VALUES ('11111111-2', 'natural', 'X')"), /check|viola|violates/i));
  });

  it('una empresa necesita representante legal', async () => {
    const admin = await idDe(ctx.cred.admin[0]);
    await como('rol_admin', admin, (db) => rechaza(
      db.query("INSERT INTO clientes (rut, tipo_persona, razon_social) VALUES ('77123456-9', 'juridica', 'SIN REP SpA')"), /ck_clientes_juridica_con_representante/));
  });

  it('un documento con revisión no se aprueba sin revisor', async () => {
    const admin = await idDe(ctx.cred.admin[0]);
    await como('rol_admin', admin, async (db) => {
      const c = (await db.query('SELECT id FROM clientes LIMIT 1')).rows[0];
      const d = (await db.query("INSERT INTO documentos (cliente_id, tipo, requiere_revision) VALUES ($1, 'PRUEBA', true) RETURNING id", [c.id])).rows[0];
      await rechaza(db.query("UPDATE documentos SET estado = 'aprobado' WHERE id = $1", [d.id]), /check|viola|violates/i);
    });
  });

  it('un documento firmado necesita fecha de firma y código con formato EO-XXXX-XXXX', async () => {
    const admin = await idDe(ctx.cred.admin[0]);
    await como('rol_admin', admin, async (db) => {
      const c = (await db.query('SELECT id FROM clientes LIMIT 1')).rows[0];
      const d = (await db.query("INSERT INTO documentos (cliente_id, tipo, requiere_revision) VALUES ($1, 'PRUEBA', false) RETURNING id", [c.id])).rows[0];
      await db.query('SAVEPOINT a');
      await rechaza(db.query("UPDATE documentos SET estado = 'firmado' WHERE id = $1", [d.id]), /check|viola|violates/i);
      await db.query('ROLLBACK TO a');
      await rechaza(db.query("UPDATE documentos SET codigo_verificacion = 'EO-12' WHERE id = $1", [d.id]), /check|viola|violates/i);
    });
  });
});

describe('seguridad por fila (cartera del ejecutivo)', () => {
  it('el administrador ve todos los clientes', async () => {
    const admin = await idDe(ctx.cred.admin[0]);
    const n = await como('rol_admin', admin, async (db) => (await db.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n);
    assert.ok(n >= 4);
  });

  it('un ejecutivo sin cartera no ve clientes ni contratos', async () => {
    const ej = await idDe(ctx.cred.ejec[0]);
    const r = await como('rol_ejecutivo', ej, async (db) => (await db.query(
      'SELECT (SELECT count(*) FROM clientes)::int AS cl, (SELECT count(*) FROM contratos)::int AS k')).rows[0]);
    assert.deepEqual(r, { cl: 0, k: 0 });
  });

  it('el ejecutivo ve el cliente que él registra', async () => {
    const ej = await idDe(ctx.cred.ejec[0]);
    const n = await como('rol_ejecutivo', ej, async (db) => {
      await db.query("INSERT INTO clientes (rut, tipo_persona, razon_social) VALUES ('21167684-1', 'natural', 'CLIENTE PROPIO')");
      return (await db.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n;
    });
    assert.equal(n, 1);
  });
});

describe('auditoría', () => {
  it('registra quién crea un cliente', async () => {
    const admin = await idDe(ctx.cred.admin[0]);
    const filas = await como('rol_admin', admin, async (db) => {
      const c = (await db.query("INSERT INTO clientes (rut, tipo_persona, razon_social) VALUES ('10000013-K', 'natural', 'AUDITADO') RETURNING id")).rows[0];
      await db.query('RESET ROLE');
      return (await db.query("SELECT usuario_id, accion FROM registros_actividad WHERE tabla_afectada = 'clientes' AND registro_id = $1", [String(c.id)])).rows;
    });
    assert.deepEqual(filas, [{ usuario_id: admin, accion: 'INSERT' }]);
  });

  it('es de solo lectura, incluso para el superusuario', async () => {
    await como(null, null, async (db) => {
      await db.query('SAVEPOINT a');
      await rechaza(db.query('DELETE FROM registros_actividad'), /solo lectura/);
      await db.query('ROLLBACK TO a');
      await rechaza(db.query("UPDATE registros_actividad SET detalle = 'x'"), /solo lectura/);
    });
  });

  it('el rol de la aplicación no puede escribir en ella', async () => {
    const admin = await idDe(ctx.cred.admin[0]);
    await como('rol_admin', admin, (db) => rechaza(
      db.query("INSERT INTO registros_actividad (tabla_afectada, accion) VALUES ('x', 'INSERT')"), /permis|permission/i));
  });
});

describe('saldo de firmas', () => {
  it('un servicio con firmas suma saldo y un documento firmado lo descuenta', async () => {
    const admin = await idDe(ctx.cred.admin[0]);
    const saldos = await como('rol_admin', admin, async (db) => {
      const k = (await db.query("SELECT id, cliente_id FROM contratos WHERE estado = 'activo' LIMIT 1")).rows[0];
      const s = (await db.query("INSERT INTO servicios (nombre, precio_lista, firmas_incluidas) VALUES ('BOLSA PRUEBA 5 FIRMAS', 10000, 5) RETURNING id")).rows[0];
      const saldo = async () => Number((await db.query('SELECT coalesce(sum(disponibles), 0) AS s FROM v_saldo_firmas WHERE cliente_id = $1', [k.cliente_id])).rows[0].s);
      const antes = await saldo();
      await db.query("INSERT INTO contrato_servicios (contrato_id, orden, servicio_id, precio, ciclo_pago) VALUES ($1, 99, $2, 10000, 'UNICO')", [k.id, s.id]);
      const conBolsa = await saldo();
      const d = (await db.query("INSERT INTO documentos (cliente_id, tipo, requiere_revision) VALUES ($1, 'PRUEBA', false) RETURNING id", [k.cliente_id])).rows[0];
      await db.query("UPDATE documentos SET estado = 'firmado', firmado_en = now() WHERE id = $1", [d.id]);
      return [antes, conBolsa, await saldo()];
    });
    assert.equal(saldos[1], saldos[0] + 5);
    assert.equal(saldos[2], saldos[1] - 1);
  });
});
