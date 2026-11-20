/* Permisos de los roles: cada permiso marcado en Administración → Roles y permisos habilita
   su acción, y sin él el servidor responde 403 y lo deja como DENEGADO en la auditoría.
   El cambio rige de inmediato, sin volver a iniciar sesión. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const A = perezosa(), P = perezosa();
const x = {};
const NO_EXISTE = 999999;
const CLAVE = 'Clave-Permisos-2026!';

// Cada acción con su permiso. Con el permiso, la petición pasa la revisión y llega a la lógica:
// responde 200, o 400/404/409 porque el dato de prueba no es válido o no existe (nunca 403).
const ACCIONES = [
  ['ver_auditoria', 'GET', '/api/crm/auditoria'],
  ['administrar_usuarios', 'GET', '/api/crm/admin/usuarios'],
  ['administrar_usuarios', 'GET', '/api/crm/admin/roles'],
  ['administrar_catalogos', 'GET', '/api/crm/admin/catalogos/servicios'],
  ['eliminar_registros', 'DELETE', `/api/crm/clientes/${NO_EXISTE}`],
  ['registrar_pagos', 'POST', '/api/crm/pagos', {}],
  ['registrar_pagos', 'PATCH', `/api/crm/pagos/${NO_EXISTE}`, { estado: 'pagado' }],
  ['aprobar_documentos', 'POST', `/api/crm/documentos/${NO_EXISTE}/aprobar`, {}],
  ['aprobar_documentos', 'POST', `/api/crm/documentos/${NO_EXISTE}/publicar`, {}],
  ['gestionar_renovaciones', 'POST', `/api/crm/contratos/${NO_EXISTE}/renovar`, {}],
  ['gestionar_renovaciones', 'GET', '/api/crm/avisos'],
  ['registrar_correspondencia', 'POST', '/api/crm/correspondencia', {}],
  ['ver_reportes', 'GET', '/api/crm/exportar/clientes']
];

async function darPermisos(nombres) {
  const { permisos } = await A('GET', '/api/crm/admin/roles');
  return A('PUT', `/api/crm/admin/roles/${x.rol}`, { rol: 'practicante', permisos: permisos.filter((p) => nombres.includes(p.permiso)).map((p) => p.id) });
}

describe('Un rol sin permisos', () => {
  paso('login administrador', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('crear el rol "practicante" sin permisos', () => A('POST', '/api/crm/admin/roles', { rol: 'practicante', permisos: [] }),
    (r) => { x.rol = r.id; return r.status === 201; });
  paso('crear un usuario con ese rol', () => A('POST', '/api/crm/admin/usuarios',
    { nombre: 'Practicante Prueba', email: 'practicante@easyoffice.test', rol_id: x.rol, password: CLAVE }), (r) => r.status === 201);
  paso('ingresa al CRM', () => P('POST', '/api/crm/login', { email: 'practicante@easyoffice.test', password: CLAVE }),
    (r) => r.usuario?.rol === 'practicante' && !r.usuario.admin && r.usuario.permisos.length === 0);

  for (const [permiso, metodo, ruta, datos] of ACCIONES) {
    paso(`sin «${permiso}»: ${metodo} ${ruta} → 403`, () => P(metodo, ruta, datos), (r) => r.status === 403);
  }

  it('cada rechazo queda como DENEGADO en la auditoría', async () => {
    const filas = await entorno.sql(`SELECT DISTINCT ra.registro_id FROM registros_actividad ra JOIN usuarios u ON u.id = ra.usuario_id
                                      WHERE u.email = 'practicante@easyoffice.test' AND ra.accion = 'DENEGADO' AND ra.tabla_afectada = 'permisos'`);
    assert.deepEqual(filas.map((f) => f.registro_id).sort(), [...new Set(ACCIONES.map(([p]) => p))].sort());
  });
});

describe('Al darle los permisos rigen de inmediato', () => {
  paso('el administrador le marca todos los permisos', () => darPermisos(ACCIONES.map(([p]) => p)));
  paso('su sesión ya los tiene', () => P('GET', '/api/crm/yo'), (r) => r.usuario.permisos.length === new Set(ACCIONES.map(([p]) => p)).size);

  for (const [permiso, metodo, ruta, datos] of ACCIONES) {
    paso(`con «${permiso}»: ${metodo} ${ruta} pasa`, () => P(metodo, ruta, datos), (r) => [200, 201, 400, 404, 409].includes(r.status));
  }

  paso('sin ver_todos_los_clientes, el reporte trae solo su cartera (vacía)', () => P('GET', '/api/crm/exportar/clientes', undefined, { crudo: true }),
    (r) => r.status === 200 && r.texto.trim().split(/\r?\n/).length === 1);
  paso('el administrador le quita todos los permisos', () => darPermisos([]));
  paso('vuelve a responder 403 sin cerrar sesión', () => P('GET', '/api/crm/auditoria'), (r) => r.status === 403);
});

describe('Un solo permiso habilita solo lo suyo', () => {
  paso('le marca solo «ver_auditoria»', () => darPermisos(['ver_auditoria']));
  paso('ve la auditoría', () => P('GET', '/api/crm/auditoria'), (r) => r.status === 200 && Array.isArray(r.registros));
  paso('pero no administra usuarios', () => P('GET', '/api/crm/admin/usuarios'), (r) => r.status === 403);
  paso('ni registra pagos', () => P('POST', '/api/crm/pagos', {}), (r) => r.status === 403);
});

describe('Administrar catálogos sin administrar usuarios', () => {
  paso('le marca solo «administrar_catalogos»', () => darPermisos(['administrar_catalogos']));
  paso('abre Administración (definiciones de catálogos)', () => P('GET', '/api/crm/admin/catalogos'), (r) => r.status === 200);
  paso('edita catálogos', () => P('GET', '/api/crm/admin/catalogos/servicios'), (r) => r.status === 200 && Array.isArray(r.registros));
  paso('no ve usuarios ni roles', () => P('GET', '/api/crm/admin/roles'), (r) => r.status === 403);
});

describe('Los roles administradores tienen todos los permisos', () => {
  paso('el administrador ve la auditoría y exporta', () => A('GET', '/api/crm/auditoria'), (r) => r.status === 200);
  paso('y administra usuarios', () => A('GET', '/api/crm/admin/usuarios'), (r) => r.status === 200);
});
