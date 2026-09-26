BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;    -- emails sin distinguir mayúsculas

-- 1. TERRITORIO Y DIRECCIONES

CREATE TABLE regiones (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_region   text NOT NULL UNIQUE
);

-- cada comuna ahora pertenece a una región (antes region_id no existía aquí, y la región se guardaba suelta en direcciones).

CREATE TABLE comunas (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_comuna   text NOT NULL,
    region_id       int NOT NULL REFERENCES regiones (id),
    UNIQUE (nombre_comuna, region_id)
);

CREATE INDEX ix_comunas_region ON comunas (region_id);

-- se quita el UNIQUE(calle, numero) global. la combinación única real se valida más abajo, ba nivel de dirección completa (calle-número + comuna).

CREATE TABLE calles_numeros (
    id      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    calle   text NOT NULL,
    numero  text NOT NULL              -- texto: admite "1234-B", "S/N", etc.
);

-- Una región / comuna / calle-número puede aparecer en muchas direcciones.
-- se quita id_region (se obtiene navegando id_comuna region_id, evitando que una dirección tenga una comuna y una región que no correspondan entre sí). 
-- Se agrega UNIQUE(id_calle_numero, id_comuna) para no duplicar la misma dirección dentro de la misma comuna.
CREATE TABLE direcciones (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_calle_numero  int NOT NULL REFERENCES calles_numeros (id),
    id_comuna        int NOT NULL REFERENCES comunas (id),
    UNIQUE (id_calle_numero, id_comuna)
);

CREATE INDEX ix_direcciones_calle_numero ON direcciones (id_calle_numero);
CREATE INDEX ix_direcciones_comuna       ON direcciones (id_comuna);


-- 2. RAZÓN SOCIAL (datos de la empresa del cliente)

CREATE TABLE razones_sociales (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut             text NOT NULL UNIQUE
                    CHECK (rut ~ '^[0-9]{7,8}-[0-9K]$'),   -- 12345678-K, sin puntos
    nombre_empresa  text NOT NULL,
    razon_social    text NOT NULL,
    giro_comercial  text,
    sitio_web       text,
    telefono        text,
    direccion_id    int REFERENCES direcciones (id)
);

CREATE INDEX ix_razones_sociales_direccion ON razones_sociales (direccion_id);


-- 3. ROLES, PERMISOS Y USUARIOS

CREATE TABLE roles (
    id   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rol  text NOT NULL UNIQUE
);

CREATE TABLE permisos (
    id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permiso  text NOT NULL UNIQUE
);

-- Relación N:M — un permiso está INCLUIDO EN varios roles y a un rol se le
-- ASIGNAN varios permisos
CREATE TABLE roles_permisos (
    rol_id       int NOT NULL REFERENCES roles (id)    ON DELETE CASCADE,
    permisos_id  int NOT NULL REFERENCES permisos (id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permisos_id)
);

CREATE INDEX ix_roles_permisos_permiso ON roles_permisos (permisos_id);

-- Un rol lo TIENEN muchos usuarios
CREATE TABLE usuarios (
    id      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre  text NOT NULL,
    email   citext NOT NULL UNIQUE,
    rol_id  int NOT NULL REFERENCES roles (id)
);

CREATE INDEX ix_usuarios_rol ON usuarios (rol_id);


-- 4. REGISTRO DE ACTIVIDAD (un usuario GENERA muchos registros)

CREATE TABLE registros_actividad (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id      int NOT NULL REFERENCES usuarios (id),
    tabla_afectada  text NOT NULL,
    accion          text NOT NULL
                    CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT')),
    fecha           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_registros_actividad_usuario ON registros_actividad (usuario_id, fecha DESC);
CREATE INDEX ix_registros_actividad_tabla   ON registros_actividad (tabla_afectada, fecha DESC);


-- 5. CLIENTES Y SERVICIOS

-- Un usuario REGISTRA muchos clientes.
-- Antes "rut" era NOT NULL y a la vez FK obligatoria hacia razones_sociales, por lo que un cliente no podía existir sin razón social.
-- Ahora "rut" es el identificador propio del cliente (siempre requerido), y "razon_social_rut" es una FK opcional que solo se llena cuando ese cliente tiene una empresa/razón social asociada.
CREATE TABLE clientes (
    id                int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut               text NOT NULL UNIQUE
                      CHECK (rut ~ '^[0-9]{7,8}-[0-9K]$'),
    razon_social_rut  text REFERENCES razones_sociales (rut) ON UPDATE CASCADE,
    usuario_id        int NOT NULL REFERENCES usuarios (id)
);

CREATE INDEX ix_clientes_usuario       ON clientes (usuario_id);
CREATE INDEX ix_clientes_razon_social  ON clientes (razon_social_rut);

CREATE TABLE servicios (
    id      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre  text NOT NULL UNIQUE,
    precio  numeric(12, 2) NOT NULL CHECK (precio >= 0)
);


-- 6. CONTRATOS Y SUS DEPENDIENTES

-- Un cliente CONTRATA muchos servicios; un servicio DEFINE muchos contratos
CREATE TABLE contratos_servicio (
    id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id         int NOT NULL REFERENCES clientes (id),
    servicio_id        int NOT NULL REFERENCES servicios (id),
    fecha_vencimiento  date,
    estado             text NOT NULL DEFAULT 'activo'
                       CHECK (estado IN ('pendiente', 'activo', 'vencido', 'cancelado'))
);

CREATE INDEX ix_contratos_cliente     ON contratos_servicio (cliente_id);
CREATE INDEX ix_contratos_servicio    ON contratos_servicio (servicio_id);
CREATE INDEX ix_contratos_vencimiento ON contratos_servicio (fecha_vencimiento)
    WHERE estado = 'activo';

-- Un contrato PRODUCE muchos documentos
CREATE TABLE documentos (
    id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contrato_id   int NOT NULL REFERENCES contratos_servicio (id) ON DELETE CASCADE,
    tipo          text NOT NULL,
    estado_firma  text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado_firma IN ('pendiente', 'firmado', 'rechazado'))
);

CREATE INDEX ix_documentos_contrato ON documentos (contrato_id);

-- Un contrato GENERA muchos pagos
CREATE TABLE pagos (
    id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contrato_id  int NOT NULL REFERENCES contratos_servicio (id),
    monto        numeric(12, 2) NOT NULL CHECK (monto > 0),
    estado       text NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente', 'pagado', 'rechazado', 'reembolsado'))
);

CREATE INDEX ix_pagos_contrato ON pagos (contrato_id);

-- Un contrato PROGRAMA muchas alertas
CREATE TABLE alertas (
    id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contrato_id   int NOT NULL REFERENCES contratos_servicio (id) ON DELETE CASCADE,
    fecha_alerta  date NOT NULL
);

CREATE INDEX ix_alertas_contrato ON alertas (contrato_id);
CREATE INDEX ix_alertas_fecha    ON alertas (fecha_alerta);

-- 7. AUTENTICACIÓN Y ESTADO
-- Credenciales de acceso y la posibilidad de desactivar sin eliminar

ALTER TABLE usuarios
    ADD COLUMN password_hash text NOT NULL,
    ADD COLUMN activo        boolean NOT NULL DEFAULT true;


-- 8. CORREO DE CONTACTO
-- Correo para notificaciones y contacto con el cliente

ALTER TABLE clientes
    ADD COLUMN email citext UNIQUE;


-- 9. FORMULARIOS DINÁMICOS
-- Define qué campos pide cada servicio en el formulario del e-commerce

ALTER TABLE servicios
    ADD COLUMN campos_formulario jsonb;


-- 10. CAMPOS QUE FALTABAN DEL SERVICIO CONTRATADO
-- Fecha de inicio, precio acordado, ejecutivo responsable y respuestas del formulario

ALTER TABLE contratos_servicio
    ADD COLUMN fecha_inicio     date NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN precio_final     numeric(12, 2),
    ADD COLUMN ejecutivo_id     int REFERENCES usuarios (id),
    ADD COLUMN observaciones    text,
    ADD COLUMN datos_formulario jsonb;

CREATE INDEX ix_contratos_ejecutivo ON contratos_servicio (ejecutivo_id);


-- 11. PLANTILLAS Y ARCHIVO GENERADO
-- Plantilla configurable usada para generar el documento, y el archivo final

CREATE TABLE plantillas_documento (
    id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo_documento      text NOT NULL UNIQUE,
    contenido_plantilla text NOT NULL,
    activo              boolean NOT NULL DEFAULT true
);

ALTER TABLE documentos
    ADD COLUMN plantilla_id int REFERENCES plantillas_documento (id),
    ADD COLUMN url_archivo  text,
    ADD COLUMN generado_en  timestamptz NOT NULL DEFAULT now();


-- 12. PAGOS: PASARELA Y FECHA DE PAGO
-- Registra con qué pasarela se pagó y en qué momento se confirmó

ALTER TABLE pagos
    ADD COLUMN pasarela   text CHECK (pasarela IN ('mercado_pago', 'transbank', 'transferencia')),
    ADD COLUMN fecha_pago timestamptz;


-- 13. ANTICIPACIÓN CONFIGURABLE
-- Días de anticipación de cada alerta y si ya fue notificada

ALTER TABLE alertas
    ADD COLUMN dias_anticipacion int NOT NULL DEFAULT 30,
    ADD COLUMN notificado        boolean NOT NULL DEFAULT false;


-- 14. AUDITORÍA AUTOMÁTICA
-- Escribe sola en registros_actividad ante cualquier INSERT/UPDATE/DELETE

CREATE OR REPLACE FUNCTION fn_registrar_actividad() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO registros_actividad (usuario_id, tabla_afectada, accion)
    VALUES (
        current_setting('app.usuario_actual', true)::int,
        TG_TABLE_NAME,
        TG_OP
    );
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auditoria_clientes
    AFTER INSERT OR UPDATE OR DELETE ON clientes
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();

CREATE TRIGGER trg_auditoria_razones_sociales
    AFTER INSERT OR UPDATE OR DELETE ON razones_sociales
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();

CREATE TRIGGER trg_auditoria_contratos
    AFTER INSERT OR UPDATE OR DELETE ON contratos_servicio
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();

CREATE TRIGGER trg_auditoria_documentos
    AFTER INSERT OR UPDATE OR DELETE ON documentos
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();

CREATE TRIGGER trg_auditoria_pagos
    AFTER INSERT OR UPDATE OR DELETE ON pagos
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();


-- 15. SEGURIDAD A NIVEL DE FILA
-- Cada ejecutivo ve solo los clientes y contratos que le corresponden

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_servicio ENABLE ROW LEVEL SECURITY;

CREATE POLICY ejecutivo_ve_sus_clientes ON clientes
    USING (
        usuario_id = current_setting('app.usuario_actual', true)::int
        OR current_setting('app.rol_actual', true) IN ('admin', 'dueno')
    );

CREATE POLICY ejecutivo_ve_sus_contratos ON contratos_servicio
    USING (
        ejecutivo_id = current_setting('app.usuario_actual', true)::int
        OR current_setting('app.rol_actual', true) IN ('admin', 'dueno')
    );


-- 16. ROLES DE BASE DE DATOS
-- El personal operativo nunca recibe permiso DELETE, ni saltándose la app

CREATE ROLE rol_ejecutivo NOLOGIN;
GRANT SELECT, INSERT, UPDATE ON
    clientes, razones_sociales, contratos_servicio, documentos, pagos, alertas
    TO rol_ejecutivo;
GRANT SELECT ON
    regiones, comunas, calles_numeros, direcciones, servicios,
    plantillas_documento, roles, permisos, roles_permisos, usuarios
    TO rol_ejecutivo;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rol_ejecutivo;

CREATE ROLE rol_admin NOLOGIN;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO rol_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rol_admin;

-- El registro de auditoría solo se escribe a través del trigger

REVOKE INSERT, UPDATE, DELETE ON registros_actividad FROM rol_ejecutivo, rol_admin;

COMMIT;