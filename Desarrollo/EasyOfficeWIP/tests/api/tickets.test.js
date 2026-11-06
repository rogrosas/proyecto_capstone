/* Tickets como conversación: cada mensaje con su autor y hora, cambios de estado anotados y reapertura. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const T = perezosa(), C = perezosa(), A = perezosa(), X = perezosa();
const LUIS = { nombre: 'Luis Demo Vera', rut: '15.432.109-8', email: 'luis.demo@ejemplo.test' };
const tk = {};
const autores = (r) => r.mensajes.map((m) => m.autor_tipo).join(',');

describe('Ticket como conversación', () => {
  it('el cliente compra, entra a Mi cuenta y escribe una consulta', async () => {
    const comunas = (await T('GET', '/api/tienda/comunas')).comunas;
    const r = await entorno.comprarYPagar(T, { plan: 'dom-bod', tipo: 'persona', titular: LUIS,
      direccion: { calle: 'El Fogonero', numero: '311', comuna_id: comunas.find((c) => c.nombre === 'Buin').id } });
    assert.equal(r.status, 201, r.error);
    assert.equal((await C('POST', '/api/cliente/clave/definir', { token: ctx.correos(LUIS.email).find((c) => c.token).token, password: 'Luis-Demo-2026' })).status, 200);
    const t = await C('POST', '/api/cliente/tickets', { motivo: 'otro', detalle: '¿Me pueden enviar la factura?' });
    assert.equal(t.status, 200, t.error);
    tk.id = t.id;
  });
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('el CRM ve la conversación con el primer mensaje del cliente', () => A('GET', `/api/crm/tickets/${tk.id}`),
    (r) => r.status === 200 && autores(r) === 'cliente' && r.mensajes[0].autor === LUIS.email && /factura/.test(r.mensajes[0].texto));
  paso('la lista avisa que espera respuesta', () => A('GET', '/api/crm/tickets'), (r) => r.tickets.find((t) => t.id === tk.id)?.ultimo_autor === 'cliente');
  paso('sin mensaje ni estado → 400', () => A('PATCH', `/api/crm/tickets/${tk.id}`, {}), (r) => r.status === 400);
  paso('el personal responde: queda "en proceso" y anotado', () => A('PATCH', `/api/crm/tickets/${tk.id}`, { respuesta: 'Sí, se la enviamos hoy por correo.' }));
  paso('la conversación muestra quién respondió y el cambio de estado', () => A('GET', `/api/crm/tickets/${tk.id}`),
    (r) => autores(r) === 'cliente,personal,sistema' && r.mensajes[1].autor === 'Diego Muñoz' && /en proceso/.test(r.mensajes[2].texto) && r.ticket.estado === 'en_proceso');
  it('al cliente le llega la respuesta por correo', () => {
    assert.ok(ctx.correos(LUIS.email).some((c) => /Respuesta a su ticket/.test(c.asunto) && c.html.includes('se la enviamos hoy')));
  });
  paso('Mi cuenta muestra la conversación', () => C('GET', '/api/cliente/tickets'),
    (r) => r.tickets[0].conversacion.length === 3 && r.tickets[0].ultimo_autor === 'personal');
  paso('el cliente responde', () => C('POST', `/api/cliente/tickets/${tk.id}/mensajes`, { texto: 'Gracias, ¿puede ir a nombre de mi empresa?' }));
  it('su ejecutivo recibe la respuesta del cliente', () => {
    assert.ok(ctx.correos().some((c) => c.asunto === `Respuesta del cliente en el ticket #${tk.id} · ${LUIS.nombre}` && c.html.includes('a nombre de mi empresa')));
  });
  paso('mensaje vacío → 400', () => C('POST', `/api/cliente/tickets/${tk.id}/mensajes`, { texto: '  ' }), (r) => r.status === 400);
  paso('el personal lo marca resuelto (sin escribir: ya respondió antes)', () => A('PATCH', `/api/crm/tickets/${tk.id}`, { estado: 'resuelto' }));
  paso('el cliente vuelve a escribir: el ticket se reabre', () => C('POST', `/api/cliente/tickets/${tk.id}/mensajes`, { texto: 'Me falta el RUT de la empresa en la factura.' }));
  paso('queda abierto, con la reapertura anotada', () => A('GET', `/api/crm/tickets/${tk.id}`),
    (r) => r.ticket.estado === 'abierto' && r.mensajes.at(-1).autor_tipo === 'sistema' && /reabrió/.test(r.mensajes.at(-1).texto)
      && r.mensajes.filter((m) => m.autor_tipo === 'cliente').length === 3);
  paso('el personal responde y cierra en un paso', () => A('PATCH', `/api/crm/tickets/${tk.id}`, { respuesta: 'Listo, la reemitimos con el RUT.', estado: 'cerrado' }));
  paso('un ticket cerrado ya no admite mensajes del cliente → 409', () => C('POST', `/api/cliente/tickets/${tk.id}/mensajes`, { texto: 'Una cosa más' }), (r) => r.status === 409);
  paso('otro cliente no puede escribir en el ticket → 401/404', async () => {
    await X('POST', '/api/cliente/ingresar', { tipo: 'persona', email: 'nadie@ejemplo.test', password: 'x' });
    return X('POST', `/api/cliente/tickets/${tk.id}/mensajes`, { texto: 'Hola' });
  }, (r) => r.status === 401 || r.status === 404);
  it('cada mensaje queda en la auditoría', async () => {
    const [a] = await entorno.sql("SELECT count(*)::int AS n FROM registros_actividad WHERE tabla_afectada = 'ticket_mensajes' AND accion = 'INSERT'");
    const [m] = await entorno.sql('SELECT count(*)::int AS n FROM ticket_mensajes WHERE ticket_id = $1', [tk.id]);
    assert.ok(a.n >= m.n);
  });
});
