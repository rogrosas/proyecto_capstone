/* Inyección SQL contra la API: cargas clásicas en el ingreso, búsquedas, ids de la URL, catálogos,
   verificación pública y la tienda. Ninguna debe abrir sesión, devolver datos de más, responder 500
   ni cambiar la base. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const CARGAS = [
  "' OR '1'='1",
  "' OR 'a'='a' --",
  "admin@easyoffice.cl' --",
  "'; DROP TABLE clientes; --",
  "' UNION SELECT id, email, password_hash FROM usuarios --",
  "1; SELECT pg_sleep(5) --",
  "') OR ('x'='x",
  '\\',
  "%' AND 1=CAST((SELECT password_hash FROM usuarios LIMIT 1) AS int) --"
];

let ctx, A, P;
let ip = 50;
const nueva = () => ctx.sesion({ ip: `10.9.0.${ip++}` });
before(async () => {
  ctx = await entorno.iniciar();
  A = nueva();
  const r = await A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] });
  assert.equal(r.status, 200);
});
after(() => entorno.terminar());

const sin500 = (r, carga) => assert.ok(r.status < 500, `${r.status} con ${JSON.stringify(carga)}: ${r.error || ''}`);

describe('Ingreso', () => {
  it('CRM: ninguna carga en el correo o la clave abre sesión', async () => {
    for (const c of CARGAS) {
      for (const datos of [{ email: c, password: 'x' }, { email: ctx.cred.admin[0], password: c }, { email: c, password: c }]) {
        const r = await nueva()('POST', '/api/crm/login', datos);
        sin500(r, c);
        // 429: tras 5 claves malas la cuenta se bloquea (también es un rechazo)
        assert.ok([400, 401, 429].includes(r.status), `${r.status} con ${JSON.stringify(datos)}`);
        assert.ok(!r.usuario && !r.cabeceras.get('set-cookie'));
      }
    }
  });

  it('portal: ninguna carga en el RUT, el correo o la clave abre sesión', async () => {
    for (const c of CARGAS) {
      for (const datos of [{ tipo: 'persona', email: c, password: c }, { tipo: 'empresa', rut: c, email: 'a@b.cl', password: c },
        { tipo: c, email: 'a@b.cl', password: 'x' }, { tipo: '__proto__', email: c, password: 'x' }, { tipo: 'constructor', email: 'a@b.cl', password: c }]) {
        const r = await nueva()('POST', '/api/cliente/ingresar', datos);
        sin500(r, c);
        assert.ok([400, 401].includes(r.status), `${r.status} con ${JSON.stringify(datos)}`);
      }
    }
  });

  it('una sesión inventada en la cookie no sirve', async () => {
    for (const c of CARGAS) {
      const r = await nueva()('GET', '/api/crm/yo', undefined, { cabeceras: { cookie: `eo_crm=${encodeURIComponent(c)}` } });
      assert.equal(r.status, 401);
    }
  });
});

describe('Búsquedas del CRM', () => {
  const listas = [
    ['/api/crm/clientes?q=', (r) => r.clientes],
    ['/api/crm/contratos?q=', (r) => r.contratos],
    ['/api/crm/correspondencia?estado=&q=', (r) => r.correspondencia],
    ['/api/crm/auditoria?q=', (r) => r.registros]
  ];

  it('una carga se busca como texto: no trae todo ni rompe la consulta', async () => {
    for (const [ruta, filas] of listas) {
      for (const c of CARGAS) {
        const r = await A('GET', ruta + encodeURIComponent(c));
        sin500(r, c);
        assert.equal(r.status, 200, `${ruta}${c}`);
        assert.equal(filas(r).length, 0, `${ruta}${c} devolvió ${filas(r).length} filas`);
      }
    }
  });

  it('los comodines de LIKE se buscan tal cual (% y _ no traen todo)', async () => {
    const todos = (await A('GET', '/api/crm/clientes?q=')).clientes.length;
    assert.ok(todos > 0, 'los datos de muestra deberían tener clientes');
    for (const c of ['%', '_', '%%', '__%']) {
      const r = await A('GET', '/api/crm/clientes?q=' + encodeURIComponent(c));
      assert.equal(r.clientes.length, 0, `"${c}" devolvió ${r.clientes.length} clientes`);
    }
  });

  it('filtros de lista cerrada ignoran valores desconocidos', async () => {
    for (const c of [...CARGAS, '__proto__', 'constructor', 'toString']) {
      sin500(await A('GET', '/api/crm/clientes?estado=' + encodeURIComponent(c)), c);
      sin500(await A('GET', '/api/crm/documentos?tipo=' + encodeURIComponent(c)), c);
      sin500(await A('GET', '/api/crm/auditoria?accion=' + encodeURIComponent(c)), c);
    }
  });

  it('la exportación a CSV no ejecuta fórmulas ni SQL', async () => {
    const r = await A('GET', '/api/crm/exportar/clientes?q=' + encodeURIComponent("' OR 1=1 --"), undefined, { crudo: true });
    assert.equal(r.status, 200);
    assert.equal(r.texto.trim().split('\r\n').length, 1, 'solo el encabezado');
  });
});

describe('Ids y nombres en la URL', () => {
  it('un id que no es número → 400 (nunca 500 ni datos)', async () => {
    for (const c of ['1 OR 1=1', "1'", '1;DROP TABLE clientes', '-1 UNION SELECT 1', '1e3', '0x10']) {
      for (const ruta of ['/api/crm/clientes/', '/api/crm/contratos/', '/api/crm/documentos/']) {
        const r = await A('GET', ruta + encodeURIComponent(c));
        sin500(r, c);
        assert.ok([400, 404].includes(r.status), `${ruta}${c} → ${r.status}`);
      }
    }
  });

  it('un catálogo o listado que no existe → 404', async () => {
    for (const c of ['usuarios', 'clientes; DROP TABLE x', 'servicios"--', '__proto__', 'constructor']) {
      sin500(await A('GET', '/api/crm/admin/catalogos/' + encodeURIComponent(c)), c);
      assert.equal((await A('GET', '/api/crm/admin/catalogos/' + encodeURIComponent(c))).status, 404, c);
      assert.equal((await A('GET', '/api/crm/exportar/' + encodeURIComponent(c), undefined, { crudo: true })).status, 404, c);
    }
  });

  it('verificación pública: un código con SQL → 400', async () => {
    for (const c of CARGAS) {
      const r = await nueva()('GET', '/api/verificar/' + encodeURIComponent(c));
      assert.equal(r.status, 400, c);
    }
  });
});

describe('Datos guardados', () => {
  it('una razón social con SQL se guarda como texto', async () => {
    const razon = "Robert'); DROP TABLE clientes; -- SpA";
    const r = await A('POST', '/api/crm/clientes', { rut: '19.111.222-9', razon_social: razon, email: 'bobby@ejemplo.test', celular: '912345678' });
    assert.ok(r.status < 300, `${r.status} ${r.error || ''}`);
    const [fila] = await entorno.sql('SELECT razon_social FROM clientes WHERE rut = $1', ['19111222-9']);
    assert.equal(fila.razon_social, razon);
  });

  it('la tienda guarda las cargas como texto y no rompe nada', async () => {
    const T = nueva();
    const comunas = (await T('GET', '/api/tienda/comunas')).comunas;
    const r = await T('POST', '/api/tienda/compras', {
      plan: "dom-bod' OR '1'='1", tipo: 'persona',
      titular: { nombre: "x'); DROP TABLE contratos; --", rut: '19.876.543-0', email: 'carga@ejemplo.test' },
      direccion: { calle: "'; DELETE FROM pagos; --", numero: '1', comuna_id: comunas[0].id }
    });
    assert.equal(r.status, 400);   // el plan con SQL no existe en el catálogo
    assert.match(r.error, /plan/i);
  });

  it('todas las tablas siguen ahí y nadie cambió las contraseñas', async () => {
    const [x] = await entorno.sql(`SELECT (SELECT count(*) FROM clientes) AS clientes, (SELECT count(*) FROM contratos) AS contratos,
      (SELECT count(*) FROM pagos) AS pagos, (SELECT count(*) FROM usuarios WHERE password_hash IS NOT NULL) AS con_clave`);
    assert.ok(Number(x.clientes) > 0 && Number(x.contratos) > 0 && Number(x.con_clave) >= 2);
  });
});
