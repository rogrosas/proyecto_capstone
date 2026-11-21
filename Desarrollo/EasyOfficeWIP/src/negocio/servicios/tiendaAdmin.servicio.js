/* =========================================================
   CAPA DE NEGOCIO · Armar la tienda desde el CRM (Administración → Tienda).
   Servicios (tienda_familias) y planes (tienda_planes): nombre, precio,
   vigencia, características, orden, activo y los documentos de cada plan.
   Permiso administrar_catalogos; las escrituras van con rol_admin.
   ========================================================= */
const { conUsuario } = require('../../datos/conexion');
const { errores } = require('../../comun/errores');
const catalogoRepo = require('../../datos/repositorios/catalogo.repositorio');
const plantillasRepo = require('../../datos/repositorios/plantillas.repositorio');
const { exigirPermiso } = require('../roles');
const v = require('../validacion');

const RECURRENCIAS = ['anual', 'semestral', 'mensual', 'bolsa', 'unico'];
const GRUPOS = ['bolsas', 'planes', 'digitales'];

// Si la base no tiene las tablas, conexion.js responde qué script falta (409)
async function conAdmin(usuario, fn) {
  await exigirPermiso(usuario, 'administrar_catalogos');
  try {
    return await conUsuario(usuario, fn, { elevado: true });
  } finally {
    catalogoRepo.invalidar();   // el sitio ve los cambios de inmediato
  }
}

function codigo(valor, etiqueta) {
  const c = String(valor ?? '').trim().toLowerCase();
  if (!c) throw errores.solicitudInvalida(`${etiqueta} es obligatorio.`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c) || c.length > 40) {
    throw errores.solicitudInvalida(`${etiqueta} solo admite minúsculas, números y guiones (ej. dom-anual).`);
  }
  return c;
}

// Lista de textos (una línea por ítem); vacía → []
function lista(valor, etiqueta, { max = 20 } = {}) {
  const items = (Array.isArray(valor) ? valor : String(valor ?? '').split('\n')).map((x) => String(x).trim()).filter(Boolean);
  if (items.length > max) throw errores.solicitudInvalida(`${etiqueta}: máximo ${max} líneas.`);
  items.forEach((x) => { if (x.length > 200) throw errores.solicitudInvalida(`${etiqueta}: cada línea admite hasta 200 caracteres.`); });
  return items;
}

/* ---------- Lectura ---------- */

async function listar(usuario) {
  return conAdmin(usuario, async (db) => {
    const { familias, planes } = await catalogoRepo.leer(db, { todos: true });
    const plantillas = await plantillasRepo.deTienda(db);
    const vendidos = await catalogoRepo.codigosVendidos(db);
    const docs = (c) => plantillas.filter((p) => p.planes.includes(c))
      .map(({ id, tipo_documento, version, entrega, activo }) => ({ id, tipo_documento, version, entrega, activo }));
    return {
      familias: familias.map((f) => ({
        ...f,
        planes: planes.filter((p) => p.familia_id === f.id).map((p) => ({
          ...p, precio: p.precio === null ? null : Number(p.precio), vendido: vendidos.has(p.codigo), documentos: docs(p.codigo)
        }))
      })),
      plantillas: plantillas.map(({ id, tipo_documento, version, entrega, activo, archivo_base, planes: pl }) =>
        ({ id, tipo_documento, version, entrega, activo, archivo_base, planes: pl }))
    };
  });
}

/* ---------- Servicios (familias) ---------- */

function leerFamilia(d) {
  return {
    nombre: v.texto(d.nombre, 'Nombre del servicio', { max: 80 }),
    nota: v.texto(d.nota, 'Nota', { opcional: true, max: 600 }),
    activo: v.booleano(d.activo, true)
  };
}

async function crearFamilia(usuario, d = {}) {
  const f = { codigo: codigo(d.codigo, 'Código del servicio'), ...leerFamilia(d) };
  return conAdmin(usuario, async (db) => {
    if (await catalogoRepo.familiaPorCodigo(db, f.codigo)) throw errores.conflicto(`Ya existe un servicio con el código "${f.codigo}".`);
    f.orden = await catalogoRepo.siguienteOrden(db);
    await catalogoRepo.crearFamilia(db, f);
    return { codigo: f.codigo };
  });
}

async function editarFamilia(usuario, cod, d = {}) {
  const f = leerFamilia(d);
  return conAdmin(usuario, async (db) => {
    if (!await catalogoRepo.actualizarFamilia(db, String(cod), f)) throw errores.noEncontrado('El servicio no existe.');
    return { ok: true };
  });
}

async function borrarFamilia(usuario, cod) {
  return conAdmin(usuario, async (db) => {
    const f = await catalogoRepo.familiaPorCodigo(db, String(cod));
    if (!f) throw errores.noEncontrado('El servicio no existe.');
    if (await catalogoRepo.planesDeFamilia(db, f.id)) throw errores.conflicto('El servicio tiene planes: bórrelos o muévalos a otro servicio antes, o desactívelo.');
    await catalogoRepo.borrarFamilia(db, f.codigo);
    return { ok: true };
  });
}

/* ---------- Planes ---------- */

async function leerPlan(db, d) {
  const fam = await catalogoRepo.familiaPorCodigo(db, String(d.familia ?? ''));
  if (!fam) throw errores.solicitudInvalida('Elija el servicio del plan.');
  const cotiza = v.booleano(d.cotiza, false);
  const p = {
    familia_id: fam.id,
    nombre: v.texto(d.nombre, 'Nombre del plan', { max: 100 }),
    precio: cotiza ? null : v.monto(d.precio, 'Precio', { min: 0 }),
    precio_texto: cotiza ? v.texto(d.precio_texto, 'Texto del precio', { opcional: true, max: 40 }) : null,
    periodo: v.texto(d.periodo, 'Vigencia', { opcional: true, max: 80 }) || '',
    recurrencia: cotiza ? 'cotiza' : v.opcion(d.recurrencia, RECURRENCIAS, 'Cobro'),
    grupo: v.opcion(d.grupo || null, GRUPOS, 'Lista de precios', { opcional: true }),
    corto: v.texto(d.corto, 'Texto corto', { opcional: true, max: 80 }),
    caracteristicas: lista(d.caracteristicas, 'Características', { max: 12 }),
    detalle: lista(d.detalle, 'Detalle', { max: 20 }),
    activo: v.booleano(d.activo, true)
  };
  if (!p.caracteristicas.length) throw errores.solicitudInvalida('Escriba al menos una característica del plan.');
  if (!p.detalle.length) p.detalle = null;
  if (p.grupo && !p.corto) throw errores.solicitudInvalida('Los planes de una lista de precios necesitan un texto corto.');
  return p;
}

async function crearPlan(usuario, d = {}) {
  const cod = codigo(d.codigo, 'Código del plan');
  return conAdmin(usuario, async (db) => {
    if (await catalogoRepo.planPorCodigo(db, cod)) throw errores.conflicto(`Ya existe un plan con el código "${cod}".`);
    const p = { codigo: cod, ...await leerPlan(db, d) };
    p.orden = await catalogoRepo.siguienteOrden(db, p.familia_id);
    await catalogoRepo.crearPlan(db, p);
    return { codigo: cod };
  });
}

async function editarPlan(usuario, cod, d = {}) {
  cod = String(cod);
  return conAdmin(usuario, async (db) => {
    const actual = await catalogoRepo.planPorCodigo(db, cod);
    if (!actual) throw errores.noEncontrado('El plan no existe.');
    const p = await leerPlan(db, d);
    // Al cambiar de servicio queda al final de la lista del nuevo
    const orden = p.familia_id !== actual.familia_id ? await catalogoRepo.siguienteOrden(db, p.familia_id) : null;
    await catalogoRepo.actualizarPlan(db, cod, p);
    if (orden !== null) await catalogoRepo.moverPlan(db, cod, p.familia_id, orden);
    await catalogoRepo.sincronizarServicio(db, cod, p.precio);
    return { ok: true };
  });
}

async function borrarPlan(usuario, cod) {
  cod = String(cod);
  return conAdmin(usuario, async (db) => {
    if (!await catalogoRepo.planPorCodigo(db, cod)) throw errores.noEncontrado('El plan no existe.');
    if (await catalogoRepo.planVendido(db, cod)) {
      throw errores.conflicto('Este plan ya se vendió: no se puede borrar porque hay contratos que lo usan. Desactívelo para sacarlo de la tienda.');
    }
    await catalogoRepo.borrarPlan(db, cod);
    return { ok: true };
  });
}

/** d = { codigos: ['dom-anual', ...] } en el orden nuevo. tipo: 'familias' | 'planes' */
async function ordenar(usuario, tipo, d = {}) {
  tipo = v.opcion(tipo, ['familias', 'planes'], 'Tipo');
  if (!Array.isArray(d.codigos) || !d.codigos.length || d.codigos.length > 200) throw errores.solicitudInvalida('Indique el orden.');
  const codigos = d.codigos.map((c) => codigo(c, 'Código'));
  return conAdmin(usuario, async (db) => {
    if (tipo === 'familias') await catalogoRepo.ordenarFamilias(db, codigos);
    else await catalogoRepo.ordenarPlanes(db, codigos);
    return { ok: true };
  });
}

module.exports = { listar, crearFamilia, editarFamilia, borrarFamilia, crearPlan, editarPlan, borrarPlan, ordenar };
