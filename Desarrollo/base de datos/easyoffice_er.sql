BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;    -- emails sin distinguir mayúsculas

-- 1. TERRITORIO Y DIRECCIONES

CREATE TABLE regiones (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_region   text NOT NULL UNIQUE
);

CREATE TABLE comunas (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_comuna   text NOT NULL UNIQUE
);

CREATE TABLE calles_numeros (
    id      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    calle   text NOT NULL,
    numero  text NOT NULL,              -- texto: admite "1234-B", "S/N", etc.
    UNIQUE (calle, numero)
);

-- Una región / comuna / calle-número puede aparecer en muchas direcciones
CREATE TABLE direcciones (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_calle_numero  int NOT NULL REFERENCES calles_numeros (id),
    id_region        int NOT NULL REFERENCES regiones (id),
    id_comuna        int NOT NULL REFERENCES comunas (id)
);

CREATE INDEX ix_direcciones_calle_numero ON direcciones (id_calle_numero);
CREATE INDEX ix_direcciones_region       ON direcciones (id_region);
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

-- Un usuario REGISTRA muchos clientes. El RUT del cliente enlaza con su
-- razón social (relación no identificante, línea punteada en el diagrama).
CREATE TABLE clientes (
    id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut         text NOT NULL UNIQUE REFERENCES razones_sociales (rut) ON UPDATE CASCADE,
    usuario_id  int NOT NULL REFERENCES usuarios (id)
);

CREATE INDEX ix_clientes_usuario ON clientes (usuario_id);

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

COMMIT;
