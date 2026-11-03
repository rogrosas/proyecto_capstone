/* La compra queda vinculada a la cuenta del cliente, o el documento llega a su correo; revisión pendiente desde el CRM. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const PizZip = require('pizzip');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const espera = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const T = perezosa(), P = perezosa(), E = perezosa(), A = perezosa();
const DIR = {};
const CAMI = { nombre: 'Camila Díaz Paredes', rut: '18.765.432-7', email: 'camila.diaz@ejemplo.test', celular: '+56 9 7654 3210' };
const ROD = { nombre: 'Rodrigo Pérez Lagos', rut: '15.432.109-8', email: 'rodrigo.perez@ejemplo.test' };
const comprar = (datos) => entorno.comprarYPagar(T, { direccion: DIR, ...datos });
// Correos de una persona llegados después de una marca: correosDesde(email, n) con n = cantidad previa
const cantidad = (email) => ctx.correos(email).length;
const nuevos = (email, desde) => ctx.correos(email).slice(desde);

describe('A · sin cuenta, entrega automática: el documento llega al correo', () => {
  it('domicilio en Buin', async () => {
    const comunas = (await T('GET', '/api/tienda/comunas')).comunas;
    Object.assign(DIR, { calle: 'El Fogonero', numero: '311', comuna_id: comunas.find((c) => c.nombre === 'Buin')?.id });
    assert.ok(DIR.comuna_id);
  });
  paso('compra bodega → documento_enviado', () => comprar({ plan: 'dom-bod', tipo: 'persona', titular: CAMI }),
    (r) => r.status === 201 && r.cuenta === 'documento_enviado' && r.documentos?.[0]?.publicado === true);
  it('un solo correo, con el borrador Word adjunto (marca de agua y datos) y el enlace para la contraseña', async () => {
    await espera();
    const correos = ctx.correos(CAMI.email);
    assert.equal(correos.length, 1);
    const [c] = correos;
    assert.equal(c.adjuntos.length, 1);
    assert.ok(c.token, 'trae el enlace');
    const z = new PizZip(fs.readFileSync(c.adjuntos[0]));
    const encabezados = Object.keys(z.files).filter((n) => /^word\/header/.test(n)).map((n) => z.file(n).asText()).join('');
    const doc = z.file('word/document.xml').asText();
    assert.ok(encabezados.includes('string="BORRADOR"'));
    assert.ok(/CAMILA D/.test(doc) && doc.includes('EL FOGONERO'));
  });
  paso('el enlace del correo crea la contraseña', () => P('POST', '/api/cliente/clave/definir', { token: ctx.correos(CAMI.email).at(-1).token, password: 'Camila-Prueba-1' }));
  paso('panel: documento por revisar', () => P('GET', '/api/cliente/panel'), (r) => r.documentos?.some((d) => d.estado_cliente === 'por_revisar'));
});

describe('B y C · con cuenta', () => {
  let antes;
  paso('compra como empresa nueva → vinculada a su cuenta', () => {
    antes = cantidad(CAMI.email);
    return comprar({ plan: 'dom-anual', tipo: 'empresa', titular: CAMI, empresa: { rut: '76.543.210-3', razon_social: 'Díaz Diseño SpA', giro: 'Diseño' } });
  }, (r) => r.status === 201 && r.cuenta === 'vinculada');
  paso('entra como empresa con la misma contraseña', () => E('POST', '/api/cliente/ingresar', { tipo: 'empresa', rut: '76.543.210-3', email: CAMI.email, password: 'Camila-Prueba-1' }));
  paso('panel de la empresa con su contrato', () => E('GET', '/api/cliente/panel'), (r) => r.cliente?.razon_social === 'Díaz Diseño SpA' && r.contratos?.length === 1);
  it('no recibió correos con enlace (ya tiene cuenta)', async () => { await espera(); assert.equal(nuevos(CAMI.email, antes).length, 0); });
  paso('vuelve a comprar como persona → con_clave', () => { antes = cantidad(CAMI.email); return comprar({ plan: 'dom-bod', tipo: 'persona', titular: CAMI }); },
    (r) => r.status === 201 && r.cuenta === 'con_clave');
  it('aviso "Ir a Mi cuenta" sin adjunto', async () => {
    await espera();
    const c = nuevos(CAMI.email, antes);
    assert.equal(c.length, 1);
    assert.equal(c[0].adjuntos.length, 0);
    assert.ok(c[0].html.includes('Ir a Mi cuenta'));
  });
});

describe('D y E · revisión pendiente en el CRM y publicación', () => {
  const dRod = {}, dCami = {}, kRod = {};
  let antes;
  paso('empresa sin cuenta, plan con revisión → enlace_enviado', () => comprar({
    plan: 'dom-anual', tipo: 'empresa', titular: ROD, empresa: { rut: '77.123.456-9', razon_social: 'Lagos y Pérez SpA' }
  }), (r) => r.status === 201 && r.cuenta === 'enlace_enviado' && r.documentos?.[0]?.publicado === false);
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  it('la lista de clientes marca los documentos por revisar y los pone primero', async () => {
    const r = await A('GET', '/api/crm/clientes');
    const conPend = r.clientes.filter((c) => c.docs_por_revisar > 0);
    assert.ok(conPend.length >= 2);
    assert.ok(r.clientes.slice(0, conPend.length).every((c) => c.docs_por_revisar > 0));
    const filtro = await A('GET', '/api/crm/clientes?estado=' + encodeURIComponent('Por revisar'));
    assert.equal(filtro.clientes.length, conPend.length);
  });
  it('el tablero enlaza cada pendiente con su documento', async () => {
    const docs = (await A('GET', '/api/crm/documentos')).documentos;
    Object.assign(dRod, docs.find((d) => /^lagos y p/i.test(d.cliente || '')));
    Object.assign(dCami, docs.find((d) => /^díaz diseño/i.test(d.cliente || '')));
    const t = await A('GET', '/api/crm/dashboard');
    const lista = JSON.stringify(t.cuerpo);
    assert.ok(lista.includes(`"documento_id":${dRod.id}`));
  });
  paso('la ficha del cliente trae el pendiente', async () => {
    kRod.id = (await A('GET', '/api/crm/clientes?q=' + encodeURIComponent('Lagos y Pérez'))).clientes[0].id;
    return A('GET', '/api/crm/clientes/' + kRod.id);
  },
    (r) => r.status === 200 && r.documentos?.some((d) => d.id === dRod.id && d.por_revisar));
  paso('borrador visible en el CRM', () => A('GET', `/api/crm/documentos/${dRod.id}/borrador`, undefined, { crudo: true }), (r) => r.status === 200 && r.texto.includes('BORRADOR'));
  paso('aprobar y publicar el de la empresa sin cuenta', () => { antes = cantidad(ROD.email); return A('POST', `/api/crm/documentos/${dRod.id}/publicar`); },
    (r) => r.status === 200 && r.aprobado === true && r.enviado_por_correo === true);
  it('el documento le llega adjunto al representante', async () => {
    await espera();
    const c = nuevos(ROD.email, antes);
    assert.equal(c.length, 1);
    assert.equal(c[0].adjuntos.length, 1);
    assert.match(c[0].adjuntos[0], /Borrador/);
  });
  paso('el documento queda aprobado con su revisor', () => A('GET', '/api/crm/documentos/' + dRod.id), (r) => r.documento?.estado === 'aprobado' && !!r.documento?.revisado_por);
  paso('publicar el de la empresa vinculada', () => { antes = cantidad(CAMI.email); return A('POST', `/api/crm/documentos/${dCami.id}/publicar`); });
  it('aviso sin adjunto (tiene cuenta)', async () => {
    await espera();
    const c = nuevos(CAMI.email, antes);
    assert.equal(c.length, 1);
    assert.equal(c[0].adjuntos.length, 0);
  });
  it('ya no quedan pendientes de revisión', async () => {
    const r = await A('GET', '/api/crm/clientes?estado=' + encodeURIComponent('Por revisar'));
    assert.ok(!r.clientes.some((c) => c.id === kRod.id));
  });
});
