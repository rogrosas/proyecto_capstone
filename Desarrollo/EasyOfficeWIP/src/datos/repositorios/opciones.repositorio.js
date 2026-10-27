/* =========================================================
   CAPA DE DATOS · Listas para los selectores de los formularios
   (catálogos que rol_ejecutivo puede leer).
   ========================================================= */
const { numeros } = require('../conversion');

async function todas(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    regiones: await q('SELECT id, nombre_region AS nombre FROM regiones ORDER BY nombre_region'),
    comunas: await q('SELECT id, nombre_comuna AS nombre, region_id FROM comunas ORDER BY nombre_comuna'),
    empresas: await q('SELECT id, nombre_comercial AS nombre, activo FROM empresas_emisoras ORDER BY nombre_comercial'),
    sucursales: await q('SELECT id, empresa_id, nombre, prefijo_folio, activo FROM sucursales ORDER BY nombre'),
    cuentas: await q(`SELECT id, empresa_id, banco || ' · ' || tipo_cuenta || ' ' || numero_cuenta AS nombre, activa AS activo
                        FROM cuentas_recaudacion ORDER BY banco`),
    servicios: (await q(`SELECT id, nombre, tipo, precio_lista, ciclo_pago_defecto, descripcion_base, activo
                           FROM servicios ORDER BY tipo, nombre`)).map((s) => numeros(s, ['precio_lista'])),
    usuarios: await q('SELECT id, nombre, activo FROM usuarios ORDER BY nombre'),
    plantillas: await q(`SELECT id, tipo_documento AS nombre, version, familia, campos, requiere_revision, activo
                           FROM plantillas_documento ORDER BY tipo_documento, version DESC`),
    clausulas: await q('SELECT id, familia, codigo, titulo, campos, activo FROM clausulas_documento ORDER BY familia, codigo')
  };
}

module.exports = { todas };
