-- =====================================================================
-- EASY OFFICE · Migración v2 → cuentas del portal de clientes
-- Ejecutar UNA vez sobre una base creada con easyoffice_v2.sql anterior
-- a esta tabla (en pgAdmin: Query Tool sobre EO_ER → abrir este archivo → F5).
-- easyoffice_v2.sql ya la incluye: una base nueva no necesita este script.
--
-- Acceso a /mi-cuenta con correo y contraseña:
--   PERSONA NATURAL  correo del cliente (clientes.email) + contraseña.
--   EMPRESA          RUT de la empresa + correo de una persona vinculada + contraseña.
--                    Vinculadas: el representante legal (representantes_legales.email)
--                    y las personas que el CRM autorice (filas con autorizado = true).
-- La contraseña la define la propia persona con un enlace enviado a su correo;
-- hasta entonces password_hash queda NULL. Una fila por (cliente, correo):
-- quien representa a varias empresas tiene una contraseña por empresa.
-- =====================================================================
BEGIN;

CREATE TABLE cuentas_portal (
    id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id         int    NOT NULL REFERENCES clientes (id) ON DELETE CASCADE,
    email              citext NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    nombre             text,                                  -- nombre de la persona autorizada
    autorizado         boolean NOT NULL DEFAULT false,        -- true: agregada desde el CRM
    password_hash      text CHECK (password_hash ~ '^\$2[aby]\$'),  -- bcrypt; NULL hasta que la crea
    activo             boolean NOT NULL DEFAULT true,         -- false: el CRM le quitó el acceso
    clave_definida_en  timestamptz,
    ultimo_ingreso     timestamptz,
    registrado_por     int DEFAULT app_usuario() REFERENCES usuarios (id),
    creado_en          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cliente_id, email)
);
CREATE INDEX ix_cuentas_portal_email ON cuentas_portal (email);

-- Sin trigger de auditoría (guardaría password_hash en la bitácora): la aplicación
-- registra en registros_actividad los ingresos al portal; registrado_por dice quién autorizó.

ALTER TABLE cuentas_portal ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_cuentas_portal ON cuentas_portal
    USING (app_es_admin() OR EXISTS (SELECT 1 FROM clientes c WHERE c.id = cuentas_portal.cliente_id));

-- El ejecutivo ve y administra los accesos de su cartera, pero nunca el hash
GRANT SELECT (id, cliente_id, email, nombre, autorizado, activo, clave_definida_en, ultimo_ingreso, registrado_por, creado_en)
    ON cuentas_portal TO rol_ejecutivo;
GRANT INSERT (cliente_id, email, nombre, autorizado, activo) ON cuentas_portal TO rol_ejecutivo;
GRANT UPDATE (nombre, autorizado, activo) ON cuentas_portal TO rol_ejecutivo;
GRANT ALL PRIVILEGES ON cuentas_portal TO rol_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rol_ejecutivo, rol_admin;

COMMIT;
