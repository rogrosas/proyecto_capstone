/* Tablero con filtro por período (HU-33) y avisos automáticos de vencimiento por correo (HU-14). */
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
const op = {}, cli = {}, sinCorreo = {}, k = {}, k2 = {};
let antes;

function datosContrato(clienteId) {
  const empresa = op.empresas.find((e) => e.nombre === 'EASY OFFICE') || op.empresas[0];
  return {
    cliente_id: clienteId, empresa_id: empresa.id, sucursal_id: op.sucursales.find((x) => x.empresa_id === empresa.id).id,
    cuenta_recaudacion_id: op.cuentas.find((c) => c.empresa_id === empresa.id).id, fecha_inicio: hoy(), duracion_meses: 12,
    servicios: [{ servicio_id: op.servicios[0].id, precio: 120000 }]
  };
}

describe('Tablero por período', () => {
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('por defecto: el mes en curso', () => A('GET', '/api/crm/dashboard'), (r) => {
    antes = r.periodo?.indicadores;
    return r.status === 200 && r.periodo.desde === `${hoy().slice(0, 7)}-01` && r.periodo.hasta === hoy()
      && Array.isArray(r.periodo.indicadores.porServicio) && typeof r.periodo.indicadores.pendientes_firma === 'number';
  });
  paso('fecha inicial posterior a la final → 400', () => A('GET', '/api/crm/dashboard?desde=2026-12-01&hasta=2026-11-01'), (r) => r.status === 400);
  paso('fecha inválida → 400', () => A('GET', '/api/crm/dashboard?desde=01-11-2026'), (r) => r.status === 400);
  it('una venta nueva suma en el período, por servicio y por ejecutivo', async () => {
    Object.assign(op, (await A('GET', '/api/crm/opciones')).cuerpo);
    Object.assign(cli, await A('POST', '/api/crm/clientes', { rut: '21.167.684-1', razon_social: 'CLIENTE AVISOS', email: 'avisos@prueba.test' }));
    Object.assign(k, await A('POST', '/api/crm/contratos', datosContrato(cli.id)));
    assert.ok(k.id, k.error);
    const d = (await A('GET', '/api/crm/dashboard')).periodo.indicadores;
    assert.equal(d.contratos, antes.contratos + 1);
    assert.equal(d.ventas, antes.ventas + 120000);
    assert.equal(d.clientes_nuevos, antes.clientes_nuevos + 1);
    assert.ok(d.porServicio.some((s) => s.servicio === op.servicios[0].nombre && s.monto >= 120000));
    assert.ok(d.porEjecutivo.some((e) => e.ejecutivo === 'Diego Muñoz' && e.contratos >= 1));
  });
  paso('filtrar por otro ejecutivo deja la venta fuera', async () => {
    const otro = op.usuarios.find((u) => u.nombre !== 'Diego Muñoz');
    return A('GET', `/api/crm/dashboard?ejecutivo=${otro.id}`);
  }, (r) => r.status === 200 && !r.periodo.indicadores.porEjecutivo.some((e) => e.ejecutivo === 'Diego Muñoz'));
  paso('un período pasado no incluye la venta de hoy', () => A('GET', '/api/crm/dashboard?desde=2020-01-01&hasta=2020-12-31'),
    (r) => r.status === 200 && r.periodo.indicadores.contratos === 0);
  paso('la lista de contratos filtra por fecha de creación', () => A('GET', `/api/crm/contratos?desde=${hoy()}&hasta=${hoy()}`),
    (r) => r.status === 200 && r.contratos.some((c) => c.id === k.id));
  paso('documentos esperando firma', () => A('GET', '/api/crm/documentos?tipo=firma'), (r) => r.status === 200 && r.documentos.every((d) => d.estado === 'enviado_firma'));
  paso('trámites en curso', () => A('GET', '/api/crm/documentos?tipo=tramite'), (r) => r.status === 200 && r.documentos.every((d) => ['borrador', 'en_revision', 'aprobado'].includes(d.estado)));
  describe('ejecutivo', () => {
    paso('login', () => E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }));
    paso('solo ve su cartera aunque pida otro ejecutivo', () => E('GET', `/api/crm/dashboard?ejecutivo=1`),
      (r) => r.status === 200 && r.periodo.ejecutivo === null && r.periodo.indicadores.clientes === 0 && r.periodo.indicadores.contratos === 0);
    paso('no puede ver ni enviar los avisos → 403', () => E('POST', '/api/crm/avisos/enviar'), (r) => r.status === 403);
  });
});

describe('Avisos de vencimiento automáticos', () => {
  it('preparar: un contrato que vence en 30 días (su alerta de 30 días es hoy) y otro de un cliente sin correo', async () => {
    Object.assign(sinCorreo, await A('POST', '/api/crm/clientes', { rut: '10.000.013-K', razon_social: 'CLIENTE SIN CORREO' }));
    Object.assign(k2, await A('POST', '/api/crm/contratos', datosContrato(sinCorreo.id)));
    // La base crea las alertas al cambiar el vencimiento (fn_generar_alertas)
    await entorno.sql('UPDATE contratos SET fecha_vencimiento = CURRENT_DATE + 30 WHERE id = ANY($1)', [[k.id, k2.id]]);
    const al = await entorno.sql('SELECT dias_anticipacion FROM alertas WHERE contrato_id = $1 AND fecha_alerta <= CURRENT_DATE', [k.id]);
    assert.deepEqual(al.map((x) => x.dias_anticipacion), [30]);
  });
  paso('el panel muestra los pendientes', () => A('GET', '/api/crm/avisos'), (r) => r.status === 200 && r.pendientes >= 2 && r.automatico === false);
  const env = paso('enviar ahora', () => A('POST', '/api/crm/avisos/enviar'), (r) => r.status === 200 && r.contratos >= 1 && r.sin_correo >= 1);
  it('el cliente recibió el aviso con su folio y fecha', () => {
    const c = ctx.correos('avisos@prueba.test');
    assert.equal(c.length, 1);
    assert.match(c[0].asunto, new RegExp(`${k.folio} vence en 30 días`));
  });
  it('la alerta queda enviada por correo; la del cliente sin correo sigue pendiente', async () => {
    const r = await entorno.sql('SELECT contrato_id, notificado, canal FROM alertas WHERE contrato_id = ANY($1) AND fecha_alerta <= CURRENT_DATE ORDER BY contrato_id', [[k.id, k2.id]]);
    assert.deepEqual(r, [{ contrato_id: k.id, notificado: true, canal: 'correo' }, { contrato_id: k2.id, notificado: false, canal: null }]);
  });
  it('el ejecutivo recibe el resumen con el cliente para llamar', () => {
    const r = ctx.correos(ctx.cred.admin[0]).at(-1);
    assert.match(r.asunto, /Avisos de vencimiento/);
    assert.ok(r.html.includes('CLIENTE SIN CORREO') && r.html.includes('Sin correo'));
    assert.ok(env.detalle.some((d) => d.folio === k2.folio && d.estado === 'sin_correo'));
  });
  paso('un segundo envío no repite el aviso', () => A('POST', '/api/crm/avisos/enviar'),
    (r) => r.status === 200 && !r.detalle.some((d) => d.folio === k.folio) && ctx.correos('avisos@prueba.test').length === 1);
  paso('el historial registra los envíos', () => A('GET', '/api/crm/avisos'), (r) => r.ejecuciones.length === 2 && r.ejecuciones[1].origen === 'manual' && r.ejecuciones[1].usuario === 'Diego Muñoz');
  it('el envío automático corre una sola vez al día', async () => {
    const avisos = require('../../src/negocio/servicios/avisos.servicio');
    const r = await avisos.ejecutar({ origen: 'automatico' });
    assert.equal(r.contratos, 0);
    const conSistema = require('../../src/datos/conexion').conSistema;
    const repo = require('../../src/datos/repositorios/avisos.repositorio');
    assert.equal(await conSistema((db) => repo.ejecutadoHoy(db, 'America/Santiago')), true);
  });
});
