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
                           duracion_meses, estado, origen, datos_formulario, ejecutivo_id)
    VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'pendiente', 'web', $7, $8)
    RETURNING id, folio`,
    [c.empresa_id, c.cliente_id, c.sucursal_id, c.cuenta_recaudacion_id, c.link_pago, c.duracion_meses, c.datos_formulario, c.ejecutivo_id || null]);
  return r.rows[0];
}

/*
 * Ejecutivo de una venta de la tienda: el que ya atiende al cliente; si es nuevo, el ejecutivo activo
 * con menos contratos vigentes (reparto parejo). Sin ejecutivos, queda para los administradores.
 */
async function ejecutivoParaVenta(db, clienteId) {
  const r = await db.query(`
    SELECT COALESCE(
      (SELECT k.ejecutivo_id FROM contratos k JOIN usuarios u ON u.id = k.ejecutivo_id
        WHERE k.cliente_id = $1 AND u.activo ORDER BY k.creado_en DESC LIMIT 1),
      (SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.activo AND r.rol = 'ejecutivo'
        ORDER BY (SELECT count(*) FROM contratos k WHERE k.ejecutivo_id = u.id AND k.estado IN ('activo', 'pendiente')), u.id
        LIMIT 1)) AS id`, [clienteId]);
  return r.rows[0].id;
}

/* ---------- Pago en línea: la compra sigue solo con el pago aprobado ---------- */

async function asignarTransaccion(db, pagoId, idTransaccion) {
  await db.query('UPDATE pagos SET id_transaccion = $2 WHERE id = $1', [pagoId, idTransaccion]);
}

// Pago por su id en la pasarela, con su contrato y la compra (bloquea la fila: dos confirmaciones no se pisan)
async function pagoPorTransaccion(db, idTransaccion) {
  const r = await db.query(`
    SELECT p.id, p.estado, p.monto, p.pasarela, p.cuota, p.total_cuotas, p.contrato_id, p.id_transaccion,
           k.folio, k.estado AS estado_contrato, k.datos_formulario, k.cliente_id
      FROM pagos p JOIN contratos k ON k.id = p.contrato_id
     WHERE p.id_transaccion = $1
       FOR UPDATE OF p`, [idTransaccion]);
  return r.rows[0] || null;
}

// Pago de un contrato del cliente de la sesión (Mi cuenta)
async function pagoDelCliente(db, id, clienteId) {
  const r = await db.query(`SELECT p.id, p.estado, p.monto, p.pasarela FROM pagos p JOIN contratos k ON k.id = p.contrato_id
                             WHERE p.id = $1 AND k.cliente_id = $2 FOR UPDATE OF p`, [id, clienteId]);
  return r.rows[0] || null;
}

async function aprobarPago(db, id, respuesta) {
  const r = await db.query(`
    UPDATE pagos SET estado = 'pagado', fecha_pago = now(), conciliado_en = now(),
                     codigo_autorizacion = $2, ultimos_4 = $3, respuesta_pasarela = $4
     WHERE id = $1 AND estado = 'pendiente' RETURNING id`,
  [id, respuesta.codigo_autorizacion || null, respuesta.ultimos_4 || null, JSON.stringify(respuesta)]);
  return r.rowCount > 0;
}

async function rechazarPago(db, id, respuesta) {
  await db.query("UPDATE pagos SET estado = 'rechazado', respuesta_pasarela = $2 WHERE id = $1 AND estado = 'pendiente'", [id, JSON.stringify(respuesta)]);
}

// Nuevo intento de la misma cuota después de un rechazo
async function nuevoIntento(db, p) {
  const r = await db.query(`
    INSERT INTO pagos (contrato_id, monto, estado, pasarela, cuota, total_cuotas)
    VALUES ($1, $2, 'pendiente', $3, $4, $5) RETURNING id`, [p.contrato_id, p.monto, p.pasarela, p.cuota, p.total_cuotas]);
  return r.rows[0].id;
}

async function activarContrato(db, id) {
  await db.query("UPDATE contratos SET estado = 'activo' WHERE id = $1 AND estado = 'pendiente'", [id]);
}

// Compra de la tienda: contrato, cliente y lo que se ingresó en el formulario
async function compra(db, contratoId) {
  const r = await db.query(`
    SELECT k.id, k.folio, k.datos_formulario, k.cliente_id, k.ejecutivo_id, cl.rut AS cliente_rut, cl.razon_social AS cliente, cl.tipo_persona
      FROM contratos k JOIN clientes cl ON cl.id = k.cliente_id WHERE k.id = $1`, [contratoId]);
  return r.rows[0] || null;
}

// Resultado de la entrega (documentos y cuenta) para mostrarlo al volver de la pasarela
async function guardarEntrega(db, contratoId, entrega) {
  await db.query(`UPDATE contratos SET datos_formulario = jsonb_set(COALESCE(datos_formulario, '{}'), '{entrega}', $2::jsonb)
                   WHERE id = $1`, [contratoId, JSON.stringify(entrega)]);
}

module.exports = {
  servicioDePlan, crearServicioDePlan, clientePorRut, representante, crearCliente, comunas, puntoDeVenta, crearContrato,
  ejecutivoParaVenta, asignarTransaccion, pagoPorTransaccion, pagoDelCliente, aprobarPago, rechazarPago, nuevoIntento, activarContrato, compra, guardarEntrega
};
