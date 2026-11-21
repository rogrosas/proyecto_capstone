/* Armar la tienda desde el CRM: servicios, planes, orden y lo que ve el sitio (/api/catalogo y /js/catalogo.js). */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const entorno = require('../apoyo/entorno');

const paso = entorno.pasos(it, assert);
let ctx;
before(async () => { ctx = await entorno.iniciar(); });
after(() => entorno.terminar());

const perezosa = () => { let s; return (...a) => (s ||= ctx.sesion())(...a); };
const A = perezosa(), X = perezosa(), T = perezosa();
const catalogo = async () => (await T('GET', '/api/catalogo')).cuerpo;
const planDe = (cat, codigo) => cat.flatMap((f) => f.plans).find((p) => p.id === codigo);

const PLAN = {
  familia: 'legal', codigo: 'leg-poder', nombre: 'Poder simple', precio: 19990, recurrencia: 'unico', periodo: 'por documento',
  caracteristicas: 'Redacción del poder\nRevisión por abogado\n\n', activo: true
};

describe('Administración · tienda', () => {
  paso('login', () => A('POST', '/api/crm/login', { email: ctx.cred.admin[0], password: ctx.cred.admin[1] }));
  paso('la tienda viene cargada con el catálogo del sitio', () => A('GET', '/api/crm/admin/tienda'), (r) =>
    r.familias?.length === 5 && r.familias[0].codigo === 'domicilio' && r.familias[0].planes.length === 3 && Array.isArray(r.plantillas));
  it('el sitio lee el catálogo de la base, con la forma de catalogo.js', async () => {
    const cat = await catalogo();
    assert.equal(cat[0].id, 'domicilio');
    assert.deepEqual(Object.keys(planDe(cat, 'dom-anual')).sort(), ['detalle', 'feats', 'id', 'name', 'per', 'price', 'recur']);
    assert.equal(planDe(cat, 'reb-anual').priceTxt, 'UF 14');
    const js = await T('GET', '/js/catalogo.js', undefined, { crudo: true });
    assert.match(js.tipo, /javascript/);
    assert.ok(js.texto.startsWith('window.CATALOGO = [') && js.texto.includes('"dom-anual"'));
  });

  paso('código inválido → 400', () => A('POST', '/api/crm/admin/tienda/servicios', { codigo: 'Legal Docs', nombre: 'Legal' }), (r) => r.status === 400);
  paso('nuevo servicio', () => A('POST', '/api/crm/admin/tienda/servicios', { codigo: 'legal', nombre: 'Documentos legales', nota: 'Poderes y contratos.' }),
    (r) => r.status === 201);
  paso('servicio repetido → 409', () => A('POST', '/api/crm/admin/tienda/servicios', { codigo: 'legal', nombre: 'Otro' }), (r) => r.status === 409);
  it('un servicio sin planes no aparece en el sitio', async () => {
    assert.ok(!(await catalogo()).some((f) => f.id === 'legal'));
  });
  paso('plan sin características → 400', () => A('POST', '/api/crm/admin/tienda/planes', { ...PLAN, caracteristicas: '' }), (r) => r.status === 400);
  paso('plan de un servicio inexistente → 400', () => A('POST', '/api/crm/admin/tienda/planes', { ...PLAN, familia: 'nada' }), (r) => r.status === 400);
  paso('nuevo plan', () => A('POST', '/api/crm/admin/tienda/planes', PLAN), (r) => r.status === 201);
  it('el plan nuevo ya está en el sitio y se puede comprar', async () => {
    const cat = await catalogo();
    const f = cat.find((x) => x.id === 'legal');
    assert.equal(f.tab, 'Documentos legales');
    assert.deepEqual(f.plans[0], { id: 'leg-poder', name: 'Poder simple', price: 19990, per: 'por documento', recur: 'unico', feats: ['Redacción del poder', 'Revisión por abogado'] });
    assert.equal((await T('GET', '/api/tienda/planes/leg-poder/preguntas')).status, 200);
  });
  paso('pasa a cotizarse: el precio se ignora', () => A('PUT', '/api/crm/admin/tienda/planes/leg-poder', { ...PLAN, cotiza: true, precio: 5000, precio_texto: 'Desde UF 1' }));
  it('se muestra como cotización', async () => {
    const p = planDe(await catalogo(), 'leg-poder');
    assert.equal(p.price, null);
    assert.equal(p.recur, 'cotiza');
    assert.equal(p.priceTxt, 'Desde UF 1');
  });
  paso('lista de precios sin texto corto → 400', () => A('PUT', '/api/crm/admin/tienda/planes/leg-poder', { ...PLAN, grupo: 'digitales' }), (r) => r.status === 400);

  paso('ordenar los planes de domicilio', () => A('PUT', '/api/crm/admin/tienda/orden/planes', { codigos: ['dom-bod', 'dom-anual', 'dom-sem'] }));
  paso('ordenar los servicios', () => A('PUT', '/api/crm/admin/tienda/orden/familias', { codigos: ['legal', 'domicilio', 'contabilidad', 'firmas', 'digitales', 'empresa'] }));
  it('el sitio respeta el orden', async () => {
    const cat = await catalogo();
    assert.equal(cat[0].id, 'legal');
    assert.deepEqual(cat[1].plans.map((p) => p.id), ['dom-bod', 'dom-anual', 'dom-sem']);
  });

  paso('ocultar un plan', () => A('PUT', '/api/crm/admin/tienda/planes/dig-api', {
    familia: 'digitales', nombre: 'Acceso a la API', precio: 8990, recurrencia: 'mensual', caracteristicas: ['Integración'], activo: false
  }));
  it('lo oculto no está en el sitio ni se puede comprar', async () => {
    assert.equal(planDe(await catalogo(), 'dig-api'), undefined);
    assert.equal((await T('GET', '/api/tienda/planes/dig-api/preguntas')).status, 400);
  });
  paso('ocultar un servicio', () => A('PUT', '/api/crm/admin/tienda/servicios/legal', { nombre: 'Documentos legales', activo: false }));
  it('un servicio oculto saca sus planes del sitio', async () => {
    assert.equal(planDe(await catalogo(), 'leg-poder'), undefined);
  });

  paso('no se borra un servicio con planes → 409', () => A('DELETE', '/api/crm/admin/tienda/servicios/legal'), (r) => r.status === 409);
  paso('borrar un plan nunca vendido', () => A('DELETE', '/api/crm/admin/tienda/planes/leg-poder'));
  paso('borrar el servicio vacío', () => A('DELETE', '/api/crm/admin/tienda/servicios/legal'));
  paso('ya no existe', () => A('PUT', '/api/crm/admin/tienda/servicios/legal', { nombre: 'X' }), (r) => r.status === 404);

  describe('plan ya vendido', () => {
    const DIR = {};
    it('comunas', async () => {
      const comunas = (await T('GET', '/api/tienda/comunas')).comunas;
      Object.assign(DIR, { calle: 'Los Aromos', numero: '1450', comuna_id: comunas.find((c) => c.nombre === 'Providencia')?.id });
    });
    paso('compra de un plan', () => entorno.comprarYPagar(T, {
      plan: 'cont-inicio', tipo: 'persona', direccion: DIR, pago: { modo: 'total', medio: 'tbk' },
      titular: { nombre: 'Tomás Vera Díaz', rut: '18.765.432-7', email: 'tomas.vera@ejemplo.test' }
    }), (r) => r.status === 201);
    paso('no se borra un plan vendido → 409', () => A('DELETE', '/api/crm/admin/tienda/planes/cont-inicio'), (r) => r.status === 409);
    paso('cambiar su precio', () => A('PUT', '/api/crm/admin/tienda/planes/cont-inicio', {
      familia: 'contabilidad', nombre: 'Inicio de actividad', precio: 16900, recurrencia: 'unico', periodo: 'plan único', caracteristicas: ['Obtención de clave secreta']
    }));
    it('el catálogo comercial sigue el nuevo precio', async () => {
      const filas = await ctx.sql('SELECT precio_lista FROM servicios WHERE codigo = $1', ['cont-inicio']);
      assert.equal(Number(filas[0].precio_lista), 16900);
    });
  });

  describe('ejecutivo', () => {
    paso('login', () => X('POST', '/api/crm/login', { email: ctx.cred.ejec[0], password: ctx.cred.ejec[1] }));
    paso('ver la tienda → 403', () => X('GET', '/api/crm/admin/tienda'), (r) => r.status === 403);
    paso('crear plan → 403', () => X('POST', '/api/crm/admin/tienda/planes', PLAN), (r) => r.status === 403);
  });

  // Una base que aún no ejecuta easyoffice_v2_tienda.sql (producción entre el despliegue y la migración)
  describe('base sin las tablas de la tienda', () => {
    it('se quitan las tablas', async () => { await ctx.sql('DROP TABLE tienda_planes, tienda_familias'); });
    paso('el CRM dice qué script falta → 409', () => A('GET', '/api/crm/admin/tienda'), (r) => r.status === 409 && /easyoffice_v2_tienda\.sql/.test(r.error));
    it('el sitio sigue mostrando la tienda desde catalogo.js', async () => {
      const cat = await catalogo();
      assert.equal(cat.length, 5);
      assert.ok(planDe(cat, 'dig-api'));   // el respaldo no sabe lo que se ocultó en la base
      assert.equal((await T('GET', '/api/tienda/planes/dom-anual/preguntas')).status, 200);
    });
  });
});
