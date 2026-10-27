/* =========================================================
   CAPA DE DATOS · CRUD genérico de los catálogos de administración
   (servicios, emisoras, sucursales, cuentas, propietarios, representantes,
   regiones, comunas, plantillas, cláusulas, permisos, config_alertas,
   folios_correlativos).

   La tabla, la clave y las columnas vienen SIEMPRE de la definición
   (lista blanca de la capa de negocio, catalogos.definiciones.js), nunca de la petición;
   los valores van como parámetros.
   ========================================================= */
const ident = (s) => {
  if (!/^[a-z_]+$/.test(s)) throw new Error(`Identificador no permitido: ${s}`);
  return `"${s}"`;
};

async function listar(db, def) {
  const extras = def.campos
    .filter((c) => c.tipo === 'direccion')
    .map((c) => `(SELECT json_build_object('calle', d.calle, 'numero', d.numero, 'complemento', d.complemento, 'comuna_id', d.comuna_id,
                    'texto', fn_dir_calle(d.id) || ', ' || fn_dir_comuna(d.id))
                    FROM direcciones d WHERE d.id = t.${ident(c.columna)}) AS ${ident(c.columna + '__dir')}`);
  const r = await db.query(`SELECT t.*${extras.length ? ', ' + extras.join(', ') : ''}
                              FROM ${ident(def.tabla)} t ORDER BY ${def.orden.map(ident).join(', ')}`);
  return r.rows;
}

async function crear(db, def, valores) {
  const cols = Object.keys(valores);
  const r = await db.query(
    `INSERT INTO ${ident(def.tabla)} (${cols.map(ident).join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING ${ident(def.clave)} AS clave`,
    cols.map((c) => valores[c]));
  return r.rows[0].clave;
}

async function actualizar(db, def, clave, valores) {
  const cols = Object.keys(valores);
  if (!cols.length) return true;
  const r = await db.query(
    `UPDATE ${ident(def.tabla)} SET ${cols.map((c, i) => `${ident(c)} = $${i + 2}`).join(', ')}
      WHERE ${ident(def.clave)} = $1 RETURNING ${ident(def.clave)}`,
    [clave, ...cols.map((c) => valores[c])]);
  return r.rowCount > 0;
}

async function eliminar(db, def, clave) {
  const r = await db.query(`DELETE FROM ${ident(def.tabla)} WHERE ${ident(def.clave)} = $1 RETURNING ${ident(def.clave)}`, [clave]);
  return r.rowCount > 0;
}

module.exports = { listar, crear, actualizar, eliminar };
