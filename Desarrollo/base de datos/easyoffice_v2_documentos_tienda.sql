-- =====================================================================
-- EASY OFFICE · Migración v2 → documentos de la tienda
-- Ejecutar UNA vez sobre EO_ER (en pgAdmin: Query Tool → abrir este archivo → F5),
-- después de easyoffice_v2_cuentas_portal.sql. easyoffice_v2.sql ya lo incluye.
--
--   PLANTILLAS  Cada documento Word se vincula a uno o más planes de la tienda
--               (plantilla_planes) y dice cómo se entrega: automática o tras
--               revisión del personal (entrega). mapa_campos guarda qué dato va en
--               cada marca del Word ([RUT EMPRESA], campos de combinación…).
--   DOCUMENTOS  El cliente revisa un borrador con marca de agua y lo acepta antes
--               de recibir el documento final (estado_cliente, aceptado_*).
--   TICKETS     Si no está de acuerdo, envía un ticket a la administración.
-- =====================================================================
BEGIN;

-- ---- Plantillas: entrega y campos ----
ALTER TABLE plantillas_documento
    ADD COLUMN entrega     text NOT NULL DEFAULT 'revision' CHECK (entrega IN ('automatica', 'revision')),
    -- {"<marca del Word>": {"dato": "RUT" | "_tienda" | "_ejecutivo" | "_ignorar", "etiqueta": "..."}}
    ADD COLUMN mapa_campos jsonb;

-- Planes de la tienda (id del plan en public/js/catalogo.js, ej. dom-anual) que usan cada plantilla
CREATE TABLE plantilla_planes (
    plantilla_id  int  NOT NULL REFERENCES plantillas_documento (id) ON DELETE CASCADE,
    plan_codigo   text NOT NULL CHECK (plan_codigo ~ '^[a-z0-9-]+$'),
    PRIMARY KEY (plantilla_id, plan_codigo)
);
CREATE INDEX ix_plantilla_planes_plan ON plantilla_planes (plan_codigo);

-- ---- Documentos: revisión y aceptación del cliente ----
ALTER TABLE documentos
    ADD COLUMN estado_cliente   text CHECK (estado_cliente IN ('por_revisar', 'aceptado', 'objetado')),
    ADD COLUMN publicado_en     timestamptz,              -- desde cuándo el cliente ve el borrador
    ADD COLUMN aceptado_en      timestamptz,
    ADD COLUMN aceptado_por     citext,                   -- correo de quien aceptó
    ADD COLUMN aceptado_ip      inet,
    ADD COLUMN version_aceptada int,
    ADD CONSTRAINT ck_documentos_aceptado
        CHECK (estado_cliente IS DISTINCT FROM 'aceptado' OR (aceptado_en IS NOT NULL AND aceptado_por IS NOT NULL));

-- ---- Tickets del cliente a la administración ----
CREATE TABLE tickets (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id      int    NOT NULL REFERENCES clientes (id) ON DELETE CASCADE,
    documento_id    int    REFERENCES documentos (id) ON DELETE SET NULL,
    email           citext,                               -- quién lo envió desde el portal
    motivo          text   NOT NULL CHECK (motivo IN ('datos_incorrectos', 'condiciones', 'falta_informacion', 'otro')),
    detalle         text   NOT NULL CHECK (length(detalle) BETWEEN 1 AND 4000),
    estado          text   NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_proceso', 'resuelto', 'cerrado')),
    respuesta       text,
    atendido_por    int    REFERENCES usuarios (id),
    creado_en       timestamptz NOT NULL DEFAULT now(),
    actualizado_en  timestamptz
);
CREATE INDEX ix_tickets_cliente   ON tickets (cliente_id);
CREATE INDEX ix_tickets_documento ON tickets (documento_id);
CREATE INDEX ix_tickets_estado    ON tickets (estado, creado_en DESC);

-- ---- Auditoría automática ----
CREATE TRIGGER trg_auditoria_plantilla_planes AFTER INSERT OR UPDATE OR DELETE ON plantilla_planes
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();
CREATE TRIGGER trg_auditoria_tickets AFTER INSERT OR UPDATE OR DELETE ON tickets
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();

-- ---- Seguridad por fila: los tickets siguen la visibilidad del cliente ----
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_tickets ON tickets
    USING (app_es_admin() OR EXISTS (SELECT 1 FROM clientes c WHERE c.id = tickets.cliente_id));
CREATE POLICY p_portal_tickets ON tickets FOR SELECT TO rol_portal USING (cliente_id = app_cliente());

-- ---- Permisos ----
GRANT SELECT ON plantilla_planes TO rol_ejecutivo;
GRANT SELECT ON tickets TO rol_ejecutivo;
GRANT UPDATE (estado, respuesta, atendido_por, actualizado_en) ON tickets TO rol_ejecutivo;
GRANT ALL PRIVILEGES ON plantilla_planes, tickets TO rol_admin;
GRANT SELECT ON tickets TO rol_portal;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rol_ejecutivo, rol_admin, rol_portal;

COMMIT;
