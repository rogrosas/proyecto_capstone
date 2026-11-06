-- =====================================================================
-- EASY OFFICE · Datos de muestra para easyoffice_v2.sql
-- Ejecutar UNA vez sobre la base creada con easyoffice_v2.sql (con la tabla cuentas_portal).
--
-- Origen: hoja INFORMACIONES, las 2 filas de la muestra de campos y los contratos
-- LF-0150-2026 (bodega) y LF-0152-2026 (oficina), igual que easyoffice_datos_muestra.sql.
-- Diferencias con ese archivo (que es para easyoffice_er.sql):
--   - No crea regiones, comunas ni roles: easyoffice_v2.sql ya los trae ("Til Til" → "Tiltil").
--   - Las plantillas apuntan a los .docx reales de la carpeta Contratos.
--   - Datos ficticios (dominio .test) para probar el portal /mi-cuenta: correo de los
--     representantes legales y una clienta persona natural con su contrato.
--   - Tienda: planes de domicilio vinculados a los contratos de oficina y bodega
--     (requiere easyoffice_v2_documentos_tienda.sql si la base es anterior).
-- NO incluye la fila PROMIN SPA del formulario: el RUT de su representante
-- (10.970.598-9) tiene dígito verificador inválido (el correcto sería 10.970.598-5).
--
-- El usuario de ejemplo (Diego Muñoz) queda sin contraseña válida: para usarlo,
-- "npm run crear-usuario" con su correo restablece la contraseña.
-- =====================================================================
BEGIN;

-- ---------- Direcciones (regiones y comunas vienen en easyoffice_v2.sql) ----------
INSERT INTO direcciones (calle, numero, complemento, comuna_id)
SELECT v.calle, v.numero, v.compl, c.id
FROM (VALUES
  ('Vicuña Mackenna Poniente', '7255', 'Oficina 707', 'La Florida'),
  ('Blanco',                   '1215', 'Oficina 405', 'Valparaíso'),
  ('El Potrerillo',            '8',    'Oficina C',   'Algarrobo'),
  ('Avenida General Oscar Bonilla', '5933', 'Depto 102', 'Lo Prado'),
  ('Los Guindos',              '5970', NULL,          'Peñalolén'),
  ('Panamericana Norte',       '213',  NULL,          'Tiltil'),
  ('Las Acacias',              '2200', NULL,          'San Bernardo'),
  ('Los Aromos',               '1450', 'Depto 31',    'Viña del Mar')       -- ficticia: clienta persona natural
) v(calle, numero, compl, comuna)
JOIN comunas c ON c.nombre_comuna = v.comuna;

-- ---------- Usuarios ----------
INSERT INTO usuarios (nombre, email, rol_id, password_hash)
SELECT 'Diego Muñoz', 'diego.munoz@easyoffice.cl', id, 'HASH_DE_EJEMPLO' FROM roles WHERE rol = 'admin';
SELECT set_config('app.usuario_actual', (SELECT id::text FROM usuarios LIMIT 1), true);

-- ---------- Representantes legales ----------
-- Correos ficticios (.test): con ellos el representante ingresa a /mi-cuenta por su empresa
INSERT INTO representantes_legales (rut, nombre_completo, nacionalidad, estado_civil, profesion, email, direccion_id)
SELECT v.rut, v.nombre, v.nac, v.ec, v.prof, v.mail, d.id
FROM (VALUES
  ('10398885-3', 'MARCO ANTONIO ESCOBAR DONOSO',  'chileno', 'divorciado', 'ingeniero de ejecución', NULL, 'Blanco'),
  ('26204447-5', 'JESUS RAMÓN MARCANO JIMENEZ',   NULL, NULL, NULL, 'jesus.marcano@ejemplo.test',  'Avenida General Oscar Bonilla'),
  ('15378280-6', 'JAVIER IGNACIO GONZALEZ SOISSA', NULL, NULL, NULL, 'javier.gonzalez@ejemplo.test', 'Los Guindos'),
  ('14144266-K', 'OSCAR CONTRERAS BENAVIDES',     NULL, NULL, NULL, 'oscar.contreras@ejemplo.test', 'Panamericana Norte'),
  ('21456590-0', 'MATIAS JIMENEZ LEAL',           NULL, NULL, NULL, 'matias.jimenez@ejemplo.test',  'Las Acacias')
) v(rut, nombre, nac, ec, prof, mail, calle)
JOIN direcciones d ON d.calle = v.calle;

-- ---------- Emisoras, propietario, sucursales, cuentas ----------
INSERT INTO empresas_emisoras (nombre_comercial, razon_social, rut, representante_legal_id,
                               personeria_fecha, personeria_fuente, telefono)
SELECT v.n, 'EASY OFFICE SpA', '76767272-1', r.id, DATE '2017-08-10',
       'Registro de Empresas y Sociedades, Ley Nº 20.659', '+56 2 22777781'
FROM (VALUES ('EASY OFFICE'), ('INOFFICE')) v(n)
JOIN representantes_legales r ON r.rut = '10398885-3';

INSERT INTO propietarios_inmueble (rut, razon_social, representante_legal_id, direccion_id)
SELECT '76431160-4', 'MARCO ANTONIO ESCOBAR DONOSO SERVICIOS RETAIL E.I.R.L', r.id, r.direccion_id
FROM representantes_legales r WHERE r.rut = '10398885-3';

INSERT INTO sucursales (empresa_id, nombre, direccion_id, rol_propiedad, prefijo_folio, propietario_id, unidad_sii)
SELECT e.id, v.nombre, d.id, v.rol, v.pref, p.id, v.sii
FROM (VALUES
  ('La Florida',  'Vicuña Mackenna Poniente', '271-147', 'LF', TRUE,  'SAN ANTONIO LA FLORIDA'),
  ('Valparaíso',  'Blanco',                   '15-12',   'VL', TRUE,  NULL),
  ('San Antonio', 'El Potrerillo',            '267-56',  'SA', FALSE, NULL)
) v(nombre, calle, rol, pref, con_prop, sii)
JOIN empresas_emisoras e ON e.nombre_comercial = 'EASY OFFICE'
JOIN direcciones d ON d.calle = v.calle
LEFT JOIN propietarios_inmueble p ON v.con_prop;

INSERT INTO cuentas_recaudacion (empresa_id, banco, tipo_cuenta, numero_cuenta, titular, rut_titular)
SELECT e.id, v.banco, v.tipo, v.num, 'EASY OFFICE SpA', '76767272-1'
FROM (VALUES
  ('EASY OFFICE', 'Banco Estado',        'Cuenta Corriente / Chequera Electrónica', '25770158951'),
  ('INOFFICE',    'Banco Mercado Pago',  'Cuenta Vista',                            '1159226880')
) v(emp, banco, tipo, num)
JOIN empresas_emisoras e ON e.nombre_comercial = v.emp;

-- ---------- Catálogo de servicios ----------
INSERT INTO servicios (nombre, tipo, descripcion_base, precio_lista, precio_desde, unidad, ciclo_pago_defecto) VALUES
('DOMICILIO TRIBUTARIO', 'PRINCIPAL',
 E'Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades',
 59990, false, NULL, 'ANUAL'),
('BODEGA VIRTUAL', 'PRINCIPAL',
 E'Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.',
 59990, false, NULL, 'ANUAL'),
('CREACION DE EMPRESAS', 'PRINCIPAL',
 E'Constitución empresa en un día, hasta 3 socios\nObtención de rut\nDomicilio tributario x 3 meses\nInicio de actividad ante el SII\nInscripción factura electrónica\nGestión conjunta solicitud cuenta emprendedor BancoEstado',
 49990, false, NULL, 'UNICO'),
('WEB MAIL + DOMINIO', 'PRINCIPAL',
 E'Servicio web mail corporativo 1 GB + dominio x 1 año',
 14990, false, NULL, 'ANUAL'),
('CONTABILIDAD', 'PRINCIPAL', NULL, 15900, true, NULL, 'MENSUAL'),
-- Servicios de cargo complementario (Anexo 1)
('FIRMA ELECTRÓNICA AVANZADA', 'COMPLEMENTARIO',
 'Autentificado con Clave Única y Red de Notarios digitales. Trámite 100% online.', 5900, false, 'por firma', 'UNICO'),
('BOLSA DE 10 FIRMAS ELECTRÓNICAS AVANZADAS', 'COMPLEMENTARIO',
 'Autentificado con Clave Única y red de notarios digitales. Vigencia 6 meses, renovables.', 29990, false, 'por bolsa', 'UNICO'),
('FIRMA ELECTRÓNICA AVANZADA PARA CONTRATOS', 'COMPLEMENTARIO',
 'Hasta 3 firmantes. Contratos entre dos partes: laborales, servicios, compraventa, arriendo de vehículo y propiedades, entre otros. Trámite 100% online.', 14900, true, 'por contrato', 'UNICO'),
('DECLARACIONES JURADAS DE UNA FIRMA', 'COMPLEMENTARIO', NULL, 9900, true, 'por documento', 'UNICO'),
('DECLARACIONES JURADAS DE DOS FIRMAS', 'COMPLEMENTARIO', NULL, 14900, false, 'por documento', 'UNICO'),
('PODERES Y AUTORIZACIONES', 'COMPLEMENTARIO',
 'Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.', 9900, true, 'por documento', 'UNICO'),
('CERTIFICACIÓN NOTARIAL', 'COMPLEMENTARIO',
 'Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.', 14900, true, 'por documento', 'UNICO'),
('PROTOCOLIZACIÓN NOTARIAL', 'COMPLEMENTARIO',
 'Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.', 14900, true, 'por documento', 'UNICO'),
('AUTENTIFICACIÓN NOTARIAL', 'COMPLEMENTARIO',
 'Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.', 14900, true, 'por documento', 'UNICO'),
('SERVICIO DE REMUNERACIONES', 'COMPLEMENTARIO', NULL, 14900, true, 'por persona', 'MENSUAL'),
('IMPRESIÓN/DIGITALIZACIÓN DE DOCUMENTOS', 'COMPLEMENTARIO', NULL, 1900, false, 'por página', 'UNICO');

-- ---------- Plantillas de documentos ----------
INSERT INTO plantillas_documento (tipo_documento, familia, archivo_base, requiere_revision, campos) VALUES
('CONTRATO DE SERVICIOS OFICINA', 'CONTRATO_SERVICIO', 'CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx', false,
 '[{"clave":"folio","tipo":"texto","origen":"contratos.folio"},{"clave":"datos","tipo":"vista","origen":"v_datos_contrato"},{"clave":"servicios","tipo":"vista","origen":"v_datos_contrato_servicios"}]'),
('CONTRATO DE SERVICIOS BODEGA', 'CONTRATO_SERVICIO', 'CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx', false,
 '[{"clave":"folio","tipo":"texto","origen":"contratos.folio"},{"clave":"datos","tipo":"vista","origen":"v_datos_contrato"},{"clave":"servicios","tipo":"vista","origen":"v_datos_contrato_servicios"}]'),
-- El poder simple no vino entre los archivos: se registra con los datos que describe la especificación.
('PODER SIMPLE', 'PODER', NULL, true,
 '[{"clave":"fecha","etiqueta":"Fecha","tipo":"fecha"},{"clave":"empresa","etiqueta":"Datos de la empresa","tipo":"cliente"},{"clave":"representante","etiqueta":"Representante / apoderado","tipo":"parte"}]'),
('ACUERDO DE ACCIONISTAS', 'ACUERDO_ACCIONISTAS', 'TE1D - ACUERDO DE ACCIONISTAS PARA SPA (1).docx', true,
 '[{"clave":"sociedad","etiqueta":"Sociedad","tipo":"texto"},{"clave":"lugar","etiqueta":"Ciudad","tipo":"texto"},{"clave":"fecha","etiqueta":"Fecha","tipo":"fecha"},{"clave":"total_acciones","etiqueta":"Total de acciones","tipo":"entero"},{"clave":"capital","etiqueta":"Capital (CLP)","tipo":"monto"}]'),
('CONTRATO DE ARRIENDO DE ESTACIONAMIENTO', 'ARRIENDO', 'CONTRATO DE ARRIENDO ESTACIONAMIENTO (1).docx', false,
 '[{"clave":"fecha","tipo":"fecha"},{"clave":"depto_numero","tipo":"texto"},{"clave":"fojas","tipo":"texto"},{"clave":"inscripcion_numero","tipo":"texto"},{"clave":"conservador","tipo":"texto"},{"clave":"anio_inscripcion","tipo":"entero"},{"clave":"estacionamiento_numero","tipo":"texto"},{"clave":"piso","tipo":"texto"},{"clave":"renta","tipo":"monto"},{"clave":"banco","tipo":"texto"},{"clave":"tipo_cuenta","tipo":"texto"},{"clave":"numero_cuenta","tipo":"texto"},{"clave":"email_aviso_pago","tipo":"email"},{"clave":"vigencia_meses","tipo":"entero"},{"clave":"fecha_inicio","tipo":"fecha"},{"clave":"renovacion_meses","tipo":"entero"}]'),
('CONTRATO DE ARRIENDO DE VEHÍCULO', 'ARRIENDO', 'CONTRATO DE ARRIENDO VEHICULO (1).docx', false,
 '[{"clave":"comuna","tipo":"texto"},{"clave":"fecha","tipo":"fecha"},{"clave":"marca","tipo":"texto"},{"clave":"modelo","tipo":"texto"},{"clave":"anio","tipo":"entero"},{"clave":"patente","tipo":"texto"},{"clave":"color","tipo":"texto"},{"clave":"vin","tipo":"texto"},{"clave":"plazo","tipo":"texto"},{"clave":"fecha_inicio","tipo":"fecha"},{"clave":"fecha_termino","tipo":"fecha"},{"clave":"renta_mensual","tipo":"monto"},{"clave":"renta_en_palabras","tipo":"texto"},{"clave":"dias_pago","tipo":"entero"},{"clave":"medio_pago","tipo":"texto"}]');

-- Artículos del acuerdo de accionistas (ejemplos tomados del documento y de la especificación)
INSERT INTO clausulas_documento (familia, codigo, titulo, texto_plantilla, campos) VALUES
('ACUERDO_ACCIONISTAS', 'ELIMINAR_REPRESENTANTE', 'Eliminar representante legal',
 'Se elimina a don {saliente_nombre}, como representante legal y gerente. En su reemplazo asume como gerente don {entrante_nombre}, cédula nacional de identidad número {entrante_rut}, también como representante legal ante el Servicio de Impuestos Internos.',
 '["saliente_nombre","entrante_nombre","entrante_rut"]'),
('ACUERDO_ACCIONISTAS', 'CAMBIO_RAZON_SOCIAL', 'Cambio de razón social',
 'Se elimina la razón social antigua de {razon_social_antigua} y se agrega la nueva razón social de la empresa: {razon_social_nueva}.',
 '["razon_social_antigua","razon_social_nueva"]'),
('ACUERDO_ACCIONISTAS', 'CAMBIO_NOMBRE_FANTASIA', 'Cambio de nombre de fantasía',
 'Se elimina el nombre de fantasía antiguo de {nombre_antiguo} y se agrega el nuevo nombre de fantasía de la empresa: {nombre_nuevo}.',
 '["nombre_antiguo","nombre_nuevo"]'),
('ACUERDO_ACCIONISTAS', 'ELIMINAR_ACCIONISTA', 'Eliminar accionista',
 'Se elimina a don {accionista_nombre}, cédula nacional de identidad número {accionista_rut}, como accionista de la sociedad.',
 '["accionista_nombre","accionista_rut"]'),
('ACUERDO_ACCIONISTAS', 'AJUSTAR_CAPITAL', 'Ajustar capital',
 'Se modifica el capital de la sociedad, que pasa de {capital_anterior} a {capital_nuevo} pesos, dividido en {acciones} acciones ordinarias de la serie única.',
 '["capital_anterior","capital_nuevo","acciones"]'),
('ACUERDO_ACCIONISTAS', 'FACULTAR_GESTION', 'Facultar para realizar los trámites',
 'Los accionistas facultan a don {apoderado_nombre}, cédula nacional de identidad número {apoderado_rut}, para que efectúe las modificaciones y suscripciones ante el Registro de Empresas y Sociedades del presente acto.',
 '["apoderado_nombre","apoderado_rut"]');

-- ---------- Clientes ----------
INSERT INTO clientes (rut, tipo_persona, razon_social, giro_principal, email, celular, representante_legal_id,
                      fecha_escritura, sitio_notaria, registrado_por)
SELECT v.rut, 'juridica', v.rs, v.giro, v.mail, v.cel, r.id, v.esc, v.sitio, u.id
FROM (VALUES
  ('77496835-0', 'JM IMPORT SpA', 'VENTA X INTERNET', 'jrmj1592@gmail.com', '949836363', '26204447-5',
   DATE '2021-12-16', 'www.registrodeempresasysociedades.cl'),
  ('78332529-2', 'Sx4x4 SpA', 'MECÁNICA A DOMICILIO', 'soissaextreme@gmail.com', '991882417', '15378280-6',
   DATE '2026-01-12', 'www.tuempresaenundia.cl'),
  ('78007592-9', 'SOLDADURAS IRON SOLDERING MATIAS JIMENEZ LEAL E.I.R.L.', 'SERVICIOS DE SOLDADURA',
   'aironsoldiering@gmail.com', '957482381', '21456590-0', NULL, NULL),
  ('78526673-0', 'ALTUS AND COMPANY CO. SPA', 'COMERCIALIZADORA', 'contacto@altusandcompany.cl', '932365169',
   '14144266-K', DATE '2026-10-02', 'www.tuempresaenundia.cl')
) v(rut, rs, giro, mail, cel, rut_rep, esc, sitio)
JOIN representantes_legales r ON r.rut = v.rut_rep
JOIN usuarios u ON u.email = 'diego.munoz@easyoffice.cl';

-- Persona natural ficticia: ingresa a /mi-cuenta como "Persona" con su correo
INSERT INTO clientes (rut, tipo_persona, razon_social, giro_principal, email, celular, direccion_id, registrado_por)
SELECT '16543210-K', 'natural', 'CAMILA ANDREA ROJAS PEREZ', 'ASESORÍAS DE DISEÑO', 'camila.rojas@ejemplo.test', '987654321', d.id, u.id
FROM direcciones d, usuarios u
WHERE d.calle = 'Los Aromos' AND u.email = 'diego.munoz@easyoffice.cl';

-- ---------- Contratos (folios explícitos: vienen de los Excel / contratos existentes) ----------
INSERT INTO contratos (folio, empresa_id, cliente_id, sucursal_id, cuenta_recaudacion_id,
                       fecha_celebracion, fecha_inicio, duracion_meses, fecha_vencimiento, ejecutivo_id)
SELECT v.folio, e.id, cl.id, su.id, ca.id, v.fc, v.fc, 12, v.fv, u.id
FROM (VALUES
  ('LF-01-2026',   '77496835-0', DATE '2026-01-15', DATE '2027-01-13'),   -- vencimiento tal cual el Excel
  ('LF-02-2026',   '78332529-2', DATE '2026-01-15', DATE '2027-01-14'),
  ('LF-0150-2026', '78007592-9', DATE '2026-09-25', NULL),                -- vence 2027-09-24 por defecto
  ('LF-0152-2026', '78526673-0', DATE '2026-10-02', NULL)                 -- vence 2027-10-01 por defecto
) v(folio, rut, fc, fv)
JOIN clientes cl ON cl.rut = v.rut
JOIN empresas_emisoras e ON e.nombre_comercial = 'EASY OFFICE'
JOIN sucursales su ON su.prefijo_folio = 'LF'
JOIN cuentas_recaudacion ca ON ca.empresa_id = e.id
JOIN usuarios u ON u.email = 'diego.munoz@easyoffice.cl';

-- Persona natural: el folio y el vencimiento los pone la base de datos
INSERT INTO contratos (empresa_id, cliente_id, sucursal_id, cuenta_recaudacion_id, fecha_celebracion, fecha_inicio,
                       duracion_meses, ejecutivo_id)
SELECT e.id, cl.id, su.id, ca.id, DATE '2026-08-01', DATE '2026-08-01', 12, u.id
FROM clientes cl
JOIN empresas_emisoras e ON e.nombre_comercial = 'EASY OFFICE'
JOIN sucursales su ON su.prefijo_folio = 'LF'
JOIN cuentas_recaudacion ca ON ca.empresa_id = e.id
JOIN usuarios u ON u.email = 'diego.munoz@easyoffice.cl'
WHERE cl.rut = '16543210-K';

-- Servicios de cada folio. NULL en precio = usar el del catálogo.
INSERT INTO contrato_servicios (contrato_id, orden, servicio_id, precio)
SELECT k.id, v.orden, sv.id, v.precio
FROM (VALUES
  ('LF-01-2026',   1, 'DOMICILIO TRIBUTARIO', NULL::numeric),
  ('LF-01-2026',   2, 'BODEGA VIRTUAL',       71388),              -- precio acordado del Excel (catálogo: 59.990)
  ('LF-02-2026',   1, 'DOMICILIO TRIBUTARIO', NULL),
  ('LF-02-2026',   2, 'CREACION DE EMPRESAS', NULL),
  ('LF-0150-2026', 1, 'DOMICILIO TRIBUTARIO', NULL),
  ('LF-0150-2026', 2, 'BODEGA VIRTUAL',       NULL),
  ('LF-0152-2026', 1, 'CREACION DE EMPRESAS', NULL),
  ('LF-0152-2026', 2, 'DOMICILIO TRIBUTARIO', NULL),
  ('LF-0152-2026', 3, 'WEB MAIL + DOMINIO',   NULL)
) v(folio, orden, servicio, precio)
JOIN contratos k  ON k.folio = v.folio
JOIN servicios sv ON sv.nombre = v.servicio;

INSERT INTO contrato_servicios (contrato_id, orden, servicio_id, precio)
SELECT k.id, 1, sv.id, NULL
FROM contratos k JOIN clientes cl ON cl.id = k.cliente_id, servicios sv
WHERE cl.rut = '16543210-K' AND sv.nombre = 'DOMICILIO TRIBUTARIO';

-- Documentos generados para los dos contratos reales
INSERT INTO documentos (cliente_id, contrato_id, plantilla_id, tipo, lugar, fecha_documento, ejecutivo_id)
SELECT k.cliente_id, k.id, p.id, p.tipo_documento, k.lugar_celebracion, k.fecha_celebracion, k.ejecutivo_id
FROM contratos k
JOIN plantillas_documento p ON p.tipo_documento =
     CASE k.folio WHEN 'LF-0150-2026' THEN 'CONTRATO DE SERVICIOS BODEGA'
                  WHEN 'LF-0152-2026' THEN 'CONTRATO DE SERVICIOS OFICINA' END
WHERE k.folio IN ('LF-0150-2026', 'LF-0152-2026');

-- ---------- Pagos de ejemplo ----------
-- LF-0152 (Altus): modalidad 50/50 del primer servicio y primer cuota ya pagada por Webpay.
INSERT INTO pagos (contrato_id, monto, estado, pasarela, fecha_pago, cuota, total_cuotas)
SELECT k.id, v.monto, v.estado, v.pasarela, v.fecha, v.cuota, 2
FROM contratos k
JOIN (VALUES (1, 62485, 'pagado',    'transbank', TIMESTAMPTZ '2026-10-02 10:31-03'),
             (2, 62485, 'pendiente', 'transbank', NULL::timestamptz)) v(cuota, monto, estado, pasarela, fecha) ON true
WHERE k.folio = 'LF-0152-2026';

-- Persona natural: pago completo del domicilio por transferencia
INSERT INTO pagos (contrato_id, monto, estado, pasarela, fecha_pago, cuota, total_cuotas)
SELECT k.id, 59990, 'pagado', 'transferencia', TIMESTAMPTZ '2026-08-01 12:00-04', 1, 1
FROM contratos k JOIN clientes cl ON cl.id = k.cliente_id
WHERE cl.rut = '16543210-K';

-- ---------- Tienda: servicio de cada plan y documentos que genera la compra ----------
-- servicios.codigo = id del plan en public/js/catalogo.js. Los planes sin servicio se crean solos al venderse.
UPDATE servicios SET codigo = 'dom-anual' WHERE nombre = 'DOMICILIO TRIBUTARIO';
UPDATE servicios SET codigo = 'dom-bod'   WHERE nombre = 'BODEGA VIRTUAL';

INSERT INTO plantilla_planes (plantilla_id, plan_codigo)
SELECT p.id, v.plan
FROM (VALUES ('CONTRATO DE SERVICIOS OFICINA', 'dom-anual'),
             ('CONTRATO DE SERVICIOS OFICINA', 'dom-sem'),
             ('CONTRATO DE SERVICIOS BODEGA',  'dom-bod')) v(tipo, plan)
JOIN plantillas_documento p ON p.tipo_documento = v.tipo;

-- Oficina: la revisa el personal antes de publicarla. Bodega: llega directo al cliente para su revisión.
UPDATE plantillas_documento SET entrega = 'automatica' WHERE tipo_documento = 'CONTRATO DE SERVICIOS BODEGA';

COMMIT;
