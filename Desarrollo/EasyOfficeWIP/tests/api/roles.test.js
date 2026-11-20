/* Asignación de roles: un cambio en Administración (rol, desactivar, contraseña) rige de inmediato,
   también para quien ya tiene la sesión abierta. Roles creados desde la app. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const A = perezosa(), E = perezosa(), S = perezosa();
const x = {};

describe('Cambiar el rol con la sesión abierta', () => {
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('login ejecutiva', () => E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }));
  paso('datos de usuarios y roles', () => A('GET', '/api/crm/admin/usuarios'), (r) => {
    x.ej = r.usuarios.find((u) => u.email === ctx.cred.ejec[0]);
    x.rol = Object.fromEntries(r.roles.map((ro) => [ro.rol, ro.id]));
    return !!x.ej && x.rol.admin && x.rol.ejecutivo;
  });
  paso('la ejecutiva no entra a Administración', () => E('GET', '/api/crm/admin/usuarios'), (r) => r.status === 403);
  paso('el administrador la sube a admin', () => A('PATCH', `/api/crm/admin/usuarios/${x.ej.id}`, { rol_id: x.rol.admin }));
  paso('sin volver a ingresar, ya es administradora', () => E('GET', '/api/crm/yo'), (r) => r.usuario?.rol === 'admin' && r.usuario.admin === true);
  paso('y entra a Administración', () => E('GET', '/api/crm/admin/usuarios'), (r) => r.status === 200);
  paso('la baja de nuevo a ejecutivo', () => A('PATCH', `/api/crm/admin/usuarios/${x.ej.id}`, { rol_id: x.rol.ejecutivo }));
  paso('pierde el acceso de administrador de inmediato', () => E('GET', '/api/crm/admin/usuarios'), (r) => r.status === 403);
  paso('y la base de datos la trata como ejecutiva (solo su cartera)', () => E('GET', '/api/crm/auditoria'), (r) => r.status === 403);
});

describe('Roles creados en la app', () => {
  paso('crear el rol "Supervisor" con permiso de responder tickets', async () => {
    const { permisos } = await A('GET', '/api/crm/admin/roles');
    return A('POST', '/api/crm/admin/roles', { rol: 'Supervisor', permisos: permisos.filter((p) => p.permiso === 'responder_tickets').map((p) => p.id) });
  }, (r) => { x.supervisor = r.id; return r.status === 201; });
  paso('queda en minúsculas y con su permiso', () => A('GET', '/api/crm/admin/roles'),
    (r) => r.roles.find((ro) => ro.id === x.supervisor)?.rol === 'supervisor' && r.roles.find((ro) => ro.id === x.supervisor).permisos.length === 1);
  paso('asignárselo a la ejecutiva', () => A('PATCH', `/api/crm/admin/usuarios/${x.ej.id}`, { rol_id: x.supervisor }));
  paso('su sesión ya tiene el rol y los permisos nuevos', () => E('GET', '/api/crm/yo'),
    (r) => r.usuario?.rol === 'supervisor' && !r.usuario.admin && r.usuario.permisos.join() === 'responder_tickets');
  paso('ingresa de nuevo con el rol nuevo', () => S('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }), (r) => r.usuario?.rol === 'supervisor');
  paso('trabaja con su cartera', () => S('GET', '/api/crm/clientes'), (r) => r.status === 200);
  paso('no se puede eliminar un rol con usuarios', () => A('DELETE', `/api/crm/admin/roles/${x.supervisor}`), (r) => r.status === 409 || r.status === 400);
});

describe('Desactivar o cambiar la contraseña con la sesión abierta', () => {
  paso('cambiarle la contraseña cierra sus sesiones abiertas', () => A('PATCH', `/api/crm/admin/usuarios/${x.ej.id}`, { password: 'Otra-Clave-2026!' }));
  paso('la sesión anterior ya no sirve → 401', () => S('GET', '/api/crm/clientes'), (r) => r.status === 401);
  paso('ingresa con la contraseña nueva', () => E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: 'Otra-Clave-2026!' }));
  paso('desactivarla', () => A('PATCH', `/api/crm/admin/usuarios/${x.ej.id}`, { activo: false }));
  paso('su sesión abierta deja de servir → 401', () => E('GET', '/api/crm/clientes'), (r) => r.status === 401);
  paso('y no puede volver a ingresar', () => E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: 'Otra-Clave-2026!' }), (r) => r.status === 403);
  paso('el administrador sigue trabajando', () => A('GET', '/api/crm/admin/usuarios'), (r) => r.status === 200);
});
