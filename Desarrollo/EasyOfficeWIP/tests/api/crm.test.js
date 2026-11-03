/* Recorre la API del CRM (administrador y ejecutivo) y el ingreso al portal de clientes. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
const prohibido = (r) => r.status === 403;
let ctx, A, E;
before(async () => {
  ctx = await entorno.iniciar();
  A = ctx.sesion();
  E = ctx.sesion();
});
after(() => entorno.terminar());

// Sesión que se crea al usarla (los pasos se registran antes de levantar la aplicación)
const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const ultimoToken = (email) => ctx.correos(email).at(-1)?.token;

describe('CRM · administrador', () => {
  paso('login', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('login con clave mala → 401', () => ctx.sesion()('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: 'x' }), (r) => r.status === 401);
  paso('yo', () => A('GET', '/api/crm/yo'), (r) => r.usuario?.admin === true);
  paso('dashboard', () => A('GET', '/api/crm/dashboard'));
  const op = paso('opciones', () => A('GET', '/api/crm/opciones'));
  const lc = paso('listar clientes', () => A('GET', '/api/crm/clientes'), (r) => r.status === 200 && r.clientes?.length >= 4);
  paso('buscar cliente por RUT con puntos', () => A('GET', '/api/crm/clientes?q=77.496.835-0'), (r) => r.clientes?.length === 1);
  it('ficha de cada cliente', async () => {
    for (const c of lc.clientes) {
      const r = await A('GET', '/api/crm/clientes/' + c.id);
      assert.equal(r.status, 200, c.razon_social);
      assert.ok(Array.isArray(r.accesos));
    }
  });

  const comuna = () => op.comunas?.[0]?.id ?? op.comunas?.[0]?.valor;
  const emp = paso('crear empresa con representante y correo', () => A('POST', '/api/crm/clientes', {
    rut: '76.086.428-5', razon_social: 'PRUEBA EMPRESA SpA', giro_principal: 'SERVICIOS', email: 'empresa@prueba.test', celular: '912345678',
    representante: { rut: '12.345.678-5', nombre_completo: 'REPRESENTANTE PRUEBA', email: 'rep@prueba.test', direccion: { calle: 'Calle Uno', numero: '100', comuna_id: comuna() } }
  }));
  const per = paso('crear persona natural', () => A('POST', '/api/crm/clientes', {
    rut: '13.579.246-2', razon_social: 'PERSONA NATURAL PRUEBA', email: 'persona@prueba.test', celular: '987654321'
  }));
  paso('editar empresa', () => A('PUT', '/api/crm/clientes/' + emp.id, {
    rut: '76.086.428-5', razon_social: 'PRUEBA EMPRESA SpA', giro_principal: 'SERVICIOS EDITADO', email: 'empresa@prueba.test', celular: '912345678',
    representante: { rut: '12.345.678-5', nombre_completo: 'REPRESENTANTE PRUEBA', email: 'rep@prueba.test' }
  }));
  paso('autorizar persona en empresa', () => A('PUT', `/api/crm/clientes/${emp.id}/accesos`, { email: 'autorizada@prueba.test', nombre: 'Autorizada Prueba', autorizado: true, activo: true }));
  paso('autorizar en persona natural → 400', () => A('PUT', `/api/crm/clientes/${per.id}/accesos`, { email: 'x@prueba.test', nombre: 'X', autorizado: true }), (r) => r.status === 400);
  paso('ficha empresa muestra representante y autorizada', () => A('GET', '/api/crm/clientes/' + emp.id),
    (r) => r.accesos?.length === 2 && r.cliente?.tipo_persona === 'juridica' && r.representante?.email === 'rep@prueba.test');
  paso('ficha persona: tipo natural', () => A('GET', '/api/crm/clientes/' + per.id), (r) => r.cliente?.tipo_persona === 'natural' && r.accesos?.[0]?.vinculo === 'titular');

  const lk = paso('listar contratos', () => A('GET', '/api/crm/contratos'));
  it('detalle de cada contrato', async () => {
    for (const k of lk.contratos) assert.equal((await A('GET', '/api/crm/contratos/' + k.id)).status, 200, k.folio);
  });
  const datosContrato = (clienteId, extra = {}) => {
    const empresa = op.empresas?.find((e) => e.nombre === 'EASY OFFICE') || op.empresas?.[0];
    return {
      cliente_id: clienteId, empresa_id: empresa?.id, sucursal_id: op.sucursales?.find((x) => x.empresa_id === empresa?.id)?.id,
      cuenta_recaudacion_id: op.cuentas?.find((c) => c.empresa_id === empresa?.id)?.id, fecha_inicio: '2026-10-27', ...extra
    };
  };
  const nk = paso('crear contrato con folio automático', () => A('POST', '/api/crm/contratos', datosContrato(emp.id, {
    duracion_meses: 12, servicios: [{ servicio_id: op.servicios[0].id }, { servicio_id: op.servicios[1].id, precio: 50000 }]
  })));
  paso('editar contrato', () => A('PATCH', '/api/crm/contratos/' + nk.id, { observaciones: 'prueba' }));
  const ns = paso('agregar servicio', () => A('POST', `/api/crm/contratos/${nk.id}/servicios`, { servicio_id: op.servicios[2].id }));
  it('quitar servicio', async () => {
    const dk = await A('GET', '/api/crm/contratos/' + nk.id);
    const csId = (dk.servicios || dk.contrato?.servicios || []).slice(-1)[0]?.id || ns.id;
    assert.equal((await A('DELETE', `/api/crm/contratos/${nk.id}/servicios/${csId}`)).status, 200);
  });
  paso('impresión contrato', () => A('GET', `/api/crm/contratos/${nk.id}/impresion`));
  paso('notificar alertas vencidas', () => A('POST', `/api/crm/contratos/${nk.id}/notificar-alertas`));
  paso('renovar contrato', () => A('POST', `/api/crm/contratos/${nk.id}/renovar`));
  paso('renovaciones', () => A('GET', '/api/crm/renovaciones'));

  paso('listar documentos', () => A('GET', '/api/crm/documentos'));
  const nd = paso('crear documento (poder simple)', () => A('POST', '/api/crm/documentos', {
    cliente_id: emp.id, plantilla_id: op.plantillas.find((p) => p.nombre === 'PODER SIMPLE')?.id, datos: { fecha: '2026-10-27' },
    partes: [{ rol: 'otorgante', nombre: 'REPRESENTANTE PRUEBA', rut: '12.345.678-5', tipo_persona: 'natural' }]
  }));
  paso('detalle documento', () => A('GET', '/api/crm/documentos/' + nd.id));
  paso('documento → en revisión', () => A('POST', `/api/crm/documentos/${nd.id}/estado`, { estado: 'en_revision' }));
  paso('aprobar documento', () => A('POST', `/api/crm/documentos/${nd.id}/aprobar`));

  const pw = paso('plantillas Word', () => A('GET', '/api/crm/plantillas-word'));
  paso('archivos de la carpeta', () => A('GET', '/api/crm/admin/archivos'));
  const gen = paso('generar contrato Word (LF-0152)', () => A('POST', `/api/crm/contratos/${lk.contratos.find((k) => k.folio === 'LF-0152-2026')?.id}/generar`,
    { plantilla_id: pw.plantillas.find((p) => /OFICINA/.test(p.tipo_documento || p.nombre || ''))?.id }));
  paso('descargar contrato Word', () => A('GET', `/api/crm/documentos/${gen.documento_id}/archivo`, undefined, { crudo: true }), (r) => r.status === 200 && r.largo > 1000);

  paso('ventas', () => A('GET', '/api/crm/ventas'));
  const np = paso('registrar pago', () => A('POST', '/api/crm/pagos', { contrato_id: nk.id, monto: 10000, pasarela: 'transferencia' }));
  paso('pago → pagado', () => A('PATCH', '/api/crm/pagos/' + (np.id || np.pago?.id), { estado: 'pagado' }));
  paso('auditoría', () => A('GET', '/api/crm/auditoria'));

  const roles = paso('listar roles', () => A('GET', '/api/crm/admin/roles'));
  paso('listar usuarios', () => A('GET', '/api/crm/admin/usuarios'));
  const nu = paso('crear usuario', () => A('POST', '/api/crm/admin/usuarios', { nombre: 'Usuario Nuevo', email: 'nuevo@easyoffice.test', rol_id: roles.roles.find((r) => r.rol === 'ejecutivo')?.id, password: 'ClaveTemporal-123' }));
  paso('desactivar usuario', () => A('PATCH', '/api/crm/admin/usuarios/' + nu.id, { activo: false }));
  const nr = paso('crear rol', () => A('POST', '/api/crm/admin/roles', { rol: 'rol_prueba', permisos: [] }));
  paso('editar rol', () => A('PUT', '/api/crm/admin/roles/' + nr.id, { rol: 'rol_prueba2', permisos: [] }));
  paso('eliminar rol', () => A('DELETE', '/api/crm/admin/roles/' + nr.id));
  it('cada catálogo se puede listar', async () => {
    const defs = await A('GET', '/api/crm/admin/catalogos');
    for (const nombre of Object.keys(defs.cuerpo)) assert.equal((await A('GET', '/api/crm/admin/catalogos/' + nombre)).status, 200, nombre);
  });
  paso('catálogo: agregar plazo de alerta 3 días', () => A('POST', '/api/crm/admin/catalogos/config_alertas', { dias_anticipacion: 3 }));
  paso('catálogo: eliminar plazo 3 días', () => A('DELETE', '/api/crm/admin/catalogos/config_alertas/3'));

  describe('CRM · ejecutivo', () => {
    paso('login', () => E('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }));
    paso('dashboard', () => E('GET', '/api/crm/dashboard'));
    paso('no ve clientes ajenos', () => E('GET', '/api/crm/clientes'), (r) => r.status === 200 && r.clientes?.length === 0);
    paso('ficha ajena → 404', () => E('GET', '/api/crm/clientes/' + emp.id), (r) => r.status === 404);
    paso('admin/usuarios → 403', () => E('GET', '/api/crm/admin/usuarios'), prohibido);
    paso('auditoría → 403', () => E('GET', '/api/crm/auditoria'), prohibido);
    const ec = paso('crear cliente', () => E('POST', '/api/crm/clientes', { rut: '15.111.222-6', razon_social: 'CLIENTE DE EJECUTIVA', email: 'cli.ejec@prueba.test' }));
    paso('ve su cliente', () => E('GET', '/api/crm/clientes'), (r) => r.clientes?.length === 1);
    paso('crear contrato', () => E('POST', '/api/crm/contratos', datosContrato(ec.id, { duracion_meses: 6, servicios: [{ servicio_id: op.servicios[0].id }] })));
    paso('bloquear acceso de su cliente', () => E('PUT', `/api/crm/clientes/${ec.id}/accesos`, { email: 'cli.ejec@prueba.test', activo: false }));
    paso('eliminar cliente → 403', () => E('DELETE', '/api/crm/clientes/' + ec.id), prohibido);
    paso('logout', () => E('POST', '/api/crm/logout'));
    paso('tras logout → 401', () => E('GET', '/api/crm/yo'), (r) => r.status === 401);
  });

  describe('Portal · ingreso con contraseña', () => {
    const P = () => ctx.sesion();
    const p1 = perezosa();
    paso('persona pide enlace', () => p1('POST', '/api/cliente/clave', { tipo: 'persona', email: 'persona@prueba.test' }));
    let tp;
    paso('persona define contraseña', () => { tp = ultimoToken('persona@prueba.test'); return p1('POST', '/api/cliente/clave/definir', { token: tp, password: 'Persona-Prueba-1' }); });
    paso('enlace usado de nuevo → 401', () => P()('POST', '/api/cliente/clave/definir', { token: tp, password: 'Persona-Prueba-1' }), (r) => r.status === 401);
    paso('panel persona', () => p1('GET', '/api/cliente/panel'), (r) => r.cliente?.razon_social === 'PERSONA NATURAL PRUEBA');
    paso('persona ingresa con contraseña', () => P()('POST', '/api/cliente/ingresar', { tipo: 'persona', email: 'persona@prueba.test', password: 'Persona-Prueba-1' }));
    paso('clave mala → 401', () => P()('POST', '/api/cliente/ingresar', { tipo: 'persona', email: 'persona@prueba.test', password: 'mala-mala' }), (r) => r.status === 401);
    paso('persona entrando como empresa → 401', () => P()('POST', '/api/cliente/ingresar', { tipo: 'empresa', rut: '13.579.246-2', email: 'persona@prueba.test', password: 'Persona-Prueba-1' }), (r) => r.status === 401);

    const p3 = perezosa();
    paso('autorizada pide enlace (empresa)', () => p3('POST', '/api/cliente/clave', { tipo: 'empresa', rut: '76.086.428-5', email: 'autorizada@prueba.test' }));
    paso('autorizada define contraseña', () => p3('POST', '/api/cliente/clave/definir', { token: ultimoToken('autorizada@prueba.test'), password: 'Autorizada-1234' }));
    const p4 = perezosa();
    paso('autorizada ingresa (RUT + correo + clave)', () => p4('POST', '/api/cliente/ingresar', { tipo: 'empresa', rut: '76086428-5', email: 'autorizada@prueba.test', password: 'Autorizada-1234' }));
    paso('panel empresa', () => p4('GET', '/api/cliente/panel'), (r) => r.cliente?.razon_social === 'PRUEBA EMPRESA SpA' && r.contratos?.length >= 1);
    paso('empresa con RUT equivocado → 401', () => P()('POST', '/api/cliente/ingresar', { tipo: 'empresa', rut: '77.496.835-0', email: 'autorizada@prueba.test', password: 'Autorizada-1234' }), (r) => r.status === 401);
    it('el correo de la empresa (no vinculado) no recibe enlace', async () => {
      await P()('POST', '/api/cliente/clave', { tipo: 'empresa', rut: '76.086.428-5', email: 'empresa@prueba.test' });
      assert.equal(ctx.correos('empresa@prueba.test').filter((c) => c.token).length, 0);
    });
    paso('ficha: autorizada con contraseña', () => A('GET', '/api/crm/clientes/' + emp.id), (r) => r.accesos?.find((a) => a.email === 'autorizada@prueba.test')?.con_clave === true);
    paso('bloquear autorizada', () => A('PUT', `/api/crm/clientes/${emp.id}/accesos`, { email: 'autorizada@prueba.test', activo: false }));
    paso('autorizada bloqueada → 401', () => P()('POST', '/api/cliente/ingresar', { tipo: 'empresa', rut: '76.086.428-5', email: 'autorizada@prueba.test', password: 'Autorizada-1234' }), (r) => r.status === 401);
    paso('eliminar cliente con contratos → 409', () => A('DELETE', '/api/crm/clientes/' + emp.id), (r) => r.status === 409);
  });
});
