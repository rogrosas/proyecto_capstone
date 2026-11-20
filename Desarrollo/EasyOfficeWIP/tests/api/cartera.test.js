/* Clientes visibles para todo el personal (permiso ver_todos_los_clientes) y ejecutivo a cargo
   (permiso asignar_clientes): asignar uno o varios clientes, filtrar por "a mi cargo" y cartera
   restringida para un rol sin el permiso. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const A = perezosa(), E = perezosa();
const x = {};

// Agrega o quita un permiso del rol ejecutivo (como en Administración → Roles y permisos)
async function permisoEjecutivo(nombre, dar) {
  const { roles, permisos } = await A('GET', '/api/crm/admin/roles');
  const rol = roles.find((r) => r.rol === 'ejecutivo');
  const id = permisos.find((p) => p.permiso === nombre).id;
  const lista = dar ? [...new Set([...rol.permisos, id])] : rol.permisos.filter((p) => p !== id);
  return A('PUT', `/api/crm/admin/roles/${rol.id}`, { rol: 'ejecutivo', permisos: lista });
}

describe('Todos ven a todos los clientes (ver_todos_los_clientes)', () => {
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('login ejecutiva', () => E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }));
  paso('el administrador ve todos los clientes', () => A('GET', '/api/crm/clientes'), (r) => { x.todos = r.clientes; return r.clientes.length >= 4; });
  paso('sin el permiso, la ejecutiva no ve clientes ajenos', () => E('GET', '/api/crm/clientes'), (r) => r.clientes.length === 0);
  paso('el rol ejecutivo recibe el permiso (como viene por defecto)', () => permisoEjecutivo('ver_todos_los_clientes', true));
  paso('sin volver a ingresar, ve a todos los clientes', () => E('GET', '/api/crm/clientes'), (r) => r.clientes.length === x.todos.length);
  paso('abre la ficha de cualquiera', () => E('GET', `/api/crm/clientes/${x.todos[0].id}`), (r) => r.status === 200 && r.cliente.id === x.todos[0].id);
  paso('ve sus contratos', () => E('GET', '/api/crm/contratos'), (r) => r.contratos.length > 0);
  paso('y opera: registra una gestión en un cliente que no registró', () => E('POST', `/api/crm/clientes/${x.todos[0].id}/gestiones`, { tipo: 'llamada', resultado: 'contactado', nota: 'Confirmó la renovación.' }));
  paso('pero no puede asignar clientes (sin asignar_clientes) → 403', () => E('POST', '/api/crm/clientes/asignar', { clientes: [x.todos[0].id], ejecutivo_id: 1 }), (r) => r.status === 403);
  paso('ni eliminar clientes (solo administradores) → 403', () => E('DELETE', `/api/crm/clientes/${x.todos[0].id}`), (r) => r.status === 403);
});

describe('Asignar el ejecutivo a cargo', () => {
  paso('id de la ejecutiva', () => A('GET', '/api/crm/admin/usuarios'), (r) => { x.ej = r.usuarios.find((u) => u.email === ctx.cred.ejec[0]).id; return !!x.ej; });
  paso('elegir dos clientes con contratos', () => A('GET', '/api/crm/contratos'), (r) => {
    x.elegidos = [...new Set(r.contratos.filter((k) => ['activo', 'pendiente'].includes(k.estado)).map((k) => k.cliente_id))].slice(0, 2);
    return x.elegidos.length === 2;
  });
  paso('el administrador se los asigna (con sus contratos)', () => A('POST', '/api/crm/clientes/asignar', { clientes: x.elegidos, ejecutivo_id: x.ej }),
    (r) => r.status === 200 && r.asignados === 2);
  it('quedan a su cargo y sus contratos vigentes pasan a ella', async () => {
    const cl = await entorno.sql('SELECT ejecutivo_id FROM clientes WHERE id = ANY($1)', [x.elegidos]);
    assert.ok(cl.every((c) => c.ejecutivo_id === x.ej));
    const k = await entorno.sql("SELECT ejecutivo_id FROM contratos WHERE cliente_id = ANY($1) AND estado IN ('activo', 'pendiente')", [x.elegidos]);
    assert.ok(k.length && k.every((c) => c.ejecutivo_id === x.ej));
  });
  paso('la ficha muestra a cargo de quién está', () => A('GET', `/api/crm/clientes/${x.elegidos[0]}`), (r) => r.cliente.a_cargo === 'Ejecutiva Prueba');
  paso('filtro "A mi cargo" de la ejecutiva', () => E('GET', '/api/crm/clientes?a_cargo=yo'),
    (r) => r.clientes.length === 2 && r.clientes.every((c) => x.elegidos.includes(c.id) && c.a_cargo === 'Ejecutiva Prueba'));
  paso('filtro por ejecutivo (administrador)', () => A('GET', `/api/crm/clientes?a_cargo=${x.ej}`), (r) => r.clientes.length === 2);
  paso('dejar uno sin asignar', () => A('POST', '/api/crm/clientes/asignar', { clientes: [x.elegidos[1]], ejecutivo_id: null }));
  paso('filtro "Sin asignar"', () => A('GET', '/api/crm/clientes?a_cargo=sin'), (r) => r.clientes.some((c) => c.id === x.elegidos[1]) && r.clientes.every((c) => !c.a_cargo));
  paso('un ejecutivo desactivado o inexistente no se puede asignar → 400', () => A('POST', '/api/crm/clientes/asignar', { clientes: [x.elegidos[1]], ejecutivo_id: 99999 }), (r) => r.status === 400);
  paso('sin clientes elegidos → 400', () => A('POST', '/api/crm/clientes/asignar', { clientes: [], ejecutivo_id: x.ej }), (r) => r.status === 400);
  paso('el listado en Excel trae "A cargo de"', () => A('GET', '/api/crm/exportar/clientes?a_cargo=' + x.ej, undefined, { crudo: true }),
    (r) => r.status === 200 && r.texto.includes('A cargo de') && r.texto.includes('Ejecutiva Prueba'));
});

describe('Rol sin ver_todos_los_clientes: solo su cartera', () => {
  paso('quitar el permiso al rol ejecutivo', () => permisoEjecutivo('ver_todos_los_clientes', false));
  paso('ve los clientes a su cargo', () => E('GET', '/api/crm/clientes'), (r) => r.clientes.some((c) => c.id === x.elegidos[0]));
  paso('y no los que dejaron de estar a su cargo (sin contratos suyos)', async () => {
    await entorno.sql("UPDATE contratos SET ejecutivo_id = NULL WHERE cliente_id = $1", [x.elegidos[1]]);
    await entorno.sql('UPDATE documentos SET ejecutivo_id = NULL WHERE cliente_id = $1', [x.elegidos[1]]);
    return E('GET', `/api/crm/clientes/${x.elegidos[1]}`);
  }, (r) => r.status === 404);
  paso('los contratos de su cliente a cargo sí', () => E('GET', '/api/crm/contratos'), (r) => r.contratos.some((k) => k.cliente_id === x.elegidos[0]));
});
