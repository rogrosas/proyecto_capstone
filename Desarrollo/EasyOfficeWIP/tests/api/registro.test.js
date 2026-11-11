/* Registro en Mi cuenta (persona o empresa): validaciones, confirmación por correo y primer ingreso. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

// Cada grupo desde su IP: el límite de solicitudes por IP no interfiere entre grupos
let ipN = 10;
const desde = () => { let s; const ip = `10.9.0.${ipN++}`; return (...a) => (s ||= ctx.sesion({ ip }))(...a); };

// RUT válido a partir del cuerpo: 16123456 -> '16.123.456-X'
function rut(cuerpo) {
  let suma = 0, mult = 2;
  const c = String(cuerpo);
  for (let i = c.length - 1; i >= 0; i--) { suma += Number(c[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const r = 11 - (suma % 11);
  return `${Number(c).toLocaleString('es-CL')}-${r === 11 ? '0' : r === 10 ? 'K' : r}`;
}
const tokenRegistro = (email) => (ctx.correos(email).at(-1)?.html.match(/registro=([A-Za-z0-9_-]+)/) || [])[1];

const PERSONA = {
  tipo: 'persona', nombre: 'Valentina Rojas Soto', rut: rut(16123456), email: 'valentina.rojas@ejemplo.test',
  celular: '+56 9 8123 4567', password: 'Valentina-2026', acepta: true, comunicaciones: true
};
const EMPRESA = {
  tipo: 'empresa', nombre: 'Matías Fuentes Lara', rut: rut(14222333), email: 'matias.fuentes@ejemplo.test',
  celular: '987654321', password: 'Matias-Clave-9', acepta: true, representante: true,
  empresa: { rut: rut(77111222), razon_social: 'Fuentes y Lara SpA', giro: 'Asesorías' }
};

describe('Validaciones del registro', () => {
  const V = desde();
  const rechaza = (nombre, cambios, patron) =>
    paso(nombre, () => V('POST', '/api/cliente/registro', { ...PERSONA, email: 'validar@ejemplo.test', ...cambios }),
      (r) => r.status === 400 && patron.test(r.error));
  rechaza('tipo inválido', { tipo: '__proto__' }, /empresa o como persona/);
  rechaza('RUT con dígito verificador malo', { rut: PERSONA.rut.slice(0, -1) + (PERSONA.rut.endsWith('0') ? '1' : '0') }, /no es válido/);
  rechaza('RUT de empresa como persona', { rut: rut(76543210) }, /regístrese como empresa/);
  rechaza('nombre sin apellido', { nombre: 'Valentina' }, /apellido/);
  rechaza('nombre con números', { nombre: 'Valentina R0jas' }, /solo puede tener letras/);
  rechaza('correo inválido', { email: 'valentina@' }, /Correo no es válido/);
  rechaza('celular inválido', { celular: '22345678' }, /9 dígitos/);
  rechaza('celular obligatorio', { celular: '' }, /obligatorio/);
  rechaza('contraseña corta', { password: 'abc123' }, /8 caracteres/);
  rechaza('contraseña sin números', { password: 'solamenteletras' }, /letras y números/);
  rechaza('sin aceptar las condiciones', { acepta: false }, /aceptar las condiciones/);
  rechaza('empresa con RUT de persona', { ...EMPRESA, email: 'validar@ejemplo.test', empresa: { ...EMPRESA.empresa, rut: rut(15000111) } }, /persona jurídica/);
  rechaza('empresa sin razón social', { ...EMPRESA, email: 'validar@ejemplo.test', empresa: { ...EMPRESA.empresa, razon_social: '' } }, /Razón social es obligatorio/);
  rechaza('empresa sin declarar representante', { ...EMPRESA, email: 'validar@ejemplo.test', representante: false }, /representante legal/);
  rechaza('representante con RUT de empresa', { ...EMPRESA, email: 'validar@ejemplo.test', rut: rut(78000111) }, /de una persona/);
  it('no envió correos ni creó clientes', async () => {
    assert.equal(ctx.correos('validar@ejemplo.test').length, 0);
    assert.equal((await entorno.sql("SELECT count(*)::int AS n FROM clientes WHERE email = 'validar@ejemplo.test'"))[0].n, 0);
  });
});

describe('Registro de persona', () => {
  const P = desde();
  paso('solicita el registro → 202 y correo de confirmación', () => P('POST', '/api/cliente/registro', PERSONA),
    (r) => r.status === 202 && /Le enviamos un correo/.test(r.mensaje));
  it('el cliente aún no existe (falta confirmar el correo)', async () => {
    assert.ok(tokenRegistro(PERSONA.email));
    assert.equal((await entorno.sql('SELECT count(*)::int AS n FROM clientes WHERE rut = $1', [PERSONA.rut.replace(/\./g, '')]))[0].n, 0);
  });
  paso('enlace inválido → 401', () => P('POST', '/api/cliente/registro/confirmar', { token: 'no-existe' }), (r) => r.status === 401);
  paso('confirma con el enlace → 201 con la sesión iniciada', () => P('POST', '/api/cliente/registro/confirmar', { token: tokenRegistro(PERSONA.email) }),
    (r) => r.status === 201 && r.cliente?.razon_social === PERSONA.nombre && r.cliente.tipo === 'natural');
  paso('el enlace sirve una sola vez', () => P('POST', '/api/cliente/registro/confirmar', { token: tokenRegistro(PERSONA.email) }), (r) => r.status === 401);
  paso('ve su panel (sin contratos)', () => P('GET', '/api/cliente/panel'), (r) => r.status === 200 && r.contratos.length === 0);
  it('cliente web con celular normalizado y consentimiento con fecha', async () => {
    const [c] = await entorno.sql('SELECT origen, celular, acepta_comunicaciones, consentimiento_en FROM clientes WHERE rut = $1', [PERSONA.rut.replace(/\./g, '')]);
    assert.equal(c.origen, 'web');
    assert.equal(c.celular, '981234567');
    assert.equal(c.acepta_comunicaciones, true);
    assert.ok(c.consentimiento_en);
  });
  paso('ingresa después con su correo y contraseña', () => desde()('POST', '/api/cliente/ingresar', { tipo: 'persona', email: PERSONA.email, password: PERSONA.password }));
  paso('no puede registrar dos veces el mismo RUT → 409', () => P('POST', '/api/cliente/registro', PERSONA), (r) => r.status === 409 && /ya tiene una cuenta/.test(r.error));
});

describe('Registro de empresa', () => {
  const E = desde();
  paso('solicita el registro → 202', () => E('POST', '/api/cliente/registro', EMPRESA), (r) => r.status === 202);
  paso('confirma → sesión de la empresa', () => E('POST', '/api/cliente/registro/confirmar', { token: tokenRegistro(EMPRESA.email) }),
    (r) => r.status === 201 && r.cliente?.razon_social === 'Fuentes y Lara SpA' && r.cliente.tipo === 'juridica');
  paso('ingresa con el RUT de la empresa y su correo', () => desde()('POST', '/api/cliente/ingresar',
    { tipo: 'empresa', rut: EMPRESA.empresa.rut, email: EMPRESA.email, password: EMPRESA.password }));
  it('la empresa queda con su representante legal', async () => {
    const [c] = await entorno.sql(`SELECT c.giro_principal, r.nombre_completo, r.email::text FROM clientes c
      JOIN representantes_legales r ON r.id = c.representante_legal_id WHERE c.rut = $1`, [EMPRESA.empresa.rut.replace(/\./g, '')]);
    assert.deepEqual(c, { giro_principal: 'Asesorías', nombre_completo: EMPRESA.nombre, email: EMPRESA.email });
  });
  paso('otra empresa con un representante ya registrado con otro correo → 409', () => desde()('POST', '/api/cliente/registro', {
    ...EMPRESA, email: 'otro.correo@ejemplo.test', empresa: { ...EMPRESA.empresa, rut: rut(77333444), razon_social: 'Otra SpA' }
  }), (r) => r.status === 409 && /otro correo/.test(r.error));
});

describe('Límite de solicitudes', () => {
  it('más de 5 solicitudes con el mismo correo → 429', async () => {
    const L = desde();
    const datos = (i) => ({ ...PERSONA, email: 'muchas@ejemplo.test', rut: rut(17000000 + i) });
    for (let i = 1; i <= 5; i++) assert.equal((await L('POST', '/api/cliente/registro', datos(i))).status, 202);
    assert.equal((await L('POST', '/api/cliente/registro', datos(6))).status, 429);
  });
});
