/* Pago en línea con la pasarela simulada (HU-27): la compra sigue solo con el pago aprobado. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const T = perezosa();
const DIR = {};
const CAMI = { nombre: 'Camila Díaz Paredes', rut: '18.765.432-7', email: 'camila.diaz@ejemplo.test' };
const compra = {};
const tokenDe = (url) => new URL(url, 'http://x').searchParams.get('t');
const sql = (q, p) => entorno.sql(q, p);

describe('Compra con pago en línea', () => {
  it('la compra queda esperando el pago, sin documentos ni contrato activo', async () => {
    const comunas = (await T('GET', '/api/tienda/comunas')).comunas;
    Object.assign(DIR, { calle: 'El Fogonero', numero: '311', comuna_id: comunas.find((c) => c.nombre === 'Buin').id });
    const r = await T('POST', '/api/tienda/compras', { plan: 'dom-bod', tipo: 'persona', direccion: DIR, titular: CAMI, pago: { modo: 'total', medio: 'tbk' } });
    assert.equal(r.status, 201, r.error);
    assert.equal(r.estado, 'por_pagar');
    assert.match(r.pago.url, /^\/pago-simulado\?t=/);
    Object.assign(compra, r, { token: tokenDe(r.pago.url) });
    const [k] = await sql('SELECT k.estado, (SELECT count(*)::int FROM documentos d WHERE d.contrato_id = k.id) AS docs FROM contratos k WHERE k.folio = $1', [r.orden]);
    assert.deepEqual(k, { estado: 'pendiente', docs: 0 });
    assert.equal(ctx.correos(CAMI.email).length, 0, 'todavía no se envía nada al cliente');
  });
  paso('la pasarela muestra la orden y el monto', () => T('GET', `/api/tienda/pago/${compra.token}`),
    (r) => r.status === 200 && r.orden === compra.orden && r.monto === compra.monto && r.estado === 'pendiente' && r.pasarela === 'transbank');
  paso('enlace alterado → 401', () => T('GET', `/api/tienda/pago/${compra.token.slice(0, -2)}xx`), (r) => r.status === 401);
  paso('resultado inválido → 400', () => T('POST', `/api/tienda/pago/${compra.token}`, { accion: 'regalar' }), (r) => r.status === 400);
  paso('la pasarela rechaza el pago', () => T('POST', `/api/tienda/pago/${compra.token}`, { accion: 'rechazar' }), (r) => r.status === 200 && r.estado === 'rechazado');
  it('rechazado: el contrato sigue pendiente y no hay documentos', async () => {
    const [p] = await sql("SELECT p.estado, p.respuesta_pasarela->>'estado' AS resp, k.estado AS k FROM pagos p JOIN contratos k ON k.id = p.contrato_id WHERE k.folio = $1", [compra.orden]);
    assert.deepEqual(p, { estado: 'rechazado', resp: 'REJECTED', k: 'pendiente' });
  });
  paso('no se aprueba un pago ya rechazado → 409', () => T('POST', `/api/tienda/pago/${compra.token}`, { accion: 'aprobar' }), (r) => r.status === 409);
  paso('nuevo intento con otro enlace', () => T('POST', `/api/tienda/pago/${compra.token}/reintentar`), (r) => {
    compra.token2 = r.pago && tokenDe(r.pago.url);
    return r.status === 200 && compra.token2 && compra.token2 !== compra.token;
  });
  paso('la pasarela aprueba: contrato activo, documentos y entrega', () => T('POST', `/api/tienda/pago/${compra.token2}`, { accion: 'aprobar' }),
    (r) => r.status === 200 && r.estado === 'pagado' && r.documentos?.[0]?.publicado === true && r.cuenta === 'documento_enviado');
  it('el pago queda conciliado con la respuesta de la pasarela', async () => {
    const filas = await sql(`SELECT p.estado, p.codigo_autorizacion IS NOT NULL AS aut, p.ultimos_4, p.conciliado_en IS NOT NULL AS conc, p.fecha_pago IS NOT NULL AS fecha,
                                    p.id_transaccion LIKE 'SIM-%' AS tx, k.estado AS k
                               FROM pagos p JOIN contratos k ON k.id = p.contrato_id WHERE k.folio = $1 ORDER BY p.id`, [compra.orden]);
    assert.equal(filas.length, 2);
    assert.deepEqual(filas[1], { estado: 'pagado', aut: true, ultimos_4: '6623', conc: true, fecha: true, tx: true, k: 'activo' });
  });
  it('el cliente recibe su documento recién ahora', () => {
    const c = ctx.correos(CAMI.email);
    assert.equal(c.length, 1);
    assert.equal(c[0].adjuntos.length, 1);
  });
  paso('volver a /contratar muestra el resultado guardado', () => T('GET', `/api/tienda/pago/${compra.token2}`),
    (r) => r.status === 200 && r.estado === 'pagado' && r.cuenta === 'documento_enviado' && r.documentos.length === 1);
  paso('aprobar dos veces → 409', () => T('POST', `/api/tienda/pago/${compra.token2}`, { accion: 'aprobar' }), (r) => r.status === 409);
  it('la página de la pasarela existe', async () => {
    const r = await T('GET', '/pago-simulado', undefined, { crudo: true });
    assert.equal(r.status, 200);
    assert.ok(r.texto.includes('Simulador de pasarela'));
  });
});

describe('Pago confirmado a mano en el CRM', () => {
  const A = perezosa(), sinPagar = {};
  it('una compra que no se pagó en línea queda pendiente', async () => {
    const r = await T('POST', '/api/tienda/compras', { plan: 'dom-bod', tipo: 'persona', direccion: DIR, titular: { nombre: 'Rosa Demo Lagos', rut: '15.432.109-8', email: 'rosa.demo@ejemplo.test' } });
    assert.equal(r.status, 201, r.error);
    Object.assign(sinPagar, r);
  });
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('al marcar el pago "pagado" el contrato pendiente queda activo', async () => {
    const [p] = await sql('SELECT p.id FROM pagos p JOIN contratos k ON k.id = p.contrato_id WHERE k.folio = $1', [sinPagar.orden]);
    return A('PATCH', `/api/crm/pagos/${p.id}`, { estado: 'pagado' });
  }, (r) => r.status === 200 && r.contrato_activado === sinPagar.orden);
  it('el contrato está activo', async () => {
    const [k] = await sql('SELECT estado FROM contratos WHERE folio = $1', [sinPagar.orden]);
    assert.equal(k.estado, 'activo');
  });
});

describe('Cabeceras de seguridad', () => {
  it('las páginas y la API traen la política de seguridad', async () => {
    const pagina = await T('GET', '/contratar', undefined, { crudo: true });
    const csp = pagina.cabeceras.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(pagina.cabeceras.get('x-content-type-options'), 'nosniff');
    assert.equal(pagina.cabeceras.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(pagina.cabeceras.get('x-powered-by'), null);
    const api = await T('GET', '/api/tienda/comunas', undefined, { crudo: true });
    assert.equal(api.cabeceras.get('cache-control'), 'no-store');
  });
  it('ninguna página usa scripts en línea (la política los bloquearía)', async () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'public');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${f} tiene un <script> en línea`);
      assert.ok(!/\son[a-z]+="/i.test(html), `${f} tiene un manejador en línea (onclick=…)`);
    }
  });
});
