-- =====================================================================
-- EASY OFFICE · Migración v2 → tienda administrable desde el CRM
-- Ejecutar UNA vez sobre la base que usa la aplicación (Neon: SQL Editor o pgAdmin →
-- Query Tool → abrir este archivo → F5), después de easyoffice_v2_documentos_tienda.sql.
-- easyoffice_v2.sql ya lo incluye.
--
--   Los servicios y planes de la tienda dejan de estar escritos en
--   public/js/catalogo.js: viven en tienda_familias y tienda_planes y se editan
--   en CRM → Tienda. Se cargan con los mismos datos que tenía
--   catalogo.js, así que el sitio se ve igual tras ejecutarla.
--   Mientras no se ejecute, la aplicación sigue usando catalogo.js.
-- =====================================================================
BEGIN;

-- Tienda del sitio web (/contratar y páginas de servicio): se arma desde el CRM (Administración → Tienda).
-- Cada familia es una pestaña de la tienda; cada plan, una tarjeta que se compra en línea o se cotiza.
-- El código del plan (ej. dom-anual) es el que usan servicios.codigo y plantilla_planes.plan_codigo.
CREATE TABLE tienda_familias (
    id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo    text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9-]+$'),
    nombre    text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
    nota      text,                                        -- texto bajo las pestañas de la tienda
    orden     int  NOT NULL DEFAULT 0,
    activo    boolean NOT NULL DEFAULT true
);

CREATE TABLE tienda_planes (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo           text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9-]+$'),
    familia_id       int  NOT NULL REFERENCES tienda_familias (id),
    nombre           text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 100),
    precio           numeric(12, 0) CHECK (precio >= 0),   -- CLP; NULL = se cotiza (no se vende en línea)
    precio_texto     text,                                 -- lo que se muestra si se cotiza (ej. "UF 14")
    periodo          text NOT NULL DEFAULT '',             -- "12 meses · pago único", "mensual"...
    recurrencia      text NOT NULL CHECK (recurrencia IN ('anual', 'semestral', 'mensual', 'bolsa', 'unico', 'cotiza')),
    grupo            text CHECK (grupo IN ('bolsas', 'planes', 'digitales')),   -- listas de precios de la página de firmas
    corto            text,                                 -- texto corto en esas listas
    caracteristicas  text[] NOT NULL DEFAULT '{}',         -- resumen de la tarjeta en /contratar
    detalle          text[],                               -- lista completa en la página del servicio (opcional)
    orden            int  NOT NULL DEFAULT 0,
    activo           boolean NOT NULL DEFAULT true,
    CONSTRAINT ck_tienda_planes_cotiza CHECK ((precio IS NULL) = (recurrencia = 'cotiza'))
);
CREATE INDEX ix_tienda_planes_familia ON tienda_planes (familia_id, orden);

CREATE TRIGGER trg_auditoria_tienda_familias AFTER INSERT OR UPDATE OR DELETE ON tienda_familias
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();
CREATE TRIGGER trg_auditoria_tienda_planes AFTER INSERT OR UPDATE OR DELETE ON tienda_planes
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();

GRANT SELECT ON tienda_familias, tienda_planes TO rol_ejecutivo;
GRANT ALL PRIVILEGES ON tienda_familias, tienda_planes TO rol_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rol_ejecutivo, rol_admin, rol_portal;

INSERT INTO tienda_familias (codigo, nombre, nota, orden) VALUES
    ('domicilio', 'Domicilio tributario', 'Cobertura verificada en las regiones Metropolitana y de Valparaíso. Incluye recepción, digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo).', 10),
    ('contabilidad', 'Contabilidad & Tributaria', 'Planes mensuales válidos para regímenes Pro Pyme y Transparente. Otros regímenes requieren cotización personalizada con un ejecutivo.', 20),
    ('firmas', 'Firmas Electrónicas', 'Las bolsas tienen vigencia de 3 meses; los planes, de 1 año. El saldo disponible queda visible en el panel del cliente y se descuenta por cada documento firmado.', 30),
    ('digitales', 'Servicios digitales', 'Servicios de apoyo a la gestión documental. El acceso a la API permite a estudios contables y plataformas integrar la firma en sus propios sistemas.', 40),
    ('empresa', 'Empresa en 1 Día · Rebaja Tributaria', 'Los planes de Empresa en 1 Día se pagan en línea. La Rebaja Tributaria (valor en UF) y la asesoría dependen del capital declarado y del tipo de sociedad: el flujo termina en agendamiento con un ejecutivo, no en pago directo.', 50);

INSERT INTO tienda_planes (codigo, familia_id, nombre, precio, precio_texto, periodo, recurrencia, grupo, corto, caracteristicas, detalle, orden)
SELECT v.codigo, f.id, v.nombre, v.precio, v.precio_texto, v.periodo, v.recurrencia, v.grupo, v.corto, v.caracteristicas, v.detalle, v.orden
  FROM (VALUES
    ('dom-anual', 'domicilio', 'Plan Anual', 59990, NULL, '12 meses · pago único', 'anual', NULL, NULL,
     ARRAY['Domicilio tributario, postal y comercial x 12 meses', 'Recepción de correspondencia', 'Digitalización y envío de correspondencia fiscal', 'Inicio de actividad ante S.I.I.', 'Firmas electrónicas avanzadas del contrato']::text[],
     ARRAY['Domicilio tributario, postal y comercial x 12 meses', 'Recepción de correspondencia y oficina de partes', 'Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)', 'Inicio de actividad ante el S.I.I.', 'Firmas electrónicas avanzadas del contrato']::text[], 10),
    ('dom-sem', 'domicilio', 'Plan Semestral', 39990, NULL, '6 meses · pago único', 'semestral', NULL, NULL,
     ARRAY['Domicilio tributario, postal y comercial x 6 meses', 'Recepción de correspondencia', 'Digitalización y envío de correspondencia fiscal', 'Inicio de actividad ante S.I.I.', 'Firmas avanzadas por $5.000 adicionales']::text[],
     ARRAY['Domicilio tributario, postal y comercial x 6 meses', 'Recepción de correspondencia y oficina de partes', 'Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)', 'Inicio de actividad ante el S.I.I.', 'Firma avanzada del contrato $5.000']::text[], 20),
    ('dom-bod', 'domicilio', 'Plan Anual de Bodega Virtual', 59990, NULL, '12 meses · pago único', 'anual', NULL, NULL,
     ARRAY['Domicilio bodega x 12 meses', 'Inmueble con rol de bodega', 'Válido ante S.I.I.', 'Firmas electrónicas avanzadas del contrato']::text[],
     NULL, 30),
    ('cont-bas', 'contabilidad', 'Plan Básico', 22990, NULL, 'mensual', 'mensual', NULL, NULL,
     ARRAY['Declaración mensual de IVA', 'Libros electrónicos de ventas y compras', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Hasta 5 facturas mensuales']::text[],
     ARRAY['Declaración mensual de IVA', 'Libro Electrónico de Ventas, confeccionado y enviado mensualmente', 'Libro Electrónico de Compras, confeccionado y enviado mensualmente', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Válido sólo para regímenes Pro Pyme y Transparente', 'Hasta 5 facturas x mes']::text[], 10),
    ('cont-est', 'contabilidad', 'Plan Estándar', 37900, NULL, 'mensual', 'mensual', NULL, NULL,
     ARRAY['Declaración mensual de IVA', 'Libros electrónicos de ventas y compras', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Hasta 10 facturas mensuales']::text[],
     ARRAY['Declaración mensual de IVA', 'Libro Electrónico de Ventas, confeccionado y enviado mensualmente', 'Libro Electrónico de Compras, confeccionado y enviado mensualmente', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Válido sólo para regímenes Pro Pyme y Transparente', 'Hasta 10 facturas x mes']::text[], 20),
    ('cont-pyme', 'contabilidad', 'Plan Pyme', 59000, NULL, 'mensual', 'mensual', NULL, NULL,
     ARRAY['Declaración mensual de IVA', 'Libros electrónicos de ventas y compras', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Hasta 15 facturas mensuales']::text[],
     ARRAY['Declaración mensual de IVA', 'Libro Electrónico de Ventas, confeccionado y enviado mensualmente', 'Libro Electrónico de Compras, confeccionado y enviado mensualmente', 'Declaración Anual de Renta', 'Domicilio tributario, postal y comercial', 'Válido sólo para regímenes Pro Pyme y Transparente', 'Hasta 15 facturas x mes']::text[], 30),
    ('cont-rrhh', 'contabilidad', 'Servicio de RR.HH.', 14900, NULL, 'mensual · por persona', 'mensual', NULL, NULL,
     ARRAY['Liquidaciones de sueldo', 'Contratos de trabajo, anexos y finiquitos', 'Licencias médicas y nómina PreviRed', 'Libro de remuneraciones electrónico a la DT']::text[],
     ARRAY['Cálculo y confección de liquidaciones de sueldo', 'Confección de contratos de trabajo y anexos', 'Cálculo y confección de finiquitos del personal', 'Procesar y tramitar licencias médicas', 'Carga de nómina de imposiciones PreviRed', 'Control de vacaciones', 'Emisión y envío del libro de remuneraciones electrónico a la DT']::text[], 40),
    ('cont-inicio', 'contabilidad', 'Inicio de actividad', 14900, NULL, 'plan único', 'unico', NULL, NULL,
     ARRAY['Obtención de clave secreta', 'Inicio y verificación de actividad', 'Inscripción en factura electrónica SII', 'Logo en la factura electrónica']::text[],
     ARRAY['Obtención de clave secreta', 'Inicio de actividades', 'Verificación de actividad', 'Inscripción en factura electrónica SII', 'Centralización del certificado digital', 'Incorporación del logo a la factura electrónica']::text[], 50),
    ('fir-1', 'firmas', 'Bolsa · 1 firma avanzada', 3490, NULL, 'vigencia 3 meses', 'bolsa', 'bolsas', '1 firma electrónica avanzada',
     ARRAY['1 firma electrónica avanzada', 'Validez legal Ley 19.799', 'Firma desde cualquier dispositivo', 'Sin ir a notaría']::text[],
     NULL, 10),
    ('fir-3', 'firmas', 'Bolsa · 3 firmas avanzadas', 8990, NULL, 'vigencia 3 meses', 'bolsa', 'bolsas', '3 firmas electrónicas avanzadas',
     ARRAY['3 firmas electrónicas avanzadas', 'Validez legal Ley 19.799', 'Firma desde cualquier dispositivo', 'Saldo visible en su panel']::text[],
     NULL, 20),
    ('fir-10', 'firmas', 'Bolsa · 10 firmas avanzadas', 24990, NULL, 'vigencia 3 meses', 'bolsa', 'bolsas', '10 firmas electrónicas avanzadas',
     ARRAY['10 firmas electrónicas avanzadas', 'Validez legal Ley 19.799', 'Firma desde cualquier dispositivo', 'Saldo visible en su panel']::text[],
     NULL, 30),
    ('fir-5a', 'firmas', 'Plan · 5 firmas avanzadas', 9990, NULL, 'vigencia 1 año', 'anual', 'planes', '5 firmas electrónicas avanzadas',
     ARRAY['5 firmas electrónicas avanzadas', 'Vigencia 12 meses', 'Recordatorio antes de vencer', 'Saldo visible en su panel']::text[],
     NULL, 40),
    ('fir-25', 'firmas', 'Plan · 25 firmas avanzadas', 34990, NULL, 'vigencia 1 año', 'anual', 'planes', '25 firmas electrónicas avanzadas',
     ARRAY['25 firmas electrónicas avanzadas', 'Vigencia 12 meses', 'Recordatorio antes de vencer', 'Ideal para contratos recurrentes']::text[],
     NULL, 50),
    ('fir-50', 'firmas', 'Plan · 50 firmas avanzadas', 49990, NULL, 'vigencia 1 año', 'anual', 'planes', '50 firmas electrónicas avanzadas',
     ARRAY['50 firmas electrónicas avanzadas', 'Vigencia 12 meses', 'Recordatorio antes de vencer', 'Mejor precio por firma']::text[],
     NULL, 60),
    ('dig-not', 'digitales', 'Certificación o protocolización notarial', 13490, NULL, 'por documento', 'unico', 'digitales', '1 certificación o protocolización notarial',
     ARRAY['1 certificación o protocolización', 'Red de notarios digitales', 'Documento con validez legal', 'Entrega digital']::text[],
     NULL, 10),
    ('dig-api', 'digitales', 'Acceso a la API', 8990, NULL, 'mensual · desde', 'mensual', 'digitales', 'Acceso a la API, x mes desde',
     ARRAY['Integración de firma en su sistema', 'Documentación técnica', 'Ambiente de pruebas', 'Soporte de implementación']::text[],
     NULL, 20),
    ('dig-simple', 'digitales', 'Bolsa · 100 firmas simples', 24990, NULL, 'por bolsa', 'bolsa', 'digitales', '100 firmas electrónicas simples',
     ARRAY['100 firmas electrónicas simples', 'Para documentos de uso interno', 'Descuento por volumen', 'Saldo visible en su panel']::text[],
     NULL, 30),
    ('emp-te1d', 'empresa', 'Plan Básico TE1D', 79990, NULL, 'pago único', 'unico', NULL, NULL,
     ARRAY['Empresa en 1 Día, hasta 3 socios', 'Obtención de RUT', 'Domicilio tributario por 3 meses', 'Inicio de actividad ante el S.I.I.']::text[],
     ARRAY['Constitución de Empresa en 1 Día, hasta 3 socios', 'Obtención de RUT', 'Domicilio tributario por 3 meses', 'Inicio de actividad ante el S.I.I.', 'Verificación de actividad', 'Solicitud de factura electrónica', 'Solicitud de cuenta Emprendedor BancoEstado']::text[], 10),
    ('emp-activa', 'empresa', 'Plan EmpresActiva', 144990, NULL, 'pago único', 'unico', NULL, NULL,
     ARRAY['Creación de estatutos TE1D', 'Domicilio tributario x 1 año', 'Trámites SII hasta emitir factura', 'Certificado digital, dominio .cl y correo']::text[],
     ARRAY['Creación de estatutos TE1D', 'Domicilio tributario x 1 año', 'Todo trámite en SII hasta emitir factura (*)', 'Certificado digital x 1 año', 'Cuenta bancaria empresa', 'Dominio .cl', 'Webmail: 1 correo corporativo x 1 año', '(*) No incluye situaciones pendientes del representante legal o socios']::text[], 20),
    ('emp-lista', 'empresa', 'Plan Empresa Lista', 199990, NULL, 'pago único', 'unico', NULL, NULL,
     ARRAY['TE1D + RUT + inicio de actividades', 'Folios autorizados para facturar hoy', 'Domicilio tributario x 1 año', 'Incluye gasto notarial']::text[],
     ARRAY['TE1D + RUT + inicio de actividades', 'Folios autorizados para facturar hoy', 'Domicilio tributario x un año', 'Compraventa x el 100% de las acciones', 'Proceso 100% online', 'Incluye gasto notarial']::text[], 30),
    ('reb-anual', 'empresa', 'Rebaja Tributaria · Anual', NULL::numeric, 'UF 14', '12 meses · según capital propio', 'cotiza', NULL, NULL,
     ARRAY['Reduce 50% la patente comercial', 'Beneficio Municipalidad de La Florida', 'Domicilio tributario x 12 meses', 'Firmas avanzadas del contrato']::text[],
     ARRAY['Domicilio tributario, postal y comercial x 12 meses', 'Recepción de correspondencia y oficina de partes', 'Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)', 'Firmas electrónicas avanzadas del contrato']::text[], 40),
    ('reb-sem', 'empresa', 'Rebaja Tributaria · Semestral', NULL::numeric, 'UF 7,5', '6 meses · según capital propio', 'cotiza', NULL, NULL,
     ARRAY['Reduce 50% la patente comercial', 'Beneficio Municipalidad de La Florida', 'Domicilio tributario x 6 meses', 'Firmas avanzadas del contrato']::text[],
     ARRAY['Domicilio tributario, postal y comercial por 6 meses', 'Recepción de correspondencia y oficina de partes', 'Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)', 'Firmas electrónicas avanzadas del contrato']::text[], 50),
    ('emp-ases', 'empresa', 'Asesoría Empresas', NULL::numeric, NULL, 'reunión de 30 minutos', 'cotiza', NULL, NULL,
     ARRAY['Diagnóstico de su situación tributaria', 'Recomendación de plan', 'Sin costo ni compromiso', 'Presencial o por videollamada']::text[],
     NULL, 60)
  ) AS v (codigo, familia, nombre, precio, precio_texto, periodo, recurrencia, grupo, corto, caracteristicas, detalle, orden)
  JOIN tienda_familias f ON f.codigo = v.familia;

COMMIT;
