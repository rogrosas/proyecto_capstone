/* Correspondencia del domicilio tributario (HU-31): registrar, escanear, avisar, ver en Mi cuenta y retirar. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const A = perezosa(), P = perezosa(), E = perezosa();
const cli = {}, c1 = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

async function subir(id, contenido) {
  // El cliente HTTP de las pruebas manda JSON: el escaneo va con fetch directo y la cookie de la sesión
  const cookie = A.cookie;
  return fetch(`${ctx.url}/api/crm/correspondencia/${id}/escaneo`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', cookie }, body: contenido
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
}

describe('Correspondencia', () => {
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }), (r) => {
    A.cookie = r.cabeceras.get('set-cookie').split(';')[0];
    return r.status === 200;
  });
  paso('cliente con correo y acceso al portal', async () => {
    Object.assign(cli, await A('POST', '/api/crm/clientes', { rut: '21.167.684-1', razon_social: 'Roger Prueba Correspondencia', email: 'corr@prueba.test' }));
    await A('POST', '/api/crm/contratos', await (async () => {
      const op = (await A('GET', '/api/crm/opciones')).cuerpo;
      const e = op.empresas[0];
      return { cliente_id: cli.id, empresa_id: e.id, sucursal_id: op.sucursales.find((s) => s.empresa_id === e.id).id, cuenta_recaudacion_id: op.cuentas.find((x) => x.empresa_id === e.id).id, fecha_inicio: '2026-11-01', duracion_meses: 12, servicios: [{ servicio_id: op.servicios[0].id }] };
    })());
    await P('POST', '/api/cliente/clave', { tipo: 'persona', email: 'corr@prueba.test' });
    return P('POST', '/api/cliente/clave/definir', { token: ctx.correos('corr@prueba.test').at(-1).token, password: 'Correspondencia-1' });
  });
  paso('tipo inválido → 400', () => A('POST', '/api/crm/correspondencia', { cliente_id: cli.id, remitente: 'X', tipo: 'paloma' }), (r) => r.status === 400);
  paso('registrar una carta del SII (urgente por ser fiscal)', () => A('POST', '/api/crm/correspondencia', { cliente_id: cli.id, remitente: 'Servicio de Impuestos Internos', tipo: 'fiscal', descripcion: 'Citación' }),
    (r) => { c1.id = r.id; return r.status === 201 && r.id > 0; });
  it('la base la marca urgente, con plazo de 24 horas y la sucursal del contrato', async () => {
    const [c] = await entorno.sql("SELECT urgente, estado, round(extract(epoch FROM plazo_en - recibida_en) / 3600) AS horas, sucursal_id IS NOT NULL AS suc FROM correspondencia WHERE id = $1", [c1.id]);
    assert.deepEqual({ ...c, horas: Number(c.horas) }, { urgente: true, estado: 'recibida', horas: 24, suc: true });
  });
  paso('aparece en "Por avisar"', () => A('GET', '/api/crm/correspondencia'), (r) => r.correspondencia.some((x) => x.id === c1.id && x.urgente));
  paso('el cliente todavía no la ve (sin escanear ni avisar)', () => P('GET', '/api/cliente/correspondencia'), (r) => r.status === 200 && r.correspondencia.length === 0);
  it('un archivo que no es PDF ni imagen → 400', async () => {
    const r = await subir(c1.id, Buffer.from('MZ ejecutable'));
    assert.equal(r.status, 400);
  });
  it('subir el escaneo la deja escaneada', async () => {
    const r = await subir(c1.id, PDF);
    assert.equal(r.status, 200, r.error);
    const [c] = await entorno.sql('SELECT estado, url_archivo FROM correspondencia WHERE id = $1', [c1.id]);
    assert.equal(c.estado, 'digitalizada');
    assert.match(c.url_archivo, /^correspondencia\/\d{4}\/C\d+-[0-9a-f]+\.pdf$/);
  });
  paso('avisar al cliente', () => A('POST', `/api/crm/correspondencia/${c1.id}/notificar`), (r) => r.status === 200 && r.enviados === 1);
  it('el correo dice que es urgente', () => {
    const c = ctx.correos('corr@prueba.test').at(-1);
    assert.match(c.asunto, /^URGENTE/);
    assert.ok(c.html.includes('Servicio de Impuestos Internos'));
  });
  paso('Mi cuenta la muestra como nueva', () => P('GET', '/api/cliente/correspondencia'), (r) => r.correspondencia.length === 1 && r.correspondencia[0].estado === 'notificada' && !r.correspondencia[0].leida);
  paso('el cliente abre el escaneo (PDF, sin scripts)', () => P('GET', `/api/cliente/correspondencia/${c1.id}/archivo`, undefined, { crudo: true }),
    (r) => r.status === 200 && r.tipo === 'application/pdf' && /default-src 'none'/.test(r.cabeceras.get('content-security-policy')));
  paso('y queda como vista, también en el CRM', () => A('GET', '/api/crm/correspondencia?estado=por_retirar'), (r) => r.correspondencia.find((x) => x.id === c1.id)?.leida);
  paso('otro cliente no la ve → 404', async () => {
    const otro = ctx.sesion();
    await otro('POST', '/api/cliente/clave', { tipo: 'persona', email: 'nadie@prueba.test' });
    return otro('GET', `/api/cliente/correspondencia/${c1.id}/archivo`, undefined, { crudo: true });
  }, (r) => r.status === 401 || r.status === 404);
  paso('marcar retirada', () => A('PATCH', `/api/crm/correspondencia/${c1.id}`, { estado: 'retirada' }));
  paso('no se cambia una ya retirada → 409', () => A('PATCH', `/api/crm/correspondencia/${c1.id}`, { estado: 'devuelta' }), (r) => r.status === 409);
  it('la base registra cuándo se retiró y la auditoría la operación', async () => {
    const [c] = await entorno.sql('SELECT retirada_en IS NOT NULL AS r FROM correspondencia WHERE id = $1', [c1.id]);
    assert.equal(c.r, true);
    const [a] = await entorno.sql("SELECT count(*)::int AS n FROM registros_actividad WHERE tabla_afectada = 'correspondencia'");
    assert.ok(a.n >= 3);
  });
  describe('ejecutivo', () => {
    paso('login', () => E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }));
    paso('no registra en clientes fuera de su cartera → 404', () => E('POST', '/api/crm/correspondencia', { cliente_id: cli.id, remitente: 'X', tipo: 'otra' }), (r) => r.status === 404);
    paso('no ve la de otros clientes', () => E('GET', '/api/crm/correspondencia?estado='), (r) => r.status === 200 && !r.correspondencia.some((x) => x.id === c1.id));
  });
});
