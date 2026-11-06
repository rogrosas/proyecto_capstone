/* Compra en la tienda → documentos con borrador → aceptación o ticket, y configuración de los documentos de la tienda. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const ultimoToken = (email) => ctx.correos(email).at(-1)?.token;
const T = perezosa(), P = perezosa(), A = perezosa(), E = perezosa(), X = perezosa();
const DIR = {};
const VALENTINA = { nombre: 'Valentina Soto Muñoz', rut: '19.876.543-0', email: 'valentina.soto@ejemplo.test', celular: '+56 9 8765 4321' };
// Las compras quedan confirmadas con el simulador de pago (como si la pasarela respondiera "aprobado")
const comprar = (datos) => entorno.comprarYPagar(T, { direccion: DIR, ...datos });

describe('Tienda', () => {
  it('comunas para el domicilio', async () => {
    const comunas = (await T('GET', '/api/tienda/comunas')).comunas;
    Object.assign(DIR, { calle: 'Los Aromos', numero: '1450', complemento: 'Depto 31', comuna_id: comunas.find((c) => c.nombre === 'Providencia')?.id });
    assert.ok(DIR.comuna_id);
  });
  paso('preguntas del plan bodega', () => T('GET', '/api/tienda/planes/dom-bod/preguntas'), (r) => r.status === 200 && r.documentos?.length === 1);
  paso('sin domicilio → 400', () => T('POST', '/api/tienda/compras', { plan: 'dom-bod', tipo: 'persona', titular: { nombre: 'X', rut: '19.876.543-0', email: 'x@ejemplo.test' } }), (r) => r.status === 400 && /domicilio/i.test(r.error));
  paso('plan inexistente → 400', () => T('GET', '/api/tienda/planes/no-existe/preguntas'), (r) => r.status === 400);
  paso('RUT inválido → 400', () => comprar({ plan: 'dom-bod', tipo: 'persona', titular: { nombre: 'X', rut: '11.111.111-2', email: 'x@ejemplo.test' } }), (r) => r.status === 400);
  paso('compra bodega (persona, entrega automática)', () => comprar({
    plan: 'dom-bod', tipo: 'persona', region: 'metropolitana', pago: { modo: 'total', medio: 'tbk' }, titular: VALENTINA
  }), (r) => r.status === 201 && r.documentos?.[0]?.publicado === true && r.cuenta === 'documento_enviado');
  paso('compra oficina (empresa, con revisión, pago 50/50)', () => comprar({
    plan: 'dom-anual', tipo: 'empresa', region: 'valparaiso', pago: { modo: 'split', medio: 'mp' },
    titular: { nombre: 'Rodrigo Pérez Lagos', rut: '15.432.109-8', email: 'rodrigo.perez@ejemplo.test' },
    empresa: { rut: '77.123.456-9', razon_social: 'Lagos & Pérez Consultores SpA', giro: 'Asesorías' }
  }), (r) => r.status === 201 && r.documentos?.[0]?.publicado === false && r.monto === 29995);
  paso('plan sin documentos (contabilidad)', () => comprar({ plan: 'cont-bas', tipo: 'persona', titular: VALENTINA }), (r) => r.status === 201 && r.documentos.length === 0);
  paso('RUT existente con otro correo → 409', () => comprar({ plan: 'dom-bod', tipo: 'persona', titular: { nombre: 'Intruso', rut: '19.876.543-0', email: 'otro@ejemplo.test' } }), (r) => r.status === 409);
  paso('plan cotizable no crea contrato', () => comprar({ plan: 'emp-ases', tipo: 'persona', titular: { ...VALENTINA, nombre: 'Ana' } }), (r) => r.status === 201 && r.cotizacion === true);
});

describe('Portal · persona: borrador, aceptar, descargar', () => {
  paso('crea su contraseña con el enlace del correo', () => P('POST', '/api/cliente/clave/definir', { token: ultimoToken(VALENTINA.email), password: 'Valentina-2026' }));
  const panel = paso('el panel muestra el documento por revisar', () => P('GET', '/api/cliente/panel'), (r) => r.documentos?.some((d) => d.estado_cliente === 'por_revisar'));
  const doc = () => panel.documentos.find((d) => d.estado_cliente === 'por_revisar');
  paso('borrador HTML con marca de agua y CSP', () => P('GET', `/api/cliente/documentos/${doc().id}/borrador`, undefined, { crudo: true }),
    (r) => r.status === 200 && r.texto.includes('BORRADOR') && r.texto.includes('VALENTINA SOTO') && r.texto.includes('LOS AROMOS') && /default-src 'none'/.test(r.cabeceras.get('content-security-policy') || ''));
  paso('descargar antes de aceptar → 403', () => P('GET', `/api/cliente/documentos/${doc().id}/archivo`, undefined, { crudo: true }), (r) => r.status === 403);
  paso('aceptar sin casilla → 400', () => P('POST', `/api/cliente/documentos/${doc().id}/aceptar`, {}), (r) => r.status === 400);
  const d1 = {};
  paso('aceptar con casilla', () => { d1.id = doc().id; return P('POST', `/api/cliente/documentos/${d1.id}/aceptar`, { acepto: true }); });
  paso('aceptar dos veces → 409', () => P('POST', `/api/cliente/documentos/${d1.id}/aceptar`, { acepto: true }), (r) => r.status === 409);
  paso('descarga el Word final', () => P('GET', `/api/cliente/documentos/${d1.id}/archivo`, undefined, { crudo: true }), (r) => r.status === 200 && /wordprocessingml/.test(r.tipo) && r.largo > 5000);
  paso('documento ajeno → 404', () => P('GET', '/api/cliente/documentos/1/borrador', undefined, { crudo: true }), (r) => r.status === 404);
});

describe('Personal y empresa: publicar, ticket, nueva versión', () => {
  const dEmp = {}, kEmp = {}, pOf = {};
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  it('el documento de la empresa queda sin publicar', async () => {
    const docs = await A('GET', '/api/crm/documentos');
    Object.assign(dEmp, docs.documentos.find((d) => /^lagos/i.test(d.cliente || '')));
    const r = await A('GET', '/api/crm/documentos/' + dEmp.id);
    assert.equal(r.documento.estado_cliente, null);
    assert.equal(r.documento.entrega, 'revision');
  });
  paso('ver borrador (personal)', () => A('GET', `/api/crm/documentos/${dEmp.id}/borrador`, undefined, { crudo: true }), (r) => r.status === 200 && r.texto.includes('LAGOS'));
  paso('aprobar y publicar al cliente', () => A('POST', `/api/crm/documentos/${dEmp.id}/publicar`), (r) => r.status === 200 && r.aprobado === true);
  paso('publicar dos veces → 409', () => A('POST', `/api/crm/documentos/${dEmp.id}/publicar`), (r) => r.status === 409);
  paso('representante crea contraseña', () => E('POST', '/api/cliente/clave/definir', { token: ultimoToken('rodrigo.perez@ejemplo.test'), password: 'Rodrigo-2026x' }));
  paso('ticket sin detalle → 400', () => E('POST', `/api/cliente/documentos/${dEmp.id}/ticket`, { motivo: 'datos_incorrectos' }), (r) => r.status === 400);
  const tic = paso('envía ticket (no está de acuerdo)', () => E('POST', `/api/cliente/documentos/${dEmp.id}/ticket`, { motivo: 'datos_incorrectos', detalle: 'El giro es Consultoría tributaria.' }));
  paso('ya no puede aceptar con ticket abierto → 409', () => E('POST', `/api/cliente/documentos/${dEmp.id}/aceptar`, { acepto: true }), (r) => r.status === 409);
  paso('ve su ticket', () => E('GET', '/api/cliente/tickets'), (r) => r.tickets?.length === 1 && r.tickets[0].estado === 'abierto');
  paso('el personal ve los tickets pendientes', () => A('GET', '/api/crm/tickets?estado=pendientes'), (r) => r.pendientes >= 1 && r.tickets.some((t) => t.id === tic.id));
  paso('resolver sin respuesta → 400', () => A('PATCH', '/api/crm/tickets/' + tic.id, { estado: 'resuelto' }), (r) => r.status === 400);
  paso('responde y resuelve', () => A('PATCH', '/api/crm/tickets/' + tic.id, { estado: 'resuelto', respuesta: 'Corregimos el giro y le enviamos una nueva versión.' }));
  paso('documento objetado y devuelto a rechazado', () => A('GET', '/api/crm/documentos/' + dEmp.id), (r) => r.documento?.estado_cliente === 'objetado' && r.documento?.estado === 'rechazado');
  it('regenerar (versión 2) deja el documento sin publicar', async () => {
    Object.assign(kEmp, (await A('GET', '/api/crm/contratos?q=LAGOS')).contratos[0]);
    Object.assign(pOf, (await A('GET', '/api/crm/plantillas-word')).plantillas.find((p) => /OFICINA/.test(p.tipo_documento)));
    const r = await A('POST', `/api/crm/contratos/${kEmp.id}/generar`, { plantilla_id: pOf.id });
    assert.equal(r.version, 2, r.error);
    assert.equal(r.publicado, false);
  });
  paso('volver a publicar', () => A('POST', `/api/crm/documentos/${dEmp.id}/publicar`));
  paso('la empresa acepta la versión corregida', () => E('POST', `/api/cliente/documentos/${dEmp.id}/aceptar`, { acepto: true }));
  paso('no se regenera un documento aceptado → 409', () => A('POST', `/api/crm/contratos/${kEmp.id}/generar`, { plantilla_id: pOf.id }), (r) => r.status === 409);
  paso('ticket general (sin documento)', () => E('POST', '/api/cliente/tickets', { motivo: 'otro', detalle: 'Consulta general.' }));
});

describe('Administración · documentos de la tienda', () => {
  const veh = {}, mapa = {}, resp = {};
  paso('lista documentos de la tienda', () => A('GET', '/api/crm/admin/documentos-tienda'), (r) => {
    Object.assign(veh, r.plantillas?.find((p) => /VEH/.test(p.tipo_documento)));
    return r.plantillas?.length >= 4 && r.planes?.length >= 5;
  });
  paso('campos del contrato de vehículo (sugeridos)', () => A('GET', `/api/crm/admin/plantillas/${veh.id}/campos`), (r) => {
    for (const m of r.marcas || []) mapa[m.marca] = { dato: m.dato, etiqueta: m.etiqueta };
    return r.marcas?.length === 23 && r.marcas.find((m) => m.marca === '[RUT EMPRESA]')?.dato === 'RUT' && r.marcas.find((m) => m.marca === '[PATENTE]')?.dato === '_ejecutivo';
  });
  paso('automática con datos del personal → 400', () => A('PUT', `/api/crm/admin/plantillas/${veh.id}/tienda`, { entrega: 'automatica', planes: ['dig-not'], mapa }), (r) => r.status === 400);
  paso('configurar vehículo (el cliente responde en la tienda)', () => {
    for (const m of Object.keys(mapa)) if (mapa[m].dato === '_ejecutivo') mapa[m] = { dato: '_tienda', etiqueta: mapa[m].etiqueta };
    mapa['[X]'] = { dato: '_ignorar' };
    return A('PUT', `/api/crm/admin/plantillas/${veh.id}/tienda`, { entrega: 'automatica', planes: ['dig-not'], mapa });
  });
  paso('plan inexistente → 400', () => A('PUT', `/api/crm/admin/plantillas/${veh.id}/tienda`, { entrega: 'revision', planes: ['xx'], mapa }), (r) => r.status === 400);
  paso('el plan ahora pregunta los datos del vehículo', () => T('GET', '/api/tienda/planes/dig-not/preguntas'), (r) => {
    for (const q of r.preguntas || []) resp[q.marca] = q.marca === '[PATENTE]' ? 'KXRT-55' : 'Dato ' + q.etiqueta;
    return r.preguntas?.some((q) => q.marca === '[PATENTE]');
  });
  paso('compra con respuestas → documento publicado', () => comprar({ plan: 'dig-not', tipo: 'persona', titular: VALENTINA, respuestas: resp }),
    (r) => r.status === 201 && r.documentos?.[0]?.publicado === true && r.cuenta === 'con_clave');
  it('borrador del vehículo con la patente', async () => {
    const dv = (await P('GET', '/api/cliente/panel')).documentos.find((d) => /VEH/.test(d.tipo));
    const r = await P('GET', `/api/cliente/documentos/${dv.id}/borrador`, undefined, { crudo: true });
    assert.equal(r.status, 200);
    assert.ok(r.texto.includes('KXRT-55') && !r.texto.includes('[PATENTE]') && r.texto.includes('[X]'));
  });
  it('preguntas al generar (vehículo, ya respondidas)', async () => {
    const kVeh = (await A('GET', '/api/crm/contratos?q=SOTO')).contratos.find((k) => /NOTARIAL/i.test(k.servicios || ''));
    const r = await A('GET', `/api/crm/plantillas/${veh.id}/preguntas?contrato=${kVeh.id}`);
    assert.equal(r.preguntas.find((q) => q.marca === '[PATENTE]')?.valor, 'KXRT-55');
  });

  describe('ejecutivo', () => {
    paso('login', () => X('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }));
    paso('ve los tickets de los clientes web que se le asignaron', () => X('GET', '/api/crm/tickets'), (r) => r.status === 200 && r.tickets.length > 0);
    paso('documentos de la tienda → 403', () => X('GET', '/api/crm/admin/documentos-tienda'), (r) => r.status === 403);
    paso('publicar documento ajeno → 404', () => X('POST', '/api/crm/documentos/1/publicar'), (r) => r.status === 404);
  });
});
