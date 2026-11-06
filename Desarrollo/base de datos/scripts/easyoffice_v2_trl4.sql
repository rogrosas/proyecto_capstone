-- =====================================================================
-- EASY OFFICE · Migración v2 → entrega TRL 4 (avisos, firma, verificación)
-- Ejecutar UNA vez sobre EO_ER (en pgAdmin: Query Tool → abrir este archivo → F5),
-- después de easyoffice_v2_documentos_tienda.sql. easyoffice_v2.sql ya lo incluye:
-- una base creada desde cero con easyoffice_v2.sql no necesita esta migración.
--
--   AVISOS      ejecuciones_avisos: registro de cada envío de avisos de
--               vencimiento por correo (automático una vez al día, o manual).
-- =====================================================================
BEGIN;

-- ---- Avisos de vencimiento automáticos ----
CREATE TABLE ejecuciones_avisos (
    id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    origen        text NOT NULL CHECK (origen IN ('automatico', 'manual')),
    usuario_id    int  REFERENCES usuarios (id),            -- quién lo pidió (manual)
    iniciado_en   timestamptz NOT NULL DEFAULT now(),
    terminado_en  timestamptz,
    contratos     int  NOT NULL DEFAULT 0 CHECK (contratos >= 0),   -- contratos avisados
    correos       int  NOT NULL DEFAULT 0 CHECK (correos >= 0),     -- correos enviados a clientes
    sin_correo    int  NOT NULL DEFAULT 0 CHECK (sin_correo >= 0),  -- contratos cuyo cliente no tiene correo
    errores       int  NOT NULL DEFAULT 0 CHECK (errores >= 0),
    detalle       jsonb,                                    -- [{ folio, cliente, resultado }]
    CHECK (origen = 'automatico' OR usuario_id IS NOT NULL)
);
CREATE INDEX ix_ejecuciones_avisos_fecha ON ejecuciones_avisos (iniciado_en DESC);
GRANT ALL PRIVILEGES ON ejecuciones_avisos TO rol_admin;
GRANT USAGE, SELECT ON SEQUENCE ejecuciones_avisos_id_seq TO rol_admin;

-- ---- Firma electrónica: plataforma, firmantes y documento firmado ----
ALTER TABLE documentos
    ADD COLUMN firma_proveedor  text,                     -- 'simulador' en laboratorio, o la plataforma real
    ADD COLUMN enviado_firma_en timestamptz,
    ADD COLUMN archivo_firmado  text,                     -- ruta dentro de la carpeta de contratos
    ADD COLUMN hash_firmado     text CHECK (hash_firmado ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT ck_documentos_firmado_con_hash CHECK (archivo_firmado IS NULL OR hash_firmado IS NOT NULL);

CREATE TABLE documento_firmantes (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    documento_id    int    NOT NULL REFERENCES documentos (id) ON DELETE CASCADE,
    orden           smallint NOT NULL CHECK (orden > 0),
    nombre          text   NOT NULL,
    rut             text   CHECK (rut IS NULL OR fn_rut_valido(rut)),
    email           citext NOT NULL,
    estado          text   NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'firmado', 'rechazado')),
    id_externo      text,                              -- id del firmante en la plataforma
    firmado_en      timestamptz,
    ip              inet,
    motivo_rechazo  text,
    creado_en       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (documento_id, email),
    UNIQUE (documento_id, orden),
    CHECK (estado <> 'firmado' OR firmado_en IS NOT NULL),
    CHECK (estado <> 'rechazado' OR motivo_rechazo IS NOT NULL)
);
CREATE INDEX ix_documento_firmantes_externo ON documento_firmantes (id_externo) WHERE id_externo IS NOT NULL;

ALTER TABLE documento_firmantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_documento_firmantes ON documento_firmantes
    USING (EXISTS (SELECT 1 FROM documentos d WHERE d.id = documento_firmantes.documento_id));
CREATE POLICY p_portal_firmantes ON documento_firmantes FOR SELECT TO rol_portal
    USING (EXISTS (SELECT 1 FROM documentos d WHERE d.id = documento_firmantes.documento_id AND d.cliente_id = app_cliente()));
CREATE TRIGGER trg_auditoria_documento_firmantes
    AFTER INSERT OR UPDATE OR DELETE ON documento_firmantes
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();

GRANT SELECT, INSERT, UPDATE ON documento_firmantes TO rol_ejecutivo;
GRANT ALL PRIVILEGES ON documento_firmantes TO rol_admin;
GRANT SELECT ON documento_firmantes TO rol_portal;
GRANT USAGE, SELECT ON SEQUENCE documento_firmantes_id_seq TO rol_ejecutivo, rol_admin, rol_portal;

COMMIT;
