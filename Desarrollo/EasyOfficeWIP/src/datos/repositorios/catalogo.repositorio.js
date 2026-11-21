/* =========================================================
   CAPA DE DATOS · Catálogo de la tienda (tienda_familias, tienda_planes).

   Se arma desde el CRM (Administración → Tienda). Para el sitio se entrega
   con la misma forma que tenía public/js/catalogo.js, así contratar.js,
   planes.js y el servidor no cambian:
     [{ id, tab, note, plans: [{ id, name, price, priceTxt, per, recur, grupo, corto, feats, detalle }] }]

   Si la base aún no tiene las tablas (falta easyoffice_v2_tienda.sql), se usa
   public/js/catalogo.js como respaldo.
   ========================================================= */
const { consultaSistema } = require('../conexion');
const RESPALDO = require('../../../public/js/catalogo');

const VIGENCIA_MS = 30 * 1000;   // el sitio relee la base cada 30 s; el CRM invalida al guardar
let cache = null;                // { datos, hasta }
let avisado = false;

const sinTablas = (err) => /easyoffice_v2_tienda\.sql/.test(err.message || '');   // ver traducir() en conexion.js

const aPlan = (p) => {
  const plan = {
    id: p.codigo, name: p.nombre, price: p.precio === null ? null : Number(p.precio), per: p.periodo, recur: p.recurrencia,
    feats: p.caracteristicas || []
  };
  if (p.precio_texto) plan.priceTxt = p.precio_texto;
  if (p.grupo) plan.grupo = p.grupo;
  if (p.corto) plan.corto = p.corto;
  if (p.detalle && p.detalle.length) plan.detalle = p.detalle;
  return plan;
};

/** Familias y planes de la base, ordenados. Con { todos: true } incluye los inactivos (CRM). */
async function leer(db, { todos = false } = {}) {
  const q = db ? (sql, p) => db.query(sql, p) : consultaSistema;
  const f = await q(`SELECT id, codigo, nombre, nota, orden, activo FROM tienda_familias
                      WHERE activo OR $1 ORDER BY orden, nombre`, [todos]);
  const p = await q(`SELECT id, codigo, familia_id, nombre, precio, precio_texto, periodo, recurrencia, grupo, corto,
                            caracteristicas, detalle, orden, activo
                       FROM tienda_planes WHERE activo OR $1 ORDER BY orden, nombre`, [todos]);
  return { familias: f.rows, planes: p.rows };
}

// Catálogo público (solo lo activo), con la forma de catalogo.js
async function todos() {
  if (cache && cache.hasta > Date.now()) return cache.datos;
  let datos;
  try {
    const { familias, planes } = await leer();
    datos = familias.map((f) => ({
      id: f.codigo, tab: f.nombre, note: f.nota || '',
      plans: planes.filter((p) => p.familia_id === f.id).map(aPlan)
    })).filter((f) => f.plans.length);
  } catch (err) {
    // El sitio no se cae si la base no responde: usa lo último que leyó, o catalogo.js
    if (sinTablas(err)) {
      if (!avisado) console.warn('[tienda] faltan las tablas de la tienda (easyoffice_v2_tienda.sql): se usa public/js/catalogo.js');
      avisado = true;
    } else {
      console.warn('[tienda] no se pudo leer el catálogo de la base:', err.message);
    }
    return cache ? cache.datos : RESPALDO;
  }
  cache = { datos, hasta: Date.now() + VIGENCIA_MS };
  return datos;
}

async function plan(id) {
  for (const f of await todos()) {
    const p = f.plans.find((x) => x.id === id);
    if (p) return { ...p, fam: f.tab, famId: f.id };
  }
  return null;
}

const invalidar = () => { cache = null; };

/* ---------- Administración (dentro de la transacción del CRM) ---------- */

async function familiaPorCodigo(db, codigo) {
  return (await db.query('SELECT * FROM tienda_familias WHERE codigo = $1', [codigo])).rows[0] || null;
}

async function planPorCodigo(db, codigo) {
  return (await db.query('SELECT * FROM tienda_planes WHERE codigo = $1', [codigo])).rows[0] || null;
}

// Orden para agregar al final: de los servicios, o de los planes de un servicio
async function siguienteOrden(db, familiaId = null) {
  const r = familiaId
    ? await db.query('SELECT COALESCE(max(orden), 0) + 10 AS o FROM tienda_planes WHERE familia_id = $1', [familiaId])
    : await db.query('SELECT COALESCE(max(orden), 0) + 10 AS o FROM tienda_familias');
  return r.rows[0].o;
}

async function crearFamilia(db, f) {
  const r = await db.query(`INSERT INTO tienda_familias (codigo, nombre, nota, orden, activo)
                            VALUES ($1, $2, $3, $4, $5) RETURNING id`, [f.codigo, f.nombre, f.nota, f.orden, f.activo]);
  return r.rows[0].id;
}

async function actualizarFamilia(db, codigo, f) {
  const r = await db.query('UPDATE tienda_familias SET nombre = $2, nota = $3, activo = $4 WHERE codigo = $1',
    [codigo, f.nombre, f.nota, f.activo]);
  return r.rowCount > 0;
}

// Valores del plan en el orden de las columnas de crearPlan / actualizarPlan ($2…$12)
const valoresPlan = (p) => [p.familia_id, p.nombre, p.precio, p.precio_texto, p.periodo, p.recurrencia, p.grupo, p.corto,
  p.caracteristicas, p.detalle, p.activo];

async function crearPlan(db, p) {
  const r = await db.query(`
    INSERT INTO tienda_planes (codigo, familia_id, nombre, precio, precio_texto, periodo, recurrencia, grupo, corto,
                               caracteristicas, detalle, activo, orden)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`, [p.codigo, ...valoresPlan(p), p.orden]);
  return r.rows[0].id;
}

async function actualizarPlan(db, codigo, p) {
  const r = await db.query(`
    UPDATE tienda_planes SET familia_id = $2, nombre = $3, precio = $4, precio_texto = $5, periodo = $6, recurrencia = $7,
                             grupo = $8, corto = $9, caracteristicas = $10, detalle = $11, activo = $12
     WHERE codigo = $1`, [codigo, ...valoresPlan(p)]);
  return r.rowCount > 0;
}

async function moverPlan(db, codigo, familiaId, orden) {
  await db.query('UPDATE tienda_planes SET familia_id = $2, orden = $3 WHERE codigo = $1', [codigo, familiaId, orden]);
}

// Deja las filas en el orden dado (10, 20, 30…)
async function ordenarFamilias(db, codigos) {
  await db.query(`UPDATE tienda_familias f SET orden = x.n * 10 FROM unnest($1::text[]) WITH ORDINALITY AS x(codigo, n)
                   WHERE f.codigo = x.codigo AND f.orden IS DISTINCT FROM x.n * 10`, [codigos]);
}

async function ordenarPlanes(db, codigos) {
  await db.query(`UPDATE tienda_planes p SET orden = x.n * 10 FROM unnest($1::text[]) WITH ORDINALITY AS x(codigo, n)
                   WHERE p.codigo = x.codigo AND p.orden IS DISTINCT FROM x.n * 10`, [codigos]);
}

async function planesDeFamilia(db, familiaId) {
  return (await db.query('SELECT count(*)::int AS n FROM tienda_planes WHERE familia_id = $1', [familiaId])).rows[0].n;
}

async function codigosVendidos(db) {
  return new Set((await db.query('SELECT codigo FROM servicios WHERE codigo IS NOT NULL')).rows.map((r) => r.codigo));
}

// Un plan ya vendido (tiene servicio en el catálogo comercial) no se borra: se desactiva
async function planVendido(db, codigo) {
  const r = await db.query('SELECT 1 FROM servicios WHERE codigo = $1', [codigo]);
  return r.rowCount > 0;
}

async function borrarPlan(db, codigo) {
  await db.query('DELETE FROM plantilla_planes WHERE plan_codigo = $1', [codigo]);
  return (await db.query('DELETE FROM tienda_planes WHERE codigo = $1', [codigo])).rowCount > 0;
}

async function borrarFamilia(db, codigo) {
  return (await db.query('DELETE FROM tienda_familias WHERE codigo = $1', [codigo])).rowCount > 0;
}

// El precio de lista del catálogo comercial sigue al de la tienda (los contratos ya hechos no cambian)
async function sincronizarServicio(db, codigo, precio) {
  await db.query('UPDATE servicios SET precio_lista = $2 WHERE codigo = $1 AND precio_lista IS DISTINCT FROM $2', [codigo, precio]);
}

module.exports = {
  todos, plan, invalidar, leer, familiaPorCodigo, planPorCodigo, siguienteOrden, crearFamilia, actualizarFamilia,
  crearPlan, actualizarPlan, moverPlan, ordenarFamilias, ordenarPlanes, planesDeFamilia, codigosVendidos, planVendido, borrarPlan, borrarFamilia, sincronizarServicio
};
