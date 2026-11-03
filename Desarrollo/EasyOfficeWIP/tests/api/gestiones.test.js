/* Bitácora de gestiones del cliente (HU-36) y exportación de listados a CSV (HU-37). */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const A = perezosa(), E = perezosa();
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
const cl = {}, k = {};

describe('Bitácora de gestiones', () => {
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  it('cliente con contrato de la muestra', async () => {
    const r = await A('GET', '/api/crm/contratos');
    Object.assign(k, r.contratos[0]);
    cl.id = k.cliente_id;
    assert.ok(cl.id);
  });
  paso('sin resultado ni nota → 400', () => A('POST', `/api/crm/clientes/${cl.id}/gestiones`, { tipo: 'llamada' }), (r) => r.status === 400);
  paso('tipo inválido → 400', () => A('POST', `/api/crm/clientes/${cl.id}/gestiones`, { tipo: 'fax', nota: 'x' }), (r) => r.status === 400);
  paso('contrato de otro cliente → 400', async () => {
    const otro = (await A('GET', '/api/crm/contratos')).contratos.find((x) => x.cliente_id !== cl.id);
    return A('POST', `/api/crm/clientes/${cl.id}/gestiones`, { tipo: 'nota', nota: 'x', contrato_id: otro.id });
  }, (r) => r.status === 400);
  paso('registra una llamada con seguimiento para hoy', () => A('POST', `/api/crm/clientes/${cl.id}/gestiones`, {
    tipo: 'llamada', resultado: 'promete_pago', contrato_id: k.id, nota: 'Paga el viernes por transferencia.', proxima_accion_en: hoy()
  }), (r) => r.status === 201 && r.id > 0);
  paso('la ficha la muestra con quién la registró', () => A('GET', `/api/crm/clientes/${cl.id}`),
    (r) => r.gestiones?.[0]?.resultado === 'promete_pago' && r.gestiones[0].usuario === 'Diego Muñoz' && r.gestiones[0].folio === k.folio && r.gestiones[0].proxima === hoy());
  paso('el tablero la pone en "Requiere acción hoy"', () => A('GET', '/api/crm/dashboard'),
    (r) => r.accion.some((a) => a.tipo === 'seguimiento' && a.cliente_id === cl.id));
  paso('una gestión nueva cierra el seguimiento', async () => {
    await A('POST', `/api/crm/clientes/${cl.id}/gestiones`, { tipo: 'nota', nota: 'Pagó.' });
    return A('GET', '/api/crm/dashboard');
  }, (r) => !r.accion.some((a) => a.tipo === 'seguimiento' && a.cliente_id === cl.id));
  it('queda en la auditoría', async () => {
    const r = await entorno.sql("SELECT count(*)::int AS n FROM registros_actividad WHERE tabla_afectada = 'gestiones' AND accion = 'INSERT'");
    assert.equal(r[0].n, 2);
  });
  describe('ejecutivo', () => {
    paso('login', () => E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }));
    paso('no registra gestiones en clientes ajenos → 404', () => E('POST', `/api/crm/clientes/${cl.id}/gestiones`, { tipo: 'nota', nota: 'x' }), (r) => r.status === 404);
  });
});

describe('Exportar a CSV (Excel)', () => {
  it('clientes: UTF-8 con BOM, separado por ";", con las mismas filas que la pantalla', async () => {
    const r = await A('GET', '/api/crm/exportar/clientes', undefined, { crudo: true });
    assert.equal(r.status, 200);
    assert.match(r.tipo, /text\/csv/);
    assert.match(r.cabeceras.get('content-disposition'), /easyoffice_clientes_\d{4}-\d{2}-\d{2}\.csv/);
    assert.equal(r.texto.charCodeAt(0), 0xFEFF);
    const lineas = r.texto.slice(1).trim().split('\r\n');
    assert.match(lineas[0], /^RUT;Razón social;/);
    const pantalla = await A('GET', '/api/crm/clientes');
    assert.equal(lineas.length - 1, pantalla.clientes.length);
  });
  paso('contratos con filtro', () => A('GET', `/api/crm/exportar/contratos?q=${encodeURIComponent(k.folio)}`, undefined, { crudo: true }),
    (r) => r.status === 200 && r.texto.trim().split('\r\n').length === 2 && r.texto.includes(k.folio));
  for (const lista of ['renovaciones', 'documentos', 'pagos', 'auditoria']) {
    paso(`${lista}`, () => A('GET', `/api/crm/exportar/${lista}`, undefined, { crudo: true }), (r) => r.status === 200 && r.texto.length > 10);
  }
  paso('listado desconocido → 404', () => A('GET', '/api/crm/exportar/usuarios', undefined, { crudo: true }), (r) => r.status === 404);
  paso('el ejecutivo no exporta la auditoría → 403', () => E('GET', '/api/crm/exportar/auditoria', undefined, { crudo: true }), (r) => r.status === 403);
  it('un texto que parece fórmula no se ejecuta en Excel', async () => {
    await A('POST', `/api/crm/clientes/${cl.id}/gestiones`, { tipo: 'nota', nota: 'x' });
    const c = await A('POST', '/api/crm/clientes', { rut: '21.167.684-1', razon_social: '=HYPERLINK("http://x")', email: 'formula@prueba.test' });
    assert.equal(c.status, 201, c.error);
    const r = await A('GET', '/api/crm/exportar/clientes?q=HYPERLINK', undefined, { crudo: true });
    assert.ok(r.texto.includes(`"'=HYPERLINK(""http://x"")"`), r.texto);
  });
});
