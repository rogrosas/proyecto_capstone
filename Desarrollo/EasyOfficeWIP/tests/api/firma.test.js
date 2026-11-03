/* Firma electrónica con el simulador (TT-05), verificación pública (HU-22) y saldo de firmas (HU-32). */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const PizZip = require('pizzip');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const T = perezosa(), P = perezosa(), A = perezosa(), E = perezosa(), X = perezosa(), F = perezosa();
const DIR = {};
const VALE = { nombre: 'Valentina Soto Muñoz', rut: '19.876.543-0', email: 'valentina.soto@ejemplo.test' };
const ROD = { nombre: 'Rodrigo Pérez Lagos', rut: '15.432.109-8', email: 'rodrigo.perez@ejemplo.test' };
const tokenClave = (email) => ctx.correos(email).find((c) => c.token)?.token;
// Enlace del correo "Tiene un documento para firmar" (lo envía la plataforma simulada)
const tokenFirma = (email) => {
  const c = ctx.correos(email).filter((x) => /para firmar/.test(x.asunto)).at(-1);
  return c && (c.html.match(/firma-simulada\?t=([A-Za-z0-9_.-]+)/) || [])[1];
};
const doc = {}, firmado = {}, dEmp = {};
let tk;

describe('Firma de un documento de la tienda', () => {
  it('compra con entrega automática y cuenta del cliente', async () => {
    const comunas = (await T('GET', '/api/tienda/comunas')).comunas;
    Object.assign(DIR, { calle: 'Los Aromos', numero: '1450', comuna_id: comunas.find((c) => c.nombre === 'Providencia').id });
    const r = await entorno.comprarYPagar(T, { plan: 'dom-bod', tipo: 'persona', direccion: DIR, titular: VALE });
    assert.equal(r.status, 201, r.error);
    const d = await P('POST', '/api/cliente/clave/definir', { token: tokenClave(VALE.email), password: 'Valentina-2026' });
    assert.equal(d.status, 200, d.error);
    Object.assign(doc, (await P('GET', '/api/cliente/panel')).documentos.find((x) => x.estado_cliente === 'por_revisar'));
    assert.ok(doc.id);
  });
  it('preparar: el cliente tiene una bolsa de 5 firmas vigente', async () => {
    const [c] = await entorno.sql('SELECT id FROM clientes WHERE rut = $1', ['19876543-0']);
    await entorno.sql("INSERT INTO movimientos_firmas (cliente_id, motivo, cantidad, vence_en, detalle) VALUES ($1, 'compra', 5, CURRENT_DATE + 365, 'Bolsa de prueba')", [c.id]);
    const p = await P('GET', '/api/cliente/panel');
    assert.deepEqual([p.firmas.compradas, p.firmas.disponibles], [5, 5]);
  });
  paso('al aceptar el borrador, el documento se envía solo a firma', () => P('POST', `/api/cliente/documentos/${doc.id}/aceptar`, { acepto: true }),
    (r) => r.status === 200 && r.en_firma === true);
  it('la plataforma le envía al firmante su enlace', () => {
    tk = tokenFirma(VALE.email);
    assert.ok(tk);
  });
  paso('Mi cuenta muestra el documento en firma con el botón para firmar', () => P('GET', '/api/cliente/panel'), (r) => {
    const d = r.documentos.find((x) => x.id === doc.id);
    return d.estado === 'enviado_firma' && d.firma.firmantes[0].estado === 'pendiente' && /firma-simulada\?t=/.test(d.firma.enlace || '');
  });
  paso('la página del simulador muestra firmante y documento', () => F('GET', `/api/firma/simulador/${tk}`),
    (r) => r.status === 200 && r.firmante.nombre === VALE.nombre && r.estado === 'pendiente' && r.firmante.rut === '19.876.543-0');
  paso('vista del documento que se firma, sin marca de agua', () => F('GET', `/api/firma/simulador/${tk}/documento`, undefined, { crudo: true }),
    (r) => r.status === 200 && r.texto.includes('DOCUMENTO PARA FIRMA') && !r.texto.includes('BORRADOR PARA REVISIÓN') && /default-src 'none'/.test(r.cabeceras.get('content-security-policy')));
  paso('enlace alterado → 401', () => F('GET', `/api/firma/simulador/${tk.slice(0, -3)}abc`), (r) => r.status === 401);
  paso('firmar sin la casilla → 400', () => F('POST', `/api/firma/simulador/${tk}`, { accion: 'firmar', rut: VALE.rut }), (r) => r.status === 400);
  paso('firmar con otro RUT → 400', () => F('POST', `/api/firma/simulador/${tk}`, { accion: 'firmar', acepto: true, rut: '21.167.684-1' }), (r) => r.status === 400 && /RUT/.test(r.error));
  paso('firma → documento firmado con código de verificación', () => F('POST', `/api/firma/simulador/${tk}`, { accion: 'firmar', acepto: true, rut: '19876543-0' }), (r) => {
    firmado.codigo = r.codigo;
    return r.status === 200 && r.completo === true && /^EO-[0-9A-F]{4}-[0-9A-F]{4}$/.test(r.codigo);
  });
  paso('firmar dos veces → 409', () => F('POST', `/api/firma/simulador/${tk}`, { accion: 'firmar', acepto: true, rut: VALE.rut }), (r) => r.status === 409);
  it('el cliente recibe el aviso con el código', () => {
    const c = ctx.correos(VALE.email).filter((x) => /Documento firmado/.test(x.asunto));
    assert.equal(c.length, 1);
    assert.ok(c[0].html.includes(firmado.codigo));
  });
  paso('Mi cuenta: firmado, y la firma se descontó del saldo', () => P('GET', '/api/cliente/panel'), (r) => {
    const d = r.documentos.find((x) => x.id === doc.id);
    return d.estado === 'firmado' && d.con_firmado === true && d.codigo === firmado.codigo && r.firmas.disponibles === 4 && r.firmas.movimientos[0].motivo === 'consumo';
  });
  it('descarga el documento firmado, con su hoja de constancia', async () => {
    const r = await P('GET', `/api/cliente/documentos/${doc.id}/archivo`, undefined, { crudo: true });
    assert.equal(r.status, 200);
    const xml = new PizZip(r.buffer).file('word/document.xml').asText();
    assert.ok(xml.includes('CONSTANCIA DE FIRMA ELECTRÓNICA') && xml.includes(firmado.codigo) && xml.includes('SIMULADOR DE LABORATORIO'));
    firmado.hash = crypto.createHash('sha256').update(r.buffer).digest('hex');
  });
});

describe('Verificación pública por código', () => {
  paso('código válido: auténtico, con la misma huella del archivo', () => F('GET', `/api/verificar/${firmado.codigo.toLowerCase()}`),
    (r) => r.status === 200 && r.valido === true && r.hash === firmado.hash && r.cliente === 'Valentina S. M.' && r.firmantes[0].nombre === 'Valentina S. M.' && !JSON.stringify(r.cuerpo).includes('19876543'));
  paso('código inexistente → no válido', () => F('GET', '/api/verificar/EO-0000-0000'), (r) => r.status === 200 && r.valido === false);
  paso('formato incorrecto → 400', () => F('GET', '/api/verificar/12345'), (r) => r.status === 400);
  paso('la página /verificar existe', () => F('GET', '/verificar', undefined, { crudo: true }), (r) => r.status === 200 && r.texto.includes('Verificar un documento'));
});

describe('CRM: firma de los documentos', () => {
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('el detalle muestra firmantes, plataforma y huella', () => A('GET', `/api/crm/documentos/${doc.id}`),
    (r) => r.firma?.firmantes?.[0]?.estado === 'firmado' && r.firma.proveedor === 'simulador' && r.firma.hash === firmado.hash && r.firma.impedimento === 'El documento ya está firmado.');
  paso('descarga del firmado desde el CRM', () => A('GET', `/api/crm/documentos/${doc.id}/firmado`, undefined, { crudo: true }), (r) => r.status === 200 && r.largo > 5000);
  paso('aparece entre los firmados', () => A('GET', '/api/crm/documentos?tipo=firmados'), (r) => r.documentos.some((d) => d.id === doc.id));
  paso('un documento sin Word no se envía a firma → 409', async () => {
    const op = (await A('GET', '/api/crm/opciones')).cuerpo;
    const cl = (await A('GET', '/api/crm/clientes')).clientes[0];
    const nd = await A('POST', '/api/crm/documentos', { cliente_id: cl.id, plantilla_id: op.plantillas.find((p) => p.nombre === 'PODER SIMPLE').id, datos: {} });
    return A('POST', `/api/crm/documentos/${nd.id}/firma`);
  }, (r) => r.status === 409 && /Word/.test(r.error));
  paso('aviso de la plataforma sin el secreto → 401', () => F('POST', '/api/firma/aviso', { firmante: 'x', evento: 'firmado' }), (r) => r.status === 401);
});

describe('El firmante rechaza: vuelve al personal con un ticket', () => {
  paso('compra de empresa con revisión', () => entorno.comprarYPagar(T, {
    plan: 'dom-anual', tipo: 'empresa', direccion: DIR, titular: ROD, empresa: { rut: '77.123.456-9', razon_social: 'Lagos y Pérez SpA' }
  }), (r) => r.status === 201);
  it('el personal aprueba y publica; el representante acepta', async () => {
    Object.assign(dEmp, (await A('GET', '/api/crm/documentos')).documentos.find((d) => /^lagos y p/i.test(d.cliente || '')));
    const imp = (await A('GET', `/api/crm/documentos/${dEmp.id}`)).firma.impedimento;
    assert.match(imp, /Publique el borrador/);
    assert.equal((await A('POST', `/api/crm/documentos/${dEmp.id}/publicar`)).status, 200);
    assert.equal((await E('POST', '/api/cliente/clave/definir', { token: tokenClave(ROD.email), password: 'Rodrigo-2026x' })).status, 200);
    const r = await E('POST', `/api/cliente/documentos/${dEmp.id}/aceptar`, { acepto: true });
    assert.equal(r.en_firma, true);
  });
  paso('rechazar sin motivo → 400', () => X('POST', `/api/firma/simulador/${tokenFirma(ROD.email)}`, { accion: 'rechazar' }), (r) => r.status === 400);
  paso('rechaza la firma con su motivo', () => X('POST', `/api/firma/simulador/${tokenFirma(ROD.email)}`, { accion: 'rechazar', motivo: 'La dirección de la oficina no es la que contraté.' }),
    (r) => r.status === 200 && r.evento === 'rechazado');
  paso('el documento queda rechazado y se abre un ticket para el personal', () => A('GET', '/api/crm/tickets?estado=pendientes'),
    (r) => r.tickets.some((t) => t.documento_id === dEmp.id && /rechazó la firma/.test(t.detalle) && /dirección/.test(t.detalle)));
  paso('estado del documento', () => A('GET', `/api/crm/documentos/${dEmp.id}`), (r) => r.documento.estado === 'rechazado' && r.firma.firmantes[0].estado === 'rechazado');
});
