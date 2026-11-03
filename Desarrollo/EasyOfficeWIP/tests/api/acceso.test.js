/* Acceso del personal: bloqueo por claves malas, verificación en dos pasos (HU-04) y recuperar la contraseña. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');
const totp = require('../../src/comun/totp');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

// Cada sesión desde otra IP: el límite por IP no interfiere con el bloqueo por usuario
let ipN = 10;
const desde = () => { let s; const ip = `10.0.0.${ipN++}`; return (...a) => (s ||= ctx.sesion({ ip }))(...a); };
const A = desde(), B = desde(), R = desde();
const sec = {};

describe('Bloqueo por contraseñas incorrectas', () => {
  it('5 claves malas seguidas bloquean la cuenta, aunque después la clave sea correcta', async () => {
    for (let i = 1; i <= 4; i++) assert.equal((await B('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: 'mala-' + i })).status, 401);
    const quinta = await B('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: 'mala-5' });
    assert.equal(quinta.status, 429);
    const correcta = await B('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] });
    assert.equal(correcta.status, 429);
    assert.match(correcta.error, /bloqueada/);
  });
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('el administrador la ve bloqueada', () => A('GET', '/api/crm/admin/usuarios'), (r) => r.usuarios.find((u) => u.email === ctx.cred.ejec[0])?.bloqueado === true);
  paso('y la desbloquea', async () => {
    const u = (await A('GET', '/api/crm/admin/usuarios')).usuarios.find((x) => x.email === ctx.cred.ejec[0]);
    return A('PATCH', `/api/crm/admin/usuarios/${u.id}`, { desbloquear: true });
  });
  paso('vuelve a ingresar', () => B('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }), (r) => r.status === 200 && r.usuario);
});

describe('Verificación en dos pasos (TOTP)', () => {
  paso('disponible e inactiva', () => A('GET', '/api/crm/yo/seguridad'), (r) => r.totp_disponible === true && r.totp_activo === false);
  paso('iniciar: entrega la clave para la aplicación', () => A('POST', '/api/crm/yo/totp/iniciar'), (r) => {
    sec.secreto = (r.secreto || '').replace(/\s/g, '');
    return r.status === 200 && /^[A-Z2-7]{32}$/.test(sec.secreto) && r.uri.startsWith('otpauth://totp/');
  });
  paso('código incorrecto → 400', () => A('POST', '/api/crm/yo/totp/activar', { codigo: '000000' }), (r) => r.status === 400);
  paso('código correcto → activa', () => A('POST', '/api/crm/yo/totp/activar', { codigo: totp.codigo(sec.secreto) }));
  it('el secreto queda cifrado en la base', async () => {
    const [u] = await entorno.sql('SELECT totp_activo, totp_secreto FROM usuarios WHERE email = $1', [ctx.cred.admin[0]]);
    assert.equal(u.totp_activo, true);
    assert.match(u.totp_secreto, /^v1:/);
    assert.ok(!u.totp_secreto.includes(sec.secreto));
  });
  paso('ingreso: después de la clave pide el código (sin abrir sesión)', () => R('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }), (r) => {
    sec.desafio = r.desafio;
    return r.status === 200 && r.requiereCodigo === true && !r.usuario && !r.cabeceras.get('set-cookie');
  });
  paso('sin el código no hay sesión', () => R('GET', '/api/crm/yo'), (r) => r.status === 401);
  paso('código incorrecto → 401', () => R('POST', '/api/crm/login/codigo', { desafio: sec.desafio, codigo: '111111' }), (r) => r.status === 401 && /incorrecto/.test(r.error));
  paso('código correcto → sesión', () => R('POST', '/api/crm/login/codigo', { desafio: sec.desafio, codigo: totp.codigo(sec.secreto) }), (r) => r.status === 200 && r.usuario?.admin === true);
  paso('el desafío no se reutiliza', () => desde()('POST', '/api/crm/login/codigo', { desafio: sec.desafio, codigo: totp.codigo(sec.secreto) }), (r) => r.status === 401);
  paso('desactivar exige el código', () => R('POST', '/api/crm/yo/totp/desactivar', { codigo: '123456' }), (r) => r.status === 400);
  paso('desactivar con el código', () => R('POST', '/api/crm/yo/totp/desactivar', { codigo: totp.codigo(sec.secreto) }));
  paso('ya no pide código', () => desde()('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }), (r) => r.status === 200 && r.usuario);
  paso('el ejecutivo no puede quitar el segundo factor de otro → 403', () => B('PATCH', '/api/crm/admin/usuarios/1', { quitar_totp: true }), (r) => r.status === 403);
});

describe('Recuperar la contraseña', () => {
  const C = desde();
  let enlace;
  paso('un correo desconocido recibe la misma respuesta', () => C('POST', '/api/crm/clave', { email: 'nadie@easyoffice.test' }),
    (r) => r.status === 200 && /Si el correo/.test(r.mensaje) && ctx.correos('nadie@easyoffice.test').length === 0);
  paso('pedir el enlace', () => C('POST', '/api/crm/clave', { email: ctx.cred.ejec[0] }), (r) => {
    const c = ctx.correos(ctx.cred.ejec[0]).at(-1);
    enlace = c && (c.html.match(/crm\?clave=([A-Za-z0-9_.-]+)/) || [])[1];
    return r.status === 200 && !!enlace;
  });
  paso('clave corta → 400', () => C('POST', '/api/crm/clave/definir', { token: enlace, password: 'corta' }), (r) => r.status === 400);
  paso('enlace alterado → 401', () => C('POST', '/api/crm/clave/definir', { token: enlace.slice(0, -2) + 'xx', password: 'Nueva-Clave-2026' }), (r) => r.status === 401);
  paso('define la nueva contraseña', () => C('POST', '/api/crm/clave/definir', { token: enlace, password: 'Nueva-Clave-2026' }));
  paso('el enlace sirve una sola vez', () => C('POST', '/api/crm/clave/definir', { token: enlace, password: 'Otra-Clave-2026' }), (r) => r.status === 401);
  paso('la clave anterior ya no sirve', () => desde()('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }), (r) => r.status === 401);
  paso('ingresa con la nueva', () => desde()('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: 'Nueva-Clave-2026' }), (r) => r.status === 200 && r.usuario);
});
