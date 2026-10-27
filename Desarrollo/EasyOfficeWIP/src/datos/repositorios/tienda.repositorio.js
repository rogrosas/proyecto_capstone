/* =========================================================
   CAPA DE DATOS · Compra en la tienda (/contratar).
   Corre en una transacción del sistema (conSistema): el comprador no es
   usuario del personal, así que registrado_por y ejecutivo_id quedan NULL
   y el origen queda como 'web'.
   ========================================================= */

// Servicio de la base que corresponde al plan de la tienda (servicios.codigo = id del plan)
async function servicioDePlan(db, codigo) {
  const r = await db.query('SELECT id, nombre, precio_lista, ciclo_pago_defecto FROM servicios WHERE codigo = $1 AND activo', [codigo]);
  return r.rows[0] || null;
}

/** s = { codigo, nombre, precio_lista, ciclo, descripcion } */
async function crearServicioDePlan(db, s) {
  const r = await db.query(`
    INSERT INTO servicios (codigo, nombre, tipo, precio_lista, ciclo_pago_defecto, descripcion_base, incluye_iva)
    VALUES ($1, $2, 'PRINCIPAL', $3, $4, $5, true)
    ON CONFLICT (nombre) DO UPDATE SET codigo = COALESCE(servicios.codigo, EXCLUDED.codigo)
    RETURNING id, nombre, precio_lista, ciclo_pago_defecto`, [s.codigo, s.nombre, s.precio_lista, s.ciclo, s.descripcion]);
  return r.rows[0];
}

async function clientePorRut(db, rut) {
  const r = await db.query(`
    SELECT cl.id, cl.tipo_persona, cl.razon_social, cl.email, r.email AS rep_email
      FROM clientes cl LEFT JOIN representantes_legales r ON r.id = cl.representante_legal_id
     WHERE cl.rut = $1`, [rut]);
  return r.rows[0] || null;
}

// Representante por RUT: si existe se usa tal cual (solo se le agrega el correo y el domicilio si no tenía)
async function representante(db, r) {
  const x = await db.query(`
    INSERT INTO representantes_legales (rut, nombre_completo, email, direccion_id) VALUES ($1, $2, $3, $4)
    ON CONFLICT (rut) DO UPDATE SET email = COALESCE(representantes_legales.email, EXCLUDED.email),
                                    direccion_id = COALESCE(representantes_legales.direccion_id, EXCLUDED.direccion_id)
    RETURNING id`, [r.rut, r.nombre_completo, r.email, r.direccion_id]);
  return x.rows[0].id;
}

/** c = { rut, tipo_persona, razon_social, giro_principal, email, celular, representante_legal_id, direccion_id } */
async function crearCliente(db, c) {
  const r = await db.query(`
    INSERT INTO clientes (rut, tipo_persona, razon_social, giro_principal, email, celular, representante_legal_id, direccion_id, origen)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'web') RETURNING id`,
    [c.rut, c.tipo_persona, c.razon_social, c.giro_principal, c.email, c.celular, c.representante_legal_id, c.direccion_id]);
  return r.rows[0].id;
}

// Comunas para el domicilio del comprador (la tienda es pública: solo nombre y región)
async function comunas(db) {
  const r = await db.query(`
    SELECT co.id, co.nombre_comuna AS nombre, re.nombre_region AS region
      FROM comunas co JOIN regiones re ON re.id = co.region_id
     ORDER BY re.nombre_region, co.nombre_comuna`);
  return r.rows;
}

// Empresa emisora, sucursal (por región) y cuenta de recaudación con que se vende en línea
async function puntoDeVenta(db, regionBuscada) {
  const r = await db.query(`
    SELECT e.id AS empresa_id, su.id AS sucursal_id,
           (SELECT ca.id FROM cuentas_recaudacion ca WHERE ca.empresa_id = e.id AND ca.activa ORDER BY ca.id LIMIT 1) AS cuenta_id
      FROM empresas_emisoras e
      JOIN sucursales su ON su.empresa_id = e.id AND su.activo
      LEFT JOIN direcciones d ON d.id = su.direccion_id
      LEFT JOIN comunas co ON co.id = d.comuna_id
      LEFT JOIN regiones re ON re.id = co.region_id
     WHERE e.activo
     ORDER BY (re.nombre_region ILIKE '%' || $1 || '%') DESC, (e.nombre_comercial = 'EASY OFFICE') DESC, su.id
     LIMIT 1`, [regionBuscada || '']);
  return r.rows[0] || null;
}

/** c = { empresa_id, cliente_id, sucursal_id, cuenta_recaudacion_id, link_pago, duracion_meses, datos_formulario } */
async function crearContrato(db, c) {
  const r = await db.query(`
    INSERT INTO contratos (empresa_id, cliente_id, sucursal_id, cuenta_recaudacion_id, link_pago, fecha_inicio,
                           duracion_meses, estado, origen, datos_formulario)
    VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'pendiente', 'web', $7)
    RETURNING id, folio`,
    [c.empresa_id, c.cliente_id, c.sucursal_id, c.cuenta_recaudacion_id, c.link_pago, c.duracion_meses, c.datos_formulario]);
  return r.rows[0];
}

module.exports = { servicioDePlan, crearServicioDePlan, clientePorRut, representante, crearCliente, comunas, puntoDeVenta, crearContrato };
