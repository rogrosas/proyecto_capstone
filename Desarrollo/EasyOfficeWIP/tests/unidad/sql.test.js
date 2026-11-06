/* Pruebas unitarias contra inyección SQL. No usan la base de datos.
   1. Revisa el código: todo SQL debe ir con parámetros ($1, $2…); lo único que se puede intercalar con ${…}
      son fragmentos fijos o nombres sacados de listas blancas. Un ${…} nuevo hace fallar la prueba
      hasta que alguien lo revise y lo agregue a PERMITIDOS.
   2. Prueba los UPDATE dinámicos con nombres de columna maliciosos (se ignoran o se rechazan).
   3. Prueba el escape de comodines de LIKE. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const MALICIOSOS = [
  "estado = 'activo'; DROP TABLE clientes; --",
  'id = id, password_hash',
  '1=1) OR (1',
  'nombre"; DELETE FROM usuarios; --'
];

// Expresiones revisadas a mano: constantes del código o identificadores de listas blancas
const PERMITIDOS = new Set([
  'SERVICIOS_CONTRATO', 'SIN_RENOVAR', 'TOTAL_CONTRATO', 'MENSUALIZADO', 'COLUMNAS_LISTA', 'FROM_LISTA',
  'COLUMNAS', 'DESDE', 'COLUMNAS_PAGO', 'COLUMNAS_ACCESO', 'PLANES', "POR_REVISAR('d')",
  "EN_PERIODO('cl.creado_en')", "EN_PERIODO('k.creado_en')", "EN_PERIODO('pg.fecha_pago')",
  "DEL_EJECUTIVO('cl.registrado_por')", "DEL_EJECUTIVO('d.ejecutivo_id')", "DEL_EJECUTIVO('k.ejecutivo_id')",
  // catalogos.repositorio.js: tabla, clave y columnas pasan por ident() (solo [a-z_])
  'ident(def.tabla)', 'ident(def.clave)', "def.orden.map(ident).join(', ')", "cols.map(ident).join(', ')",
  "extras.length ? ', ' + extras.join(', ') : ''",
  // UPDATE con columnas de una lista blanca fija (contratos, usuarios, documentos)
  'sets', "sets.join(', ')"
]);

function archivosJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? archivosJs(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

describe('SQL en el código fuente', () => {
  const fuentes = archivosJs(SRC).map((f) => ({ f: path.relative(SRC, f), txt: fs.readFileSync(f, 'utf8') }));

  it('solo intercala fragmentos fijos o nombres de listas blancas', () => {
    const nuevos = [];
    for (const { f, txt } of fuentes) {
      for (const [, sql] of txt.matchAll(/(?:\.query|consultaSistema)\(\s*`([\s\S]*?)`/g)) {
        for (const [, expr] of sql.matchAll(/\$\{([^}]*)\}/g)) {
          if (!PERMITIDOS.has(expr.trim())) nuevos.push(`${f}: \${${expr}}`);
        }
      }
    }
    assert.deepEqual(nuevos, [], 'SQL intercalado sin revisar (use parámetros $n o agréguelo a PERMITIDOS tras revisarlo)');
  });

  it('nunca arma SQL concatenando con +', () => {
    const malos = [];
    for (const { f, txt } of fuentes) {
      for (const m of txt.matchAll(/(?:\.query|consultaSistema)\(\s*(['"`])(?:(?!\1)[\s\S])*\1\s*\+/g)) malos.push(`${f}: ${m[0].slice(0, 60)}`);
    }
    assert.deepEqual(malos, []);
  });

  it('las rutas de la API no reciben SQL ni nombres de tabla', () => {
    // :nombre de catálogos y :lista de exportar se buscan en un objeto fijo, nunca llegan al SQL
    const rutas = fuentes.filter(({ f }) => f.startsWith(path.join('presentacion', 'rutas')));
    for (const { f, txt } of rutas) assert.doesNotMatch(txt, /\.query\(|consultaSistema\(/, f);
  });
});

/* ---------- UPDATE dinámicos con columnas de lista blanca ---------- */
function bdFalsa() {
  const llamadas = [];
  return { llamadas, query: async (sql, params) => { llamadas.push({ sql, params }); return { rowCount: 1, rows: [{ id: 1, clave: 1 }] }; } };
}

describe('UPDATE dinámicos', () => {
  it('contratos: una columna maliciosa se ignora y el valor va como parámetro', async () => {
    const contratos = require('../../src/datos/repositorios/contratos.repositorio');
    const db = bdFalsa();
    const cambios = { observaciones: "'); DROP TABLE contratos; --" };
    for (const k of MALICIOSOS) cambios[k] = 'x';
    await contratos.actualizar(db, 7, cambios);
    const { sql, params } = db.llamadas[0];
    assert.equal(sql, 'UPDATE contratos SET observaciones = $2 WHERE id = $1 RETURNING id');
    assert.deepEqual(params, [7, "'); DROP TABLE contratos; --"]);
  });

  it('usuarios: solo columnas conocidas', async () => {
    const usuarios = require('../../src/datos/repositorios/usuarios.repositorio');
    const db = bdFalsa();
    await usuarios.actualizar(db, 3, { nombre: "x' OR '1'='1", ...Object.fromEntries(MALICIOSOS.map((k) => [k, 1])) });
    assert.equal(db.llamadas[0].sql, 'UPDATE usuarios SET nombre = $2 WHERE id = $1 RETURNING id');
    assert.deepEqual(db.llamadas[0].params, [3, "x' OR '1'='1"]);
  });

  it('documentos: solo columnas conocidas', async () => {
    const documentos = require('../../src/datos/repositorios/documentos.repositorio');
    const db = bdFalsa();
    await documentos.cambiarEstado(db, 5, 'borrador', { estado: 'aprobado', ...Object.fromEntries(MALICIOSOS.map((k) => [k, 1])) });
    assert.equal(db.llamadas[0].sql, 'UPDATE documentos SET estado = $3 WHERE id = $1 AND estado = $2 RETURNING id');
  });

  it('catálogos: un nombre de columna que no es [a-z_] se rechaza antes de llegar a la base', async () => {
    const catalogos = require('../../src/datos/repositorios/catalogos.repositorio');
    const { DEFINICIONES } = require('../../src/negocio/catalogos.definiciones');
    const def = Object.values(DEFINICIONES)[0];
    for (const k of MALICIOSOS) {
      const db = bdFalsa();
      await assert.rejects(catalogos.crear(db, def, { [k]: 1 }), /Identificador no permitido/);
      await assert.rejects(catalogos.actualizar(db, def, 1, { [k]: 1 }), /Identificador no permitido/);
      assert.equal(db.llamadas.length, 0);
    }
    await assert.rejects(catalogos.listar(bdFalsa(), { ...def, tabla: 'clientes; DROP TABLE x' }), /Identificador no permitido/);
  });
});

describe('búsquedas con LIKE', () => {
  const { textoLike } = require('../../src/datos/sql/fragmentos');
  it('escapa los comodines para buscar el texto tal cual', () => {
    assert.equal(textoLike('100%'), '100\\%');
    assert.equal(textoLike('a_b'), 'a\\_b');
    assert.equal(textoLike('c:\\x'), 'c:\\\\x');
    assert.equal(textoLike("' OR 1=1 --"), "' OR 1=1 --");   // las comillas no se tocan: van como parámetro
    assert.equal(textoLike(null), '');
  });
});
