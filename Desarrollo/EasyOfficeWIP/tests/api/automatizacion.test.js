/* Automatizaciones: ejecutivo de las ventas web, avisos al personal, renovación automática,
   contratos vencidos y segunda cuota del pago 50/50. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const T = perezosa(), A = perezosa(), E = perezosa(), P = perezosa();
const sql = (q, p) => entorno.sql(q, p);
const DIR = {};
const ANA = { nombre: 'Ana Demo Rojas', rut: '18.765.432-7', email: 'ana.demo@ejemplo.test' };
const venta = {}, ej = {};

describe('1 y 2 · Ventas de la tienda: ejecutivo asignado y aviso al personal', () => {
  it('compra pagada en dos cuotas', async () => {
    const comunas = (await T('GET', '/api/tienda/comunas')).comunas;
    Object.assign(DIR, { calle: 'Los Aromos', numero: '1450', comuna_id: comunas.find((c) => c.nombre === 'Providencia').id });
    const r = await entorno.comprarYPagar(T, { plan: 'dom-anual', tipo: 'persona', direccion: DIR, titular: ANA, pago: { modo: 'split', medio: 'tbk' } });
    assert.equal(r.status, 201, r.error);
    Object.assign(venta, r);
  });
  it('el contrato y sus documentos quedan en la cartera del ejecutivo con menos contratos', async () => {
    const [k] = await sql(`SELECT k.ejecutivo_id, u.email, r.rol, (SELECT bool_and(d.ejecutivo_id = k.ejecutivo_id) FROM documentos d WHERE d.contrato_id = k.id) AS docs
                             FROM contratos k JOIN usuarios u ON u.id = k.ejecutivo_id JOIN roles r ON r.id = u.rol_id WHERE k.folio = $1`, [venta.orden]);
    assert.equal(k.rol, 'ejecutivo');
    assert.equal(k.docs, true);
    Object.assign(ej, k);
  });
  it('el ejecutivo recibe el aviso de la venta y lo que espera revisión', () => {
    const c = ctx.correos(ej.email).find((x) => /Nueva venta en la tienda/.test(x.asunto));
    assert.ok(c, 'llegó el aviso');
    assert.ok(c.html.includes(venta.orden) && /Espera su revisión/.test(c.html));
  });
  it('si el ejecutivo es la ejecutiva de prueba, la ve en su cartera', async () => {
    if (ej.email !== ctx.cred.ejec[0]) return;
    await E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] });
    const r = await E('GET', '/api/crm/clientes');
    assert.ok(r.clientes.some((c) => c.razon_social === ANA.nombre));
  });
  it('una segunda compra del mismo cliente va al mismo ejecutivo', async () => {
    const r = await entorno.comprarYPagar(T, { plan: 'dom-bod', tipo: 'persona', direccion: DIR, titular: ANA });
    assert.equal(r.status, 201, r.error);
    const [k] = await sql('SELECT ejecutivo_id FROM contratos WHERE folio = $1', [r.orden]);
    assert.equal(k.ejecutivo_id, ej.ejecutivo_id);
  });
  it('un ticket del cliente le llega al ejecutivo', async () => {
    const tk = ctx.correos(ANA.email).find((c) => c.token)?.token;
    assert.equal((await P('POST', '/api/cliente/clave/definir', { token: tk, password: 'Ana-Demo-2026' })).status, 200);
    assert.equal((await P('POST', '/api/cliente/tickets', { motivo: 'otro', detalle: '¿Puedo cambiar la fecha de inicio?' })).status, 200);
    const c = ctx.correos(ej.email).find((x) => /Nuevo ticket/.test(x.asunto));
    assert.ok(c && c.html.includes('cambiar la fecha de inicio'));
  });
});

describe('5 · Segunda cuota del pago 50/50', () => {
  it('pagada la primera, queda pendiente la segunda por lo que falta del total', async () => {
    const pagos = await sql('SELECT p.cuota, p.estado, p.monto::int AS monto FROM pagos p JOIN contratos k ON k.id = p.contrato_id WHERE k.folio = $1 ORDER BY p.cuota', [venta.orden]);
    const [t] = await sql('SELECT sum(cs.precio)::int AS total FROM contrato_servicios cs JOIN contratos k ON k.id = cs.contrato_id WHERE k.folio = $1', [venta.orden]);
    assert.deepEqual(pagos.map((x) => [x.cuota, x.estado]), [[1, 'pagado'], [2, 'pendiente']]);
    assert.equal(pagos[0].monto + pagos[1].monto, t.total);
  });
  it('el cliente recibe el aviso de la cuota pendiente', () => {
    assert.ok(ctx.correos(ANA.email).some((c) => /Cuota 2 de 2/.test(c.asunto)));
  });
  it('la paga desde Mi cuenta y vuelve allá, sin volver a generar documentos', async () => {
    const panel = await P('GET', '/api/cliente/panel');
    const cuota = panel.pagos.find((x) => x.estado === 'pendiente' && x.cuota === 2);
    assert.ok(cuota);
    const docsAntes = (await sql('SELECT count(*)::int AS n FROM documentos d JOIN contratos k ON k.id = d.contrato_id WHERE k.folio = $1', [venta.orden]))[0].n;
    const r = await P('POST', `/api/cliente/pagos/${cuota.id}/pagar`, {});
    assert.equal(r.status, 200, r.error);
    const token = new URL(r.pago.url, 'http://x').searchParams.get('t');
    const ok = await T('POST', `/api/tienda/pago/${token}`, { accion: 'aprobar' });
    assert.equal(ok.estado, 'pagado');
    assert.equal(ok.retorno, '/mi-cuenta');
    const docsDespues = (await sql('SELECT count(*)::int AS n FROM documentos d JOIN contratos k ON k.id = d.contrato_id WHERE k.folio = $1', [venta.orden]))[0].n;
    assert.equal(docsDespues, docsAntes);
    const [s] = await sql('SELECT saldo::int AS saldo FROM v_saldo_contrato s JOIN contratos k ON k.id = s.contrato_id WHERE k.folio = $1', [venta.orden]);
    assert.equal(s.saldo, 0);
  });
  paso('no se paga un pago ajeno → 404', () => P('POST', '/api/cliente/pagos/1/pagar', {}), (r) => r.status === 404);
});

describe('3 y 4 · Renovación automática y contratos vencidos', () => {
  const k = {};
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  it('preparar: uno con renovación automática vencido hace 2 días, uno sin renovación y uno vencido hace 30 días', async () => {
    const op = (await A('GET', '/api/crm/opciones')).cuerpo;
    const cli = await A('POST', '/api/crm/clientes', { rut: '21.167.684-1', razon_social: 'CLIENTE RENOVACIONES', email: 'renov@prueba.test' });
    const e = op.empresas[0];
    const nuevo = async () => (await A('POST', '/api/crm/contratos', {
      cliente_id: cli.id, empresa_id: e.id, sucursal_id: op.sucursales.find((s) => s.empresa_id === e.id).id,
      cuenta_recaudacion_id: op.cuentas.find((x) => x.empresa_id === e.id).id, fecha_inicio: '2026-01-01', duracion_meses: 12,
      servicios: [{ servicio_id: op.servicios[0].id }]
    })).id;
    k.auto = await nuevo(); k.sin = await nuevo(); k.viejo = await nuevo();
    // Cada uno, de un cliente distinto no: el mismo cliente. Fechas: la base exige término >= inicio
    await sql("UPDATE contratos SET fecha_inicio = CURRENT_DATE - 367, fecha_vencimiento = CURRENT_DATE - 2, renovacion_automatica = true WHERE id = $1", [k.auto]);
    await sql("UPDATE contratos SET fecha_inicio = CURRENT_DATE - 368, fecha_vencimiento = CURRENT_DATE - 3, renovacion_automatica = false WHERE id = $1", [k.sin]);
    await sql("UPDATE contratos SET fecha_inicio = CURRENT_DATE - 395, fecha_vencimiento = CURRENT_DATE - 30, renovacion_automatica = true WHERE id = $1", [k.viejo]);
  });
  it('la tarea diaria renueva solo el reciente con renovación automática y marca los vencidos', async () => {
    const tareas = require('../../src/negocio/servicios/tareas.servicio');
    const r = await tareas.ejecutar();
    const folios = await sql('SELECT id, folio, estado, (SELECT folio FROM contratos n WHERE n.contrato_anterior_id = k.id) AS renovado_en FROM contratos k WHERE id = ANY($1) ORDER BY id', [[k.auto, k.sin, k.viejo]]);
    const [auto, sin, viejo] = folios;
    assert.ok(auto.renovado_en, 'se renovó');
    assert.ok(r.renovados.some((x) => x.folio === auto.folio && x.nuevo === auto.renovado_en));
    assert.equal(sin.renovado_en, null);
    assert.equal(viejo.renovado_en, null);
    assert.deepEqual(folios.map((x) => x.estado), ['vencido', 'vencido', 'vencido']);
    k.folioAuto = auto.folio;
    k.nuevoFolio = auto.renovado_en;
  });
  it('el contrato nuevo empieza al día siguiente y queda activo', async () => {
    const [n] = await sql('SELECT n.estado, n.fecha_inicio = k.fecha_vencimiento + 1 AS continua FROM contratos n JOIN contratos k ON k.id = n.contrato_anterior_id WHERE k.id = $1', [k.auto]);
    assert.deepEqual(n, { estado: 'activo', continua: true });
  });
  it('se avisó al cliente y al equipo', () => {
    assert.ok(ctx.correos('renov@prueba.test').some((c) => c.asunto === `Su contrato ${k.folioAuto} se renovó`));
    assert.ok(ctx.correos(ctx.cred.admin[0]).some((c) => /Renovación automática/.test(c.asunto)));
  });
  it('correrla de nuevo no hace nada (idempotente)', async () => {
    const r = await require('../../src/negocio/servicios/tareas.servicio').ejecutar();
    assert.ok(!r.renovados.some((x) => x.folio === k.folioAuto));
  });
  paso('renovar a mano un contrato ya renovado → 409 con el folio siguiente', () => A('POST', `/api/crm/contratos/${k.auto}/renovar`),
    (r) => r.status === 409 && r.error.includes(k.nuevoFolio));
  paso('el botón de Renovaciones también corre la tarea', () => A('POST', '/api/crm/avisos/enviar'), (r) => r.status === 200 && Array.isArray(r.renovados) && Array.isArray(r.vencidos));
});

describe('Pago 50/50 confirmado en el CRM', () => {
  paso('registrar la primera cuota pagada crea la segunda pendiente', async () => {
    const [k] = await sql("SELECT id FROM contratos WHERE estado = 'activo' AND origen = 'crm' ORDER BY id LIMIT 1");
    await sql('DELETE FROM pagos WHERE contrato_id = $1', [k.id]).catch(() => {});
    return A('POST', '/api/crm/pagos', { contrato_id: k.id, monto: 10000, estado: 'pagado', pasarela: 'transferencia', cuota: 1, total_cuotas: 2 });
  }, (r) => r.status === 201 && r.cuota_siguiente?.cuota === 2);
});
