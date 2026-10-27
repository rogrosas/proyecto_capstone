-- =====================================================================
-- EASY OFFICE · Base de datos v2
-- PostgreSQL 15+ (probado en 18). Ejecutar completo sobre una base VACÍA.
--
-- Conserva toda la lógica de easyoffice_er.sql (folios, vencimientos,
-- alertas, precios por defecto, revisión humana, vistas del contrato,
-- auditoría inmutable, seguridad por fila y roles) y agrega:
--
--   CLIENTES      tipo_persona (natural / jurídica) con sus reglas,
--                 domicilio propio, origen (CRM / web / migración) y
--                 consentimiento de comunicaciones (Ley 21.719).
--   CONTRATOS     contrato_anterior_id: la renovación queda explícita.
--   PAGOS         datos de la pasarela (conciliación) y del DTE (boleta/factura).
--   DOCUMENTOS    versiones con hash y código de verificación único.
--   FIRMAS        movimientos_firmas + v_saldo_firmas (compras y consumos automáticos).
--   OPERACIÓN     correspondencia (oficina de partes), gestiones de cobranza,
--                 prospectos, carros abandonados y solicitudes de titulares.
--   SEGURIDAD     2FA y bloqueo por intentos en usuarios; IP, cliente y acciones
--                 denegadas en la auditoría; rol de recepción; portal de clientes
--                 protegido por la base de datos (rol_portal + app_cliente()).
--   DATOS BASE    roles, permisos, plazos de alerta, regiones de Chile y comunas
--                 de las regiones Metropolitana y de Valparaíso.
--
-- La aplicación fija en cada transacción:
--   app.usuario_actual  id del usuario del personal      (CRM)
--   app.rol_actual      rol de la tabla roles             (CRM)
--   app.cliente_actual  id del cliente                    (portal /mi-cuenta)
--   app.ip_actual       IP de la petición                 (auditoría)
-- =====================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;    -- correos sin distinguir mayúsculas


-- =====================================================================
-- 0. FUNCIONES AUXILIARES
-- =====================================================================

-- Formato 12345678-K (sin puntos) + dígito verificador módulo 11.
CREATE OR REPLACE FUNCTION fn_rut_valido(rut text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    cuerpo text; dv text; suma int := 0; mult int := 2; i int; resto int; esperado text;
BEGIN
    IF rut !~ '^[0-9]{7,8}-[0-9K]$' THEN RETURN false; END IF;
    cuerpo := split_part(rut, '-', 1);
    dv     := split_part(rut, '-', 2);
    FOR i IN REVERSE length(cuerpo)..1 LOOP
        suma := suma + substr(cuerpo, i, 1)::int * mult;
        mult := CASE WHEN mult = 7 THEN 2 ELSE mult + 1 END;
    END LOOP;
    resto    := 11 - (suma % 11);
    esperado := CASE resto WHEN 11 THEN '0' WHEN 10 THEN 'K' ELSE resto::text END;
    RETURN dv = esperado;
END;
$$;

-- 77496835-0 → 77.496.835-0 (como lo muestran el formulario y los contratos)
CREATE OR REPLACE FUNCTION fn_rut_formato(rut text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN rut IS NULL THEN NULL
           ELSE regexp_replace(split_part(rut, '-', 1), '(\d)(?=(\d{3})+$)', '\1.', 'g')
                || '-' || split_part(rut, '-', 2) END
$$;

-- Regla habitual en Chile: los RUT de personas jurídicas parten en 50.000.000.
-- Solo se usa para sugerir el tipo cuando no se indica.
CREATE OR REPLACE FUNCTION fn_tipo_persona_por_rut(rut text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN split_part(rut, '-', 1)::bigint >= 50000000 THEN 'juridica' ELSE 'natural' END
$$;

-- 2026-10-02 → '02 DE OCTUBRE DE 2026'
CREATE OR REPLACE FUNCTION fn_fecha_larga(d date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN d IS NULL THEN NULL ELSE
        lpad(extract(day FROM d)::int::text, 2, '0') || ' DE ' ||
        (ARRAY['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO',
               'SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'])[extract(month FROM d)::int] ||
        ' DE ' || extract(year FROM d)::int END
$$;

-- Identidad de la sesión (la fija la aplicación al abrir cada transacción).
CREATE OR REPLACE FUNCTION app_usuario() RETURNS int
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.usuario_actual', true), '')::int $$;

CREATE OR REPLACE FUNCTION app_es_admin() RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.rol_actual', true) IN ('admin', 'dueno'), false) $$;

-- Oficina de partes: ve a todos los clientes para registrar su correspondencia.
CREATE OR REPLACE FUNCTION app_es_recepcion() RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.rol_actual', true) = 'recepcion', false) $$;

-- Cliente conectado al portal /mi-cuenta.
CREATE OR REPLACE FUNCTION app_cliente() RETURNS int
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.cliente_actual', true), '')::int $$;

-- IP de la petición; NULL si no se fijó o no es válida.
CREATE OR REPLACE FUNCTION app_ip() RETURNS inet
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN NULLIF(current_setting('app.ip_actual', true), '')::inet;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;


-- =====================================================================
-- 1. TERRITORIO Y DIRECCIONES
-- =====================================================================

CREATE TABLE regiones (
    id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_region  text NOT NULL UNIQUE
);

CREATE TABLE comunas (
    id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_comuna  text NOT NULL,
    region_id      int  NOT NULL REFERENCES regiones (id),
    UNIQUE (nombre_comuna, region_id)
);
CREATE INDEX ix_comunas_region ON comunas (region_id);

-- "VICUÑA MACKENNA PONIENTE #7255 OFICINA 707"
--   → calle 'Vicuña Mackenna Poniente', numero '7255', complemento 'Oficina 707'
CREATE TABLE direcciones (
    id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    calle        text NOT NULL,
    numero       text NOT NULL,              -- texto: admite "1234-B", "S/N"
    complemento  text,
    comuna_id    int  NOT NULL REFERENCES comunas (id)
);
CREATE UNIQUE INDEX ux_direcciones_completa
    ON direcciones (lower(calle), numero, COALESCE(lower(complemento), ''), comuna_id);
CREATE INDEX ix_direcciones_comuna ON direcciones (comuna_id);

-- Helpers para combinación de correspondencia
CREATE OR REPLACE FUNCTION fn_dir_calle(p_id int) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT d.calle || ' ' || d.numero || COALESCE(', ' || d.complemento, '')
    FROM direcciones d WHERE d.id = p_id $$;
CREATE OR REPLACE FUNCTION fn_dir_comuna(p_id int) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT c.nombre_comuna FROM direcciones d JOIN comunas c ON c.id = d.comuna_id WHERE d.id = p_id $$;
CREATE OR REPLACE FUNCTION fn_dir_region(p_id int) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT r.nombre_region FROM direcciones d JOIN comunas c ON c.id = d.comuna_id
    JOIN regiones r ON r.id = c.region_id WHERE d.id = p_id $$;


-- =====================================================================
-- 2. ROLES, PERMISOS Y USUARIOS DEL PERSONAL
-- =====================================================================

CREATE TABLE roles (
    id   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rol  text NOT NULL UNIQUE
);
CREATE TABLE permisos (
    id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permiso  text NOT NULL UNIQUE
);
-- Relación N:M — un permiso está incluido en varios roles y a un rol se le asignan varios permisos
CREATE TABLE roles_permisos (
    rol_id       int NOT NULL REFERENCES roles (id)    ON DELETE CASCADE,
    permisos_id  int NOT NULL REFERENCES permisos (id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permisos_id)
);
CREATE INDEX ix_roles_permisos_permiso ON roles_permisos (permisos_id);

CREATE TABLE usuarios (
    id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre             text    NOT NULL,
    email              citext  NOT NULL UNIQUE,
    rol_id             int     NOT NULL REFERENCES roles (id),
    password_hash      text    NOT NULL,                 -- bcrypt
    activo             boolean NOT NULL DEFAULT true,
    -- Segundo factor (TOTP): el secreto se guarda cifrado por la aplicación
    totp_secreto       text,
    totp_activo        boolean NOT NULL DEFAULT false,
    -- Bloqueo por intentos fallidos
    intentos_fallidos  int     NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
    bloqueado_hasta    timestamptz,
    ultimo_acceso      timestamptz,
    creado_en          timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT totp_activo OR totp_secreto IS NOT NULL)
);
CREATE INDEX ix_usuarios_rol ON usuarios (rol_id);


-- =====================================================================
-- 3. PERSONAS Y ENTIDADES
-- =====================================================================

-- Representantes legales (de clientes jurídicos, de Easy Office y de propietarios).
-- Nacionalidad / estado civil / profesión los exige la comparecencia del contrato.
CREATE TABLE representantes_legales (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut              text NOT NULL UNIQUE CHECK (fn_rut_valido(rut)),
    nombre_completo  text NOT NULL,
    nacionalidad     text,
    estado_civil     text,
    profesion        text,
    email            citext CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),  -- para enviar la firma electrónica
    direccion_id     int  REFERENCES direcciones (id),
    registrado_por   int  DEFAULT app_usuario() REFERENCES usuarios (id)   -- base de la visibilidad por ejecutivo
);
CREATE INDEX ix_representantes_direccion      ON representantes_legales (direccion_id);
CREATE INDEX ix_representantes_registrado_por ON representantes_legales (registrado_por);

-- Empresa / marca que emite el contrato: EASY OFFICE e INOFFICE.
-- Una marca puede cobrar a nombre de la misma razón social, por eso el RUT no es único.
CREATE TABLE empresas_emisoras (
    id                      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_comercial        text NOT NULL UNIQUE,
    razon_social            text NOT NULL,
    rut                     text NOT NULL CHECK (fn_rut_valido(rut)),
    representante_legal_id  int REFERENCES representantes_legales (id),
    personeria_fecha        date,      -- "con fecha 10 de agosto de 2017"
    personeria_fuente       text,      -- "Registro de Empresas y Sociedades, Ley 20.659"
    telefono                text,
    email                   citext,
    activo                  boolean NOT NULL DEFAULT true
);

-- Dueño del inmueble que autoriza el uso del domicilio (hoja "AUTORIZACIÓN" del contrato)
CREATE TABLE propietarios_inmueble (
    id                      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut                     text NOT NULL UNIQUE CHECK (fn_rut_valido(rut)),
    razon_social            text NOT NULL,
    representante_legal_id  int REFERENCES representantes_legales (id),
    direccion_id            int REFERENCES direcciones (id)
);

-- Sucursales (inmuebles). El prefijo identifica la sucursal en el folio: LF, VL, SA.
CREATE TABLE sucursales (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id      int  NOT NULL REFERENCES empresas_emisoras (id),
    nombre          text NOT NULL,
    direccion_id    int  NOT NULL REFERENCES direcciones (id),
    rol_propiedad   text NOT NULL CHECK (rol_propiedad ~ '^[0-9]+-[0-9]+$'),
    prefijo_folio   text NOT NULL CHECK (prefijo_folio ~ '^[A-Z]{2}$'),
    propietario_id  int REFERENCES propietarios_inmueble (id),
    unidad_sii      text,              -- unidad del SII ante la que se presenta la autorización
    activo          boolean NOT NULL DEFAULT true,
    UNIQUE (id, empresa_id),
    UNIQUE (empresa_id, nombre),
    UNIQUE (prefijo_folio)
);

-- Una cuenta de recaudación por empresa emisora
CREATE TABLE cuentas_recaudacion (
    id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id     int  NOT NULL REFERENCES empresas_emisoras (id),
    banco          text NOT NULL,
    tipo_cuenta    text NOT NULL,
    numero_cuenta  text NOT NULL,
    titular        text NOT NULL,
    rut_titular    text NOT NULL CHECK (fn_rut_valido(rut_titular)),
    activa         boolean NOT NULL DEFAULT true,
    UNIQUE (id, empresa_id),
    UNIQUE (banco, numero_cuenta)
);


-- =====================================================================
-- 4. AUDITORÍA (inmutable)
--    Actor: usuario_id (personal), cliente_id (portal) o ninguno (sistema).
-- =====================================================================

CREATE TABLE registros_actividad (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id          int REFERENCES usuarios (id),
    cliente_id          int,                       -- sin FK: el registro sobrevive aunque se elimine el cliente
    tabla_afectada      text NOT NULL,
    registro_id         text,
    accion              text NOT NULL
                        CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
                                          'LOGIN_FALLIDO', 'DENEGADO')),
    detalle             text,                      -- ej.: correo intentado, acción denegada
    valores_anteriores  jsonb,
    valores_nuevos      jsonb,
    ip                  inet,
    user_agent          text,
    fecha               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_registros_actividad_usuario ON registros_actividad (usuario_id, fecha DESC);
CREATE INDEX ix_registros_actividad_cliente ON registros_actividad (cliente_id, fecha DESC) WHERE cliente_id IS NOT NULL;
CREATE INDEX ix_registros_actividad_tabla   ON registros_actividad (tabla_afectada, registro_id, fecha DESC);
CREATE INDEX ix_registros_actividad_accion  ON registros_actividad (accion, fecha DESC);


-- =====================================================================
-- 5. CLIENTES
--    Una razón social o una persona natural = un cliente (un RUT).
--    Puede tener varios contratos (renovaciones).
-- =====================================================================

CREATE TABLE clientes (
    id                      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut                     text NOT NULL UNIQUE CHECK (fn_rut_valido(rut)),
    tipo_persona            text NOT NULL CHECK (tipo_persona IN ('natural', 'juridica')),
    razon_social            text NOT NULL,     -- nombre completo si es persona natural
    nombre_fantasia         text,
    giro_principal          text,
    email                   citext CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    celular                 text   CHECK (celular ~ '^9[0-9]{8}$'),
    direccion_id            int REFERENCES direcciones (id),          -- domicilio del cliente
    representante_legal_id  int REFERENCES representantes_legales (id),
    fecha_escritura         date,      -- escritura / estatuto actualizado (solo personas jurídicas)
    sitio_notaria           text,      -- sitio web o notaría
    origen                  text NOT NULL DEFAULT 'crm' CHECK (origen IN ('crm', 'web', 'migracion')),
    acepta_comunicaciones   boolean NOT NULL DEFAULT false,           -- Ley 21.719: consentimiento
    consentimiento_en       timestamptz,
    registrado_por          int DEFAULT app_usuario() REFERENCES usuarios (id),
    creado_en               timestamptz NOT NULL DEFAULT now(),
    -- Una empresa comparece por su representante legal
    CONSTRAINT ck_clientes_juridica_con_representante
        CHECK (tipo_persona = 'natural' OR representante_legal_id IS NOT NULL),
    -- La escritura es de sociedades
    CONSTRAINT ck_clientes_natural_sin_escritura
        CHECK (tipo_persona = 'juridica' OR fecha_escritura IS NULL),
    -- Desde el CRM siempre se sabe quién lo registró; desde la web no hay usuario del personal
    CONSTRAINT ck_clientes_registrado_por
        CHECK (registrado_por IS NOT NULL OR origen <> 'crm'),
    CONSTRAINT ck_clientes_consentimiento
        CHECK (NOT acepta_comunicaciones OR consentimiento_en IS NOT NULL)
);
CREATE INDEX ix_clientes_representante  ON clientes (representante_legal_id);
CREATE INDEX ix_clientes_direccion      ON clientes (direccion_id);
CREATE INDEX ix_clientes_registrado_por ON clientes (registrado_por);
CREATE INDEX ix_clientes_email          ON clientes (email);
CREATE INDEX ix_clientes_razon_social   ON clientes (lower(razon_social));
CREATE INDEX ix_clientes_tipo           ON clientes (tipo_persona);


-- =====================================================================
-- 6. CATÁLOGO DE SERVICIOS
--    Precios NETOS ("TODOS LOS VALORES MÁS I.V.A."), salvo incluye_iva.
-- =====================================================================

CREATE TABLE servicios (
    id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo              text UNIQUE CHECK (codigo ~ '^[a-z0-9-]+$'),   -- código del plan en el sitio web (ej. dom-anual)
    nombre              text NOT NULL UNIQUE,
    tipo                text NOT NULL DEFAULT 'PRINCIPAL'
                        CHECK (tipo IN ('PRINCIPAL', 'COMPLEMENTARIO')),
    descripcion_base    text,
    precio_lista        numeric(12, 0) CHECK (precio_lista >= 0),   -- CLP; NULL = por cotizar
    precio_desde        boolean NOT NULL DEFAULT false,             -- "desde $9.900"
    unidad              text,                                       -- 'por firma', 'por página'...
    incluye_iva         boolean NOT NULL DEFAULT false,
    ciclo_pago_defecto  text NOT NULL DEFAULT 'UNICO'
                        CHECK (ciclo_pago_defecto IN ('UNICO','MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL')),
    firmas_incluidas    int  NOT NULL DEFAULT 0 CHECK (firmas_incluidas >= 0),  -- bolsas y planes de firmas
    campos_formulario   jsonb,
    activo              boolean NOT NULL DEFAULT true
);


-- =====================================================================
-- 7. CONTRATOS DE SERVICIO (= un FOLIO)
-- =====================================================================

-- La macro GenerarFolio toma el MAYOR correlativo del año entre TODOS los folios
-- (sin distinguir sucursal) y suma 1. Se replica: un contador por año.
CREATE TABLE folios_correlativos (
    anio    int PRIMARY KEY,
    ultimo  int NOT NULL DEFAULT 0 CHECK (ultimo >= 0)
);

CREATE TABLE contratos (
    id                     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folio                  text NOT NULL UNIQUE
                           CHECK (folio ~ '^[A-Z]{2}-[0-9]{2,4}-[0-9]{4}$'),   -- LF-0152-2026
    empresa_id             int NOT NULL REFERENCES empresas_emisoras (id),
    cliente_id             int NOT NULL REFERENCES clientes (id),
    sucursal_id            int NOT NULL,
    cuenta_recaudacion_id  int,
    link_pago              text,
    lugar_celebracion      text NOT NULL DEFAULT 'Santiago',
    fecha_celebracion      date NOT NULL DEFAULT CURRENT_DATE,
    fecha_inicio           date NOT NULL,
    duracion_meses         int  NOT NULL CHECK (duracion_meses > 0),   -- 12, 6, 4, 3, 1
    fecha_vencimiento      date NOT NULL,
    renovacion_automatica  boolean NOT NULL DEFAULT true,              -- cláusula QUINTO
    estado                 text NOT NULL DEFAULT 'activo'
                           CHECK (estado IN ('pendiente','activo','vencido','cancelado')),
    contrato_anterior_id   int UNIQUE,                                 -- contrato que este renueva
    origen                 text NOT NULL DEFAULT 'crm' CHECK (origen IN ('crm', 'web', 'migracion')),
    ejecutivo_id           int REFERENCES usuarios (id),
    observaciones          text,
    datos_formulario       jsonb,                                      -- respuestas del formulario de contratación
    creado_en              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, cliente_id),
    CHECK (fecha_vencimiento >= fecha_inicio),
    CHECK (cuenta_recaudacion_id IS NOT NULL OR link_pago IS NOT NULL),
    CHECK (contrato_anterior_id IS NULL OR contrato_anterior_id <> id),
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursales (id, empresa_id),
    FOREIGN KEY (cuenta_recaudacion_id, empresa_id) REFERENCES cuentas_recaudacion (id, empresa_id),
    -- una renovación es del mismo cliente
    FOREIGN KEY (contrato_anterior_id, cliente_id) REFERENCES contratos (id, cliente_id)
);
CREATE INDEX ix_contratos_cliente     ON contratos (cliente_id);
CREATE INDEX ix_contratos_ejecutivo   ON contratos (ejecutivo_id);
CREATE INDEX ix_contratos_sucursal    ON contratos (sucursal_id);
CREATE INDEX ix_contratos_vencimiento ON contratos (fecha_vencimiento) WHERE estado = 'activo';

-- Anexo 1: servicios del contrato con su precio, ciclo y contenido.
CREATE TABLE contrato_servicios (
    id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contrato_id  int NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
    orden        smallint NOT NULL CHECK (orden > 0),
    servicio_id  int NOT NULL REFERENCES servicios (id),
    precio       numeric(12, 0) NOT NULL CHECK (precio >= 0),     -- se copia del catálogo si no se indica
    ciclo_pago   text NOT NULL CHECK (ciclo_pago IN ('UNICO','MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL')),
    descripcion  text,
    UNIQUE (contrato_id, orden),
    UNIQUE (contrato_id, servicio_id)
);
CREATE INDEX ix_contrato_servicios_servicio ON contrato_servicios (servicio_id);


-- =====================================================================
-- 8. DOCUMENTOS POR PLANTILLA
-- =====================================================================

CREATE TABLE plantillas_documento (
    id                   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo_documento       text NOT NULL,
    version              int  NOT NULL DEFAULT 1,
    familia              text NOT NULL
                         CHECK (familia IN ('CONTRATO_SERVICIO','PODER','ACUERDO_ACCIONISTAS','ARRIENDO','OTRO')),
    archivo_base         text,                 -- .docx de origen
    contenido_plantilla  text,                 -- con {variables}
    campos               jsonb,                -- [{clave, etiqueta, tipo}]
    requiere_revision    boolean NOT NULL DEFAULT false,   -- verificación humana antes de firmar
    activo               boolean NOT NULL DEFAULT true,
    UNIQUE (tipo_documento, version)
);

-- Cláusulas reutilizables (el acuerdo de accionistas se arma eligiendo artículos)
CREATE TABLE clausulas_documento (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia          text NOT NULL,
    codigo           text NOT NULL,
    titulo           text NOT NULL,
    texto_plantilla  text NOT NULL,
    campos           jsonb,
    activo           boolean NOT NULL DEFAULT true,
    UNIQUE (familia, codigo)
);

-- Un documento pertenece a un cliente y, si nace de un contrato de servicio, a su folio.
CREATE TABLE documentos (
    id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id          int  NOT NULL REFERENCES clientes (id),
    contrato_id         int,
    servicio_id         int  REFERENCES servicios (id),
    plantilla_id        int  REFERENCES plantillas_documento (id),
    tipo                text NOT NULL,
    lugar               text,
    fecha_documento     date,
    datos               jsonb,                             -- valores de las variables
    estado              text NOT NULL DEFAULT 'borrador'
                        CHECK (estado IN ('borrador','en_revision','aprobado','enviado_firma',
                                          'firmado','rechazado','anulado')),
    requiere_revision   boolean NOT NULL,                  -- se copia de la plantilla
    revisado_por        int  REFERENCES usuarios (id),
    revisado_en         timestamptz,
    version_aprobada    int,                               -- versión que revisó la persona
    ejecutivo_id        int  REFERENCES usuarios (id),
    url_archivo         text,                              -- versión vigente
    firma_id_externo    text,                              -- id en la plataforma de firma
    firmado_en          timestamptz,
    codigo_verificacion text,
    generado_en         timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (contrato_id, cliente_id) REFERENCES contratos (id, cliente_id) ON DELETE CASCADE,
    -- regla de negocio: sin aprobación humana no se envía a firma
    CHECK (NOT requiere_revision
           OR estado NOT IN ('aprobado','enviado_firma','firmado')
           OR revisado_por IS NOT NULL),
    CHECK (estado <> 'firmado' OR firmado_en IS NOT NULL),
    CHECK (codigo_verificacion IS NULL OR codigo_verificacion ~ '^EO-[0-9A-F]{4}-[0-9A-F]{4}$')
);
CREATE INDEX ix_documentos_cliente  ON documentos (cliente_id);
CREATE INDEX ix_documentos_contrato ON documentos (contrato_id);
CREATE INDEX ix_documentos_estado   ON documentos (estado) WHERE estado IN ('en_revision','enviado_firma');
CREATE UNIQUE INDEX ux_documentos_codigo ON documentos (codigo_verificacion) WHERE codigo_verificacion IS NOT NULL;

-- Cada versión generada del documento; la aprobación apunta a una versión concreta.
CREATE TABLE documento_versiones (
    id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    documento_id  int  NOT NULL REFERENCES documentos (id) ON DELETE CASCADE,
    version       int  NOT NULL CHECK (version > 0),
    url_archivo   text NOT NULL,
    hash_sha256   text CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
    generado_por  int  DEFAULT app_usuario() REFERENCES usuarios (id),
    generado_en   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (documento_id, version)
);

-- Partes que comparecen: arrendador/arrendatario, accionistas, poderdante/apoderado...
CREATE TABLE documento_partes (
    id                   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    documento_id         int  NOT NULL REFERENCES documentos (id) ON DELETE CASCADE,
    orden                smallint NOT NULL DEFAULT 1,
    rol                  text NOT NULL,
    tipo_persona         text NOT NULL CHECK (tipo_persona IN ('natural','juridica')),
    nombre               text NOT NULL,
    rut                  text CHECK (rut IS NULL OR fn_rut_valido(rut)),
    nacionalidad         text,
    estado_civil         text,
    profesion            text,
    direccion_id         int  REFERENCES direcciones (id),
    email                citext,
    telefono             text,
    representante_nombre text,                           -- si es persona jurídica
    representante_rut    text CHECK (representante_rut IS NULL OR fn_rut_valido(representante_rut)),
    cantidad_acciones    bigint CHECK (cantidad_acciones >= 0),
    UNIQUE (documento_id, orden)
);

-- Artículos elegidos para un documento, en orden.
CREATE TABLE documento_clausulas (
    id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    documento_id  int NOT NULL REFERENCES documentos (id) ON DELETE CASCADE,
    orden         smallint NOT NULL,
    clausula_id   int NOT NULL REFERENCES clausulas_documento (id),
    valores       jsonb,
    UNIQUE (documento_id, orden)
);


-- =====================================================================
-- 9. PAGOS Y ALERTAS
-- =====================================================================

-- Un pago es de un contrato o de un documento suelto (servicios instantáneos del e-commerce).
CREATE TABLE pagos (
    id                   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contrato_id          int REFERENCES contratos (id),
    documento_id         int REFERENCES documentos (id),
    monto                numeric(12, 0) NOT NULL CHECK (monto > 0),
    estado               text NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente','pagado','rechazado','reembolsado')),
    pasarela             text CHECK (pasarela IN ('mercado_pago','transbank','transferencia')),
    fecha_pago           timestamptz,
    cuota                smallint NOT NULL DEFAULT 1,      -- 50/50 = cuota 1 de 2 y 2 de 2
    total_cuotas         smallint NOT NULL DEFAULT 1,
    -- Conciliación con la pasarela
    id_transaccion       text,
    codigo_autorizacion  text,
    ultimos_4            text CHECK (ultimos_4 ~ '^[0-9]{4}$'),
    respuesta_pasarela   jsonb,
    conciliado_en        timestamptz,
    -- Documento tributario electrónico
    tipo_dte             text CHECK (tipo_dte IN ('boleta','factura','exento')),
    folio_dte            bigint CHECK (folio_dte > 0),
    url_dte              text,
    CHECK (contrato_id IS NOT NULL OR documento_id IS NOT NULL),
    CHECK (cuota BETWEEN 1 AND total_cuotas),
    CHECK (estado <> 'pagado' OR fecha_pago IS NOT NULL),
    CHECK (folio_dte IS NULL OR tipo_dte IS NOT NULL),
    UNIQUE (pasarela, id_transaccion)
);
-- una sola cuota vigente por número (los pagos rechazados o reembolsados no cuentan)
CREATE UNIQUE INDEX ux_pagos_cuota_contrato  ON pagos (contrato_id, cuota)
    WHERE contrato_id  IS NOT NULL AND estado IN ('pendiente','pagado');
CREATE UNIQUE INDEX ux_pagos_cuota_documento ON pagos (documento_id, cuota)
    WHERE documento_id IS NOT NULL AND estado IN ('pendiente','pagado');
CREATE INDEX ix_pagos_contrato  ON pagos (contrato_id);
CREATE INDEX ix_pagos_documento ON pagos (documento_id);

CREATE TABLE config_alertas (
    dias_anticipacion  int PRIMARY KEY CHECK (dias_anticipacion > 0),
    activo             boolean NOT NULL DEFAULT true
);

CREATE TABLE alertas (
    id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contrato_id        int  NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
    fecha_alerta       date NOT NULL,
    dias_anticipacion  int  NOT NULL,
    notificado         boolean NOT NULL DEFAULT false,
    canal              text CHECK (canal IN ('correo','whatsapp','llamada','manual')),
    enviado_en         timestamptz,
    UNIQUE (contrato_id, dias_anticipacion),
    CHECK (NOT notificado OR enviado_en IS NOT NULL)
);
CREATE INDEX ix_alertas_fecha ON alertas (fecha_alerta) WHERE NOT notificado;


-- =====================================================================
-- 10. OPERACIÓN DIARIA
-- =====================================================================

-- 10.1 Saldo de firmas: compras (bolsas y planes) y consumos (documentos firmados).
CREATE TABLE movimientos_firmas (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id      int  NOT NULL REFERENCES clientes (id),
    motivo          text NOT NULL CHECK (motivo IN ('compra','consumo','ajuste')),
    cantidad        int  NOT NULL CHECK (cantidad <> 0),      -- positivo suma, negativo descuenta
    vence_en        date,                                     -- vigencia de una compra
    contrato_id     int,                                      -- contrato con que se compró
    documento_id    int  REFERENCES documentos (id),          -- documento que consumió la firma
    detalle         text,
    registrado_por  int  DEFAULT app_usuario() REFERENCES usuarios (id),
    creado_en       timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (contrato_id, cliente_id) REFERENCES contratos (id, cliente_id),
    CHECK (motivo <> 'compra'  OR (cantidad > 0 AND vence_en IS NOT NULL)),
    CHECK (motivo <> 'consumo' OR (cantidad < 0 AND documento_id IS NOT NULL))
);
CREATE INDEX ix_movimientos_firmas_cliente ON movimientos_firmas (cliente_id, creado_en);
-- un documento consume una sola vez
CREATE UNIQUE INDEX ux_movimientos_firmas_consumo ON movimientos_firmas (documento_id) WHERE motivo = 'consumo';

-- 10.2 Correspondencia recibida en el domicilio tributario (oficina de partes).
CREATE TABLE correspondencia (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id       int  NOT NULL REFERENCES clientes (id),
    sucursal_id      int  NOT NULL REFERENCES sucursales (id),
    remitente        text NOT NULL,                  -- "Servicio de Impuestos Internos"
    tipo             text NOT NULL CHECK (tipo IN ('fiscal','judicial','laboral','municipal','bancaria','comercial','otra')),
    descripcion      text,
    urgente          boolean NOT NULL DEFAULT false, -- fiscal, judicial y laboral: urgentes por defecto
    estado           text NOT NULL DEFAULT 'recibida'
                     CHECK (estado IN ('recibida','digitalizada','notificada','retirada','devuelta')),
    recibida_en      timestamptz NOT NULL DEFAULT now(),
    plazo_en         timestamptz NOT NULL,           -- compromiso de aviso (por defecto 24 h)
    digitalizada_en  timestamptz,
    notificada_en    timestamptz,
    leida_en         timestamptz,                    -- la marca el cliente desde el portal
    retirada_en      timestamptz,
    url_archivo      text,                           -- escaneo
    registrado_por   int  DEFAULT app_usuario() REFERENCES usuarios (id),
    CHECK (plazo_en >= recibida_en),
    CHECK (estado IN ('recibida','devuelta') OR digitalizada_en IS NOT NULL OR estado = 'retirada'),
    CHECK (estado <> 'notificada' OR notificada_en IS NOT NULL)
);
CREATE INDEX ix_correspondencia_cliente   ON correspondencia (cliente_id, recibida_en DESC);
CREATE INDEX ix_correspondencia_pendiente ON correspondencia (plazo_en) WHERE estado = 'recibida';

-- 10.3 Bitácora de gestiones con el cliente (cobranza, renovación, seguimiento).
CREATE TABLE gestiones (
    id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id         int  NOT NULL REFERENCES clientes (id),
    contrato_id        int,
    usuario_id         int  NOT NULL DEFAULT app_usuario() REFERENCES usuarios (id),
    tipo               text NOT NULL CHECK (tipo IN ('llamada','correo','whatsapp','reunion','link_pago','nota')),
    resultado          text CHECK (resultado IN ('sin_respuesta','contactado','promete_pago','renueva','no_renueva','otro')),
    nota               text,
    proxima_accion_en  date,
    creado_en          timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (contrato_id, cliente_id) REFERENCES contratos (id, cliente_id) ON DELETE CASCADE
);
CREATE INDEX ix_gestiones_cliente  ON gestiones (cliente_id, creado_en DESC);
CREATE INDEX ix_gestiones_proxima  ON gestiones (usuario_id, proxima_accion_en) WHERE proxima_accion_en IS NOT NULL;

-- 10.4 Prospectos: formulario de contacto, llamadas y reuniones agendadas.
CREATE TABLE prospectos (
    id                     int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre                 text NOT NULL,
    email                  citext CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    celular                text   CHECK (celular ~ '^9[0-9]{8}$'),
    servicio_interes       text,
    mensaje                text,
    origen                 text NOT NULL DEFAULT 'web' CHECK (origen IN ('web','telefono','correo','referido','agenda','otro')),
    estado                 text NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo','contactado','convertido','descartado')),
    asignado_a             int REFERENCES usuarios (id),
    cliente_id             int REFERENCES clientes (id),   -- al convertirse en cliente
    acepta_comunicaciones  boolean NOT NULL DEFAULT false,
    creado_en              timestamptz NOT NULL DEFAULT now(),
    CHECK (email IS NOT NULL OR celular IS NOT NULL),
    CHECK (estado <> 'convertido' OR cliente_id IS NOT NULL)
);
CREATE INDEX ix_prospectos_estado   ON prospectos (estado, creado_en DESC);
CREATE INDEX ix_prospectos_asignado ON prospectos (asignado_a);

-- 10.5 Carros del sitio web (para recordar compras no terminadas).
CREATE TABLE carros (
    id                      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email                   citext NOT NULL,
    servicio_id             int  REFERENCES servicios (id),
    codigo_plan             text,                          -- id del plan en el sitio (ej. dom-anual)
    datos                   jsonb,                         -- datos ingresados en el formulario
    creado_en               timestamptz NOT NULL DEFAULT now(),
    recordado_en            timestamptz,
    convertido_contrato_id  int  REFERENCES contratos (id),
    convertido_en           timestamptz,
    CHECK (convertido_contrato_id IS NULL OR convertido_en IS NOT NULL)
);
CREATE INDEX ix_carros_pendientes ON carros (creado_en) WHERE convertido_contrato_id IS NULL;

-- 10.6 Solicitudes de titulares de datos personales (Ley 21.719): acceso, rectificación, supresión...
CREATE TABLE solicitudes_titular (
    id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id     int  REFERENCES clientes (id),
    email          citext NOT NULL,
    tipo           text NOT NULL CHECK (tipo IN ('acceso','rectificacion','supresion','oposicion','portabilidad','bloqueo')),
    detalle        text,
    estado         text NOT NULL DEFAULT 'recibida' CHECK (estado IN ('recibida','en_proceso','respondida','rechazada')),
    recibida_en    timestamptz NOT NULL DEFAULT now(),
    plazo_en       date NOT NULL DEFAULT (CURRENT_DATE + 30),   -- plazo de respuesta (ajustable a la ley vigente)
    respondida_en  timestamptz,
    respuesta      text,
    atendida_por   int  REFERENCES usuarios (id),
    CHECK (estado NOT IN ('respondida','rechazada') OR (respondida_en IS NOT NULL AND respuesta IS NOT NULL))
);
CREATE INDEX ix_solicitudes_titular_estado ON solicitudes_titular (estado, plazo_en);


-- =====================================================================
-- 11. AUTOMATIZACIONES
-- =====================================================================

-- 11.1 Cliente: tipo de persona sugerido por el RUT si no se indica,
--      y fecha del consentimiento al aceptar comunicaciones.
CREATE OR REPLACE FUNCTION fn_defaults_cliente() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.tipo_persona := COALESCE(NEW.tipo_persona, fn_tipo_persona_por_rut(NEW.rut));
    IF NEW.acepta_comunicaciones AND NEW.consentimiento_en IS NULL THEN
        NEW.consentimiento_en := now();
    ELSIF NOT NEW.acepta_comunicaciones THEN
        NEW.consentimiento_en := NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_defaults_cliente
    BEFORE INSERT OR UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION fn_defaults_cliente();

-- 11.2 Servicio contratado: precio, ciclo y contenido salen del catálogo si no se indican.
CREATE OR REPLACE FUNCTION fn_defaults_contrato_servicio() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s servicios%ROWTYPE;
BEGIN
    SELECT * INTO s FROM servicios WHERE id = NEW.servicio_id;
    NEW.precio      := COALESCE(NEW.precio, s.precio_lista);
    NEW.ciclo_pago  := COALESCE(NEW.ciclo_pago, s.ciclo_pago_defecto);
    NEW.descripcion := COALESCE(NEW.descripcion, s.descripcion_base);
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_defaults_contrato_servicio
    BEFORE INSERT ON contrato_servicios
    FOR EACH ROW EXECUTE FUNCTION fn_defaults_contrato_servicio();

-- 11.3 Vencimiento por defecto = inicio + duración - 1 día
--      (ej.: 02-oct-2026 + 12 meses → 01-oct-2027).
CREATE OR REPLACE FUNCTION fn_defaults_contrato() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.fecha_vencimiento := COALESCE(
        NEW.fecha_vencimiento,
        (NEW.fecha_inicio + make_interval(months => NEW.duracion_meses))::date - 1);
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_defaults_contrato
    BEFORE INSERT ON contratos
    FOR EACH ROW EXECUTE FUNCTION fn_defaults_contrato();

-- 11.4 Folio PREFIJO-correlativo(4 dígitos)-año, igual que la macro de Excel.
--      Si se ingresa uno manual (migración) se valida el prefijo y el contador avanza.
CREATE OR REPLACE FUNCTION fn_asignar_folio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_prefijo text;
    v_anio    int;
    v_n       int;
BEGIN
    SELECT prefijo_folio INTO v_prefijo FROM sucursales WHERE id = NEW.sucursal_id;

    IF NEW.folio IS NULL THEN
        v_anio := EXTRACT(YEAR FROM NEW.fecha_celebracion)::int;
        INSERT INTO folios_correlativos AS f (anio, ultimo) VALUES (v_anio, 1)
        ON CONFLICT (anio) DO UPDATE SET ultimo = f.ultimo + 1
        RETURNING f.ultimo INTO v_n;
        NEW.folio := v_prefijo || '-' || lpad(v_n::text, 4, '0') || '-' || v_anio;
    ELSIF NEW.folio ~ '^[A-Z]{2}-[0-9]{2,4}-[0-9]{4}$' THEN
        IF split_part(NEW.folio, '-', 1) <> v_prefijo THEN
            RAISE EXCEPTION 'El folio % no corresponde al prefijo % de la sucursal', NEW.folio, v_prefijo;
        END IF;
        INSERT INTO folios_correlativos AS f (anio, ultimo)
        VALUES (split_part(NEW.folio, '-', 3)::int, split_part(NEW.folio, '-', 2)::int)
        ON CONFLICT (anio) DO UPDATE SET ultimo = GREATEST(f.ultimo, EXCLUDED.ultimo);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_asignar_folio
    BEFORE INSERT ON contratos
    FOR EACH ROW EXECUTE FUNCTION fn_asignar_folio();

-- 11.5 Alertas de vencimiento (60/30/15/7 días, configurables).
--      Solo se crean alertas con fecha futura.
CREATE OR REPLACE FUNCTION fn_generar_alertas() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM alertas WHERE contrato_id = NEW.id AND NOT notificado;
    INSERT INTO alertas (contrato_id, fecha_alerta, dias_anticipacion)
    SELECT NEW.id, NEW.fecha_vencimiento - c.dias_anticipacion, c.dias_anticipacion
    FROM config_alertas c
    WHERE c.activo AND NEW.fecha_vencimiento - c.dias_anticipacion >= CURRENT_DATE
    ON CONFLICT (contrato_id, dias_anticipacion) DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_generar_alertas
    AFTER INSERT OR UPDATE OF fecha_vencimiento ON contratos
    FOR EACH ROW EXECUTE FUNCTION fn_generar_alertas();

-- 11.6 Al marcar una alerta como notificada se registra cuándo.
CREATE OR REPLACE FUNCTION fn_alerta_enviada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.notificado AND NEW.enviado_en IS NULL THEN
        NEW.enviado_en := now();
        NEW.canal := COALESCE(NEW.canal, 'manual');
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_alerta_enviada
    BEFORE INSERT OR UPDATE ON alertas
    FOR EACH ROW EXECUTE FUNCTION fn_alerta_enviada();

-- 11.7 Documento: copia "requiere revisión" desde la plantilla.
CREATE OR REPLACE FUNCTION fn_defaults_documento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.requiere_revision IS NULL THEN
        SELECT p.requiere_revision INTO NEW.requiere_revision
        FROM plantillas_documento p WHERE p.id = NEW.plantilla_id;
        NEW.requiere_revision := COALESCE(NEW.requiere_revision, false);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_defaults_documento
    BEFORE INSERT ON documentos
    FOR EACH ROW EXECUTE FUNCTION fn_defaults_documento();

-- 11.8 Firmas: un servicio con firmas incluidas suma saldo al cliente,
--      vigente hasta el vencimiento del contrato.
CREATE OR REPLACE FUNCTION fn_firmas_por_servicio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_firmas int;
    k        contratos%ROWTYPE;
BEGIN
    SELECT firmas_incluidas INTO v_firmas FROM servicios WHERE id = NEW.servicio_id;
    IF COALESCE(v_firmas, 0) > 0 THEN
        SELECT * INTO k FROM contratos WHERE id = NEW.contrato_id;
        INSERT INTO movimientos_firmas (cliente_id, motivo, cantidad, vence_en, contrato_id, detalle, registrado_por)
        VALUES (k.cliente_id, 'compra', v_firmas, k.fecha_vencimiento, k.id,
                'Incluidas en el contrato ' || k.folio, app_usuario());
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_firmas_por_servicio
    AFTER INSERT ON contrato_servicios
    FOR EACH ROW EXECUTE FUNCTION fn_firmas_por_servicio();

-- 11.9 Firmas: un documento firmado descuenta 1 firma si el cliente tiene firmas compradas.
CREATE OR REPLACE FUNCTION fn_firmas_por_documento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.estado = 'firmado' AND OLD.estado IS DISTINCT FROM 'firmado'
       AND EXISTS (SELECT 1 FROM movimientos_firmas m WHERE m.cliente_id = NEW.cliente_id AND m.motivo = 'compra') THEN
        INSERT INTO movimientos_firmas (cliente_id, motivo, cantidad, documento_id, detalle, registrado_por)
        VALUES (NEW.cliente_id, 'consumo', -1, NEW.id, 'Firma de ' || NEW.tipo, app_usuario())
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_firmas_por_documento
    AFTER UPDATE OF estado ON documentos
    FOR EACH ROW EXECUTE FUNCTION fn_firmas_por_documento();

-- 11.10 Correspondencia: urgencia y plazo por defecto, y fecha de cada cambio de estado.
CREATE OR REPLACE FUNCTION fn_defaults_correspondencia() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.urgente  := NEW.urgente OR NEW.tipo IN ('fiscal', 'judicial', 'laboral');
        NEW.plazo_en := COALESCE(NEW.plazo_en, NEW.recibida_en + interval '24 hours');
    END IF;
    IF NEW.estado = 'digitalizada' AND NEW.digitalizada_en IS NULL THEN NEW.digitalizada_en := now(); END IF;
    IF NEW.estado = 'notificada' THEN
        NEW.digitalizada_en := COALESCE(NEW.digitalizada_en, now());
        NEW.notificada_en   := COALESCE(NEW.notificada_en, now());
    END IF;
    IF NEW.estado = 'retirada' AND NEW.retirada_en IS NULL THEN NEW.retirada_en := now(); END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_defaults_correspondencia
    BEFORE INSERT OR UPDATE ON correspondencia
    FOR EACH ROW EXECUTE FUNCTION fn_defaults_correspondencia();


-- =====================================================================
-- 12. VISTAS
--     security_invoker: respetan los permisos y la visibilidad por fila de quien consulta.
-- =====================================================================

-- Datos para combinar el contrato (reemplaza la hoja de Excel que alimentaba Word).
CREATE VIEW v_datos_contrato WITH (security_invoker = true) AS
SELECT
    k.id AS contrato_id,
    k.folio,
    k.lugar_celebracion,
    fn_fecha_larga(k.fecha_celebracion)              AS fecha_celebracion,
    -- EASY OFFICE / INOFFICE
    e.razon_social                                   AS emisora_razon_social,
    fn_rut_formato(e.rut)                            AS emisora_rut,
    er.nombre_completo                               AS emisora_rep_nombre,
    fn_rut_formato(er.rut)                           AS emisora_rep_rut,
    er.nacionalidad                                  AS emisora_rep_nacionalidad,
    er.estado_civil                                  AS emisora_rep_estado_civil,
    er.profesion                                     AS emisora_rep_profesion,
    fn_dir_calle(er.direccion_id)                    AS emisora_domicilio,
    fn_dir_comuna(er.direccion_id)                   AS emisora_comuna,
    fn_dir_region(er.direccion_id)                   AS emisora_region,
    e.telefono                                       AS emisora_telefono,
    e.email                                          AS emisora_email,
    fn_fecha_larga(e.personeria_fecha)               AS emisora_personeria_fecha,
    e.personeria_fuente                              AS emisora_personeria_fuente,
    -- Sucursal / inmueble
    fn_dir_calle(su.direccion_id)                    AS sucursal_direccion,
    fn_dir_comuna(su.direccion_id)                   AS sucursal_comuna,
    fn_dir_region(su.direccion_id)                   AS sucursal_region,
    su.rol_propiedad,
    su.unidad_sii,
    -- Cliente
    cl.razon_social                                  AS cliente_razon_social,
    fn_rut_formato(cl.rut)                           AS cliente_rut,
    cl.giro_principal                                AS cliente_giro,
    cl.email                                         AS cliente_email,
    cl.celular                                       AS cliente_celular,
    cr.nombre_completo                               AS cliente_rep_nombre,
    fn_rut_formato(cr.rut)                           AS cliente_rep_rut,
    fn_dir_calle(cr.direccion_id)                    AS cliente_rep_domicilio,
    fn_dir_comuna(cr.direccion_id)                   AS cliente_rep_comuna,
    fn_dir_region(cr.direccion_id)                   AS cliente_rep_region,
    fn_fecha_larga(cl.fecha_escritura)               AS cliente_fecha_escritura,
    cl.sitio_notaria                                 AS cliente_sitio_notaria,
    -- Condiciones
    fn_fecha_larga(k.fecha_inicio)                   AS fecha_inicio,
    fn_fecha_larga(k.fecha_vencimiento)              AS fecha_vencimiento,
    '(' || k.duracion_meses || CASE WHEN k.duracion_meses = 1 THEN ' MES)' ELSE ' MESES)' END AS duracion,
    (SELECT string_agg(sv.nombre, '; ' ORDER BY cs.orden)
       FROM contrato_servicios cs JOIN servicios sv ON sv.id = cs.servicio_id
      WHERE cs.contrato_id = k.id)                   AS servicios,
    CASE WHEN ca.id IS NOT NULL THEN
        'transferencia en la ' || ca.tipo_cuenta || ' Nº ' || ca.numero_cuenta || ' del ' || ca.banco ||
        ', a nombre de su titular ' || ca.titular || ', R.U.T. ' || fn_rut_formato(ca.rut_titular)
    ELSE k.link_pago END                             AS medio_pago,
    -- Propietario que autoriza el uso del domicilio
    p.razon_social                                   AS propietario_razon_social,
    fn_rut_formato(p.rut)                            AS propietario_rut,
    pr.nombre_completo                               AS propietario_rep_nombre,
    fn_rut_formato(pr.rut)                           AS propietario_rep_rut,
    pr.nacionalidad                                  AS propietario_rep_nacionalidad,
    pr.estado_civil                                  AS propietario_rep_estado_civil,
    pr.profesion                                     AS propietario_rep_profesion,
    fn_dir_calle(p.direccion_id)                     AS propietario_domicilio,
    fn_dir_comuna(p.direccion_id)                    AS propietario_comuna,
    fn_dir_region(p.direccion_id)                    AS propietario_region,
    -- v2: tipo de cliente, su domicilio y la comparecencia lista para el contrato
    cl.tipo_persona                                  AS cliente_tipo_persona,
    fn_dir_calle(COALESCE(cl.direccion_id, cr.direccion_id))  AS cliente_domicilio,
    fn_dir_comuna(COALESCE(cl.direccion_id, cr.direccion_id)) AS cliente_comuna,
    fn_dir_region(COALESCE(cl.direccion_id, cr.direccion_id)) AS cliente_region,
    CASE WHEN cl.tipo_persona = 'natural' THEN
        cl.razon_social || ', cédula de identidad N° ' || fn_rut_formato(cl.rut)
        || COALESCE(', domiciliado en ' || fn_dir_calle(COALESCE(cl.direccion_id, cr.direccion_id))
                    || ', comuna de ' || fn_dir_comuna(COALESCE(cl.direccion_id, cr.direccion_id)), '')
        || ', por sí'
    ELSE
        cl.razon_social || ', R.U.T. ' || fn_rut_formato(cl.rut)
        || ', representada por ' || cr.nombre_completo
        || COALESCE(', ' || cr.nacionalidad, '') || COALESCE(', ' || cr.estado_civil, '') || COALESCE(', ' || cr.profesion, '')
        || ', cédula de identidad N° ' || fn_rut_formato(cr.rut)
        || COALESCE(', ambos domiciliados en ' || fn_dir_calle(COALESCE(cl.direccion_id, cr.direccion_id))
                    || ', comuna de ' || fn_dir_comuna(COALESCE(cl.direccion_id, cr.direccion_id)), '')
    END                                              AS cliente_comparecencia,
    k.contrato_anterior_id
FROM contratos k
JOIN empresas_emisoras e         ON e.id  = k.empresa_id
JOIN sucursales su               ON su.id = k.sucursal_id
JOIN clientes cl                 ON cl.id = k.cliente_id
LEFT JOIN representantes_legales er ON er.id = e.representante_legal_id
LEFT JOIN representantes_legales cr ON cr.id = cl.representante_legal_id
LEFT JOIN cuentas_recaudacion ca ON ca.id = k.cuenta_recaudacion_id
LEFT JOIN propietarios_inmueble p ON p.id = su.propietario_id
LEFT JOIN representantes_legales pr ON pr.id = p.representante_legal_id;

-- Tabla de precios y Anexo 1 (una fila por servicio)
CREATE VIEW v_datos_contrato_servicios WITH (security_invoker = true) AS
SELECT k.id AS contrato_id, k.folio, cs.orden, sv.nombre AS servicio,
       cs.precio, cs.ciclo_pago AS ciclo, cs.descripcion AS contenido
FROM contratos k
JOIN contrato_servicios cs ON cs.contrato_id = k.id
JOIN servicios sv          ON sv.id = cs.servicio_id;

-- Saldo por contrato: precios netos de los servicios vs. pagos confirmados.
CREATE VIEW v_saldo_contrato WITH (security_invoker = true) AS
SELECT k.id AS contrato_id, k.folio, k.fecha_vencimiento, k.estado,
       COALESCE(sv.total, 0)  AS total_servicios,
       COALESCE(pg.pagado, 0) AS pagado,
       COALESCE(sv.total, 0) - COALESCE(pg.pagado, 0) AS saldo
FROM contratos k
LEFT JOIN (SELECT contrato_id, sum(precio) AS total
             FROM contrato_servicios GROUP BY contrato_id) sv ON sv.contrato_id = k.id
LEFT JOIN (SELECT contrato_id, sum(monto) AS pagado
             FROM pagos WHERE estado = 'pagado' AND contrato_id IS NOT NULL
            GROUP BY contrato_id) pg ON pg.contrato_id = k.id;

-- Situación de renovación: vencido sin renovar = venció y ningún contrato lo renueva.
CREATE VIEW v_estado_renovacion WITH (security_invoker = true) AS
SELECT k.id AS contrato_id, k.folio, k.cliente_id, k.fecha_vencimiento,
       (k.fecha_vencimiento - CURRENT_DATE)         AS dias_para_vencer,
       r.id                                         AS renovado_por_id,
       r.folio                                      AS renovado_por_folio,
       (k.fecha_vencimiento < CURRENT_DATE AND r.id IS NULL AND k.estado IN ('activo','vencido')) AS vencido_sin_renovar
FROM contratos k
LEFT JOIN contratos r ON r.contrato_anterior_id = k.id AND r.estado <> 'cancelado';

-- Saldo de firmas por cliente. Las compras vencidas no suman; los consumos se
-- descuentan desde la compra vigente más antigua.
CREATE VIEW v_saldo_firmas WITH (security_invoker = true) AS
WITH vigentes AS (
    SELECT cliente_id, sum(cantidad)::int AS compradas, min(creado_en) AS desde, min(vence_en) AS proximo_vencimiento
      FROM movimientos_firmas
     WHERE motivo = 'compra' AND vence_en >= CURRENT_DATE
     GROUP BY cliente_id
), usados AS (
    SELECT m.cliente_id, (-sum(m.cantidad))::int AS consumidas
      FROM movimientos_firmas m JOIN vigentes v ON v.cliente_id = m.cliente_id
     WHERE m.motivo IN ('consumo', 'ajuste') AND m.creado_en >= v.desde
     GROUP BY m.cliente_id
)
SELECT v.cliente_id, v.compradas, COALESCE(u.consumidas, 0) AS consumidas,
       GREATEST(v.compradas - COALESCE(u.consumidas, 0), 0) AS disponibles,
       v.proximo_vencimiento
FROM vigentes v LEFT JOIN usados u ON u.cliente_id = v.cliente_id;


-- =====================================================================
-- 13. AUDITORÍA AUTOMÁTICA
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_registrar_actividad() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO registros_actividad
        (usuario_id, cliente_id, tabla_afectada, registro_id, accion, valores_anteriores, valores_nuevos, ip)
    VALUES (
        app_usuario(),
        app_cliente(),
        TG_TABLE_NAME,
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD)->>'id' ELSE to_jsonb(NEW)->>'id' END,
        TG_OP,
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
        app_ip()
    );
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

-- usuarios no se audita por trigger: guardaría password_hash y el secreto TOTP en la bitácora.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'clientes', 'representantes_legales', 'direcciones', 'empresas_emisoras',
        'propietarios_inmueble', 'sucursales', 'cuentas_recaudacion', 'servicios',
        'contratos', 'contrato_servicios',
        'plantillas_documento', 'clausulas_documento',
        'documentos', 'documento_versiones', 'documento_partes', 'documento_clausulas', 'pagos',
        'roles', 'permisos', 'roles_permisos', 'config_alertas',
        'movimientos_firmas', 'correspondencia', 'gestiones', 'prospectos', 'carros', 'solicitudes_titular'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_auditoria_%1$s
                 AFTER INSERT OR UPDATE OR DELETE ON %1$I
                 FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad()', t);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION fn_auditoria_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'registros_actividad es de solo lectura';
END;
$$;
CREATE TRIGGER trg_auditoria_inmutable
    BEFORE UPDATE OR DELETE ON registros_actividad
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_inmutable();
CREATE TRIGGER trg_auditoria_no_truncate
    BEFORE TRUNCATE ON registros_actividad
    FOR EACH STATEMENT EXECUTE FUNCTION fn_auditoria_inmutable();


-- =====================================================================
-- 14. SEGURIDAD A NIVEL DE FILA
--     Personal: el ejecutivo ve sus contratos y lo que cuelga de ellos; el
--     administrador ve todo; recepción ve los clientes y su correspondencia.
--     Portal: el cliente (rol_portal) solo ve lo suyo, según app_cliente().
-- =====================================================================

ALTER TABLE contratos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE representantes_legales ENABLE ROW LEVEL SECURITY;
ALTER TABLE contrato_servicios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_versiones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_partes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_clausulas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_firmas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE correspondencia        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gestiones              ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospectos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_titular    ENABLE ROW LEVEL SECURITY;

-- ---- Personal (mismas reglas de easyoffice_er.sql) ----
CREATE POLICY p_contratos ON contratos
    USING (ejecutivo_id = app_usuario() OR app_es_admin());

CREATE POLICY p_documentos ON documentos
    USING (
        ejecutivo_id = app_usuario()
        OR app_es_admin()
        OR (contrato_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = documentos.contrato_id))
    );

CREATE POLICY p_clientes ON clientes
    USING (
        registrado_por = app_usuario()
        OR app_es_admin()
        OR EXISTS (SELECT 1 FROM contratos  c WHERE c.cliente_id = clientes.id)
        OR EXISTS (SELECT 1 FROM documentos d WHERE d.cliente_id = clientes.id)
    );

CREATE POLICY p_representantes ON representantes_legales
    USING (
        registrado_por = app_usuario()
        OR app_es_admin()
        OR EXISTS (SELECT 1 FROM clientes c WHERE c.representante_legal_id = representantes_legales.id)
        OR EXISTS (SELECT 1 FROM empresas_emisoras e WHERE e.representante_legal_id = representantes_legales.id)
        OR EXISTS (SELECT 1 FROM propietarios_inmueble p WHERE p.representante_legal_id = representantes_legales.id)
    );

CREATE POLICY p_contrato_servicios ON contrato_servicios
    USING (EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_servicios.contrato_id));
CREATE POLICY p_alertas ON alertas
    USING (EXISTS (SELECT 1 FROM contratos c WHERE c.id = alertas.contrato_id));
CREATE POLICY p_documento_versiones ON documento_versiones
    USING (EXISTS (SELECT 1 FROM documentos d WHERE d.id = documento_versiones.documento_id));
CREATE POLICY p_documento_partes ON documento_partes
    USING (EXISTS (SELECT 1 FROM documentos d WHERE d.id = documento_partes.documento_id));
CREATE POLICY p_documento_clausulas ON documento_clausulas
    USING (EXISTS (SELECT 1 FROM documentos d WHERE d.id = documento_clausulas.documento_id));
CREATE POLICY p_pagos ON pagos
    USING (
        EXISTS (SELECT 1 FROM contratos  c WHERE c.id = pagos.contrato_id)
        OR EXISTS (SELECT 1 FROM documentos d WHERE d.id = pagos.documento_id)
    );

-- Tablas nuevas: siguen la visibilidad del cliente
CREATE POLICY p_movimientos_firmas ON movimientos_firmas
    USING (app_es_admin() OR EXISTS (SELECT 1 FROM clientes c WHERE c.id = movimientos_firmas.cliente_id));
CREATE POLICY p_gestiones ON gestiones
    USING (app_es_admin() OR usuario_id = app_usuario()
           OR EXISTS (SELECT 1 FROM clientes c WHERE c.id = gestiones.cliente_id));
CREATE POLICY p_prospectos ON prospectos
    USING (app_es_admin() OR asignado_a = app_usuario() OR asignado_a IS NULL);
CREATE POLICY p_solicitudes_titular ON solicitudes_titular
    USING (app_es_admin() OR EXISTS (SELECT 1 FROM clientes c WHERE c.id = solicitudes_titular.cliente_id));

-- Recepción (oficina de partes): ve a todos los clientes (solo lectura) y toda la correspondencia
CREATE POLICY p_clientes_recepcion ON clientes FOR SELECT
    USING (app_es_recepcion());
CREATE POLICY p_correspondencia ON correspondencia
    USING (app_es_admin() OR app_es_recepcion()
           OR EXISTS (SELECT 1 FROM clientes c WHERE c.id = correspondencia.cliente_id));


-- =====================================================================
-- 15. ROLES DE BASE DE DATOS
--     rol_admin      administradores (todo, salvo modificar la auditoría)
--     rol_ejecutivo  personal operativo y recepción (sin DELETE)
--     rol_portal     clientes en /mi-cuenta (solo lectura de lo suyo)
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_ejecutivo') THEN CREATE ROLE rol_ejecutivo NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_admin')     THEN CREATE ROLE rol_admin NOLOGIN;     END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_portal')    THEN CREATE ROLE rol_portal NOLOGIN;    END IF;
END;
$$;

-- ---- Portal de clientes: políticas solo para rol_portal ----
CREATE POLICY p_portal_clientes   ON clientes   FOR SELECT TO rol_portal USING (id = app_cliente());
CREATE POLICY p_portal_contratos  ON contratos  FOR SELECT TO rol_portal USING (cliente_id = app_cliente());
CREATE POLICY p_portal_documentos ON documentos FOR SELECT TO rol_portal USING (cliente_id = app_cliente());
CREATE POLICY p_portal_firmas     ON movimientos_firmas FOR SELECT TO rol_portal USING (cliente_id = app_cliente());
CREATE POLICY p_portal_correspondencia_ver ON correspondencia FOR SELECT TO rol_portal
    USING (cliente_id = app_cliente());
CREATE POLICY p_portal_correspondencia_leer ON correspondencia FOR UPDATE TO rol_portal
    USING (cliente_id = app_cliente()) WITH CHECK (cliente_id = app_cliente());
CREATE POLICY p_portal_solicitudes_ver ON solicitudes_titular FOR SELECT TO rol_portal
    USING (cliente_id = app_cliente());
CREATE POLICY p_portal_solicitudes_crear ON solicitudes_titular FOR INSERT TO rol_portal
    WITH CHECK (cliente_id = app_cliente() AND estado = 'recibida');
-- contrato_servicios, alertas, pagos, documento_partes/clausulas/versiones y representantes
-- ya heredan la visibilidad desde contratos, documentos y clientes.

-- ---- Ejecutivo ----
GRANT SELECT, INSERT, UPDATE ON
    clientes, representantes_legales, direcciones,
    contratos, contrato_servicios,
    documentos, documento_versiones, documento_partes, documento_clausulas, pagos,
    movimientos_firmas, correspondencia, gestiones, prospectos, solicitudes_titular
    TO rol_ejecutivo;
GRANT SELECT, UPDATE ON alertas, carros TO rol_ejecutivo;
GRANT SELECT ON
    regiones, comunas, empresas_emisoras, propietarios_inmueble, sucursales,
    cuentas_recaudacion, servicios, plantillas_documento, clausulas_documento,
    config_alertas, roles, permisos, roles_permisos,
    v_datos_contrato, v_datos_contrato_servicios, v_saldo_contrato, v_estado_renovacion, v_saldo_firmas
    TO rol_ejecutivo;
GRANT SELECT (id, nombre, email, rol_id, activo) ON usuarios TO rol_ejecutivo;

-- ---- Administrador ----
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO rol_admin;

-- ---- Portal (solo lectura, salvo marcar correspondencia leída y crear solicitudes Ley 21.719) ----
GRANT SELECT ON
    clientes, representantes_legales, direcciones, comunas, regiones,
    empresas_emisoras, sucursales, propietarios_inmueble, cuentas_recaudacion, servicios,
    contratos, contrato_servicios, alertas, pagos,
    documentos, documento_versiones, documento_partes, documento_clausulas,
    plantillas_documento, clausulas_documento,
    movimientos_firmas, correspondencia, solicitudes_titular,
    v_datos_contrato, v_datos_contrato_servicios, v_saldo_contrato, v_estado_renovacion, v_saldo_firmas
    TO rol_portal;
GRANT UPDATE (leida_en) ON correspondencia TO rol_portal;
GRANT INSERT (cliente_id, email, tipo, detalle) ON solicitudes_titular TO rol_portal;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rol_ejecutivo, rol_admin, rol_portal;

-- La auditoría solo la escriben los triggers; folios solo el trigger de contratos
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON registros_actividad FROM rol_ejecutivo, rol_admin, rol_portal;
REVOKE ALL ON folios_correlativos FROM rol_ejecutivo, rol_portal;


-- =====================================================================
-- 16. DATOS BASE
-- =====================================================================

-- Roles de la aplicación ("admin" y "dueno" son administradores para app_es_admin())
INSERT INTO roles (rol) VALUES ('dueno'), ('admin'), ('ejecutivo'), ('recepcion');

INSERT INTO permisos (permiso) VALUES
    ('ver_auditoria'), ('eliminar_registros'), ('administrar_usuarios'), ('administrar_catalogos'),
    ('aprobar_documentos'), ('registrar_pagos'), ('gestionar_renovaciones'),
    ('registrar_correspondencia'), ('ver_reportes');

INSERT INTO roles_permisos (rol_id, permisos_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permisos p WHERE r.rol IN ('dueno', 'admin');
INSERT INTO roles_permisos (rol_id, permisos_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
  ON p.permiso IN ('aprobar_documentos', 'registrar_pagos', 'gestionar_renovaciones', 'ver_reportes')
WHERE r.rol = 'ejecutivo';
INSERT INTO roles_permisos (rol_id, permisos_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.permiso IN ('registrar_correspondencia')
WHERE r.rol = 'recepcion';

-- Plazos de las alertas de vencimiento
INSERT INTO config_alertas (dias_anticipacion) VALUES (60), (30), (15), (7);

-- Regiones de Chile
INSERT INTO regiones (nombre_region) VALUES
    ('Región de Arica y Parinacota'), ('Región de Tarapacá'), ('Región de Antofagasta'),
    ('Región de Atacama'), ('Región de Coquimbo'), ('Región de Valparaíso'),
    ('Región Metropolitana'), ('Región del Libertador General Bernardo O''Higgins'),
    ('Región del Maule'), ('Región de Ñuble'), ('Región del Biobío'), ('Región de La Araucanía'),
    ('Región de Los Ríos'), ('Región de Los Lagos'),
    ('Región de Aysén del General Carlos Ibáñez del Campo'),
    ('Región de Magallanes y de la Antártica Chilena');

-- Comunas de las regiones con cobertura (Metropolitana y Valparaíso)
INSERT INTO comunas (nombre_comuna, region_id)
SELECT c, (SELECT id FROM regiones WHERE nombre_region = 'Región Metropolitana')
FROM unnest(ARRAY[
    'Santiago', 'Cerrillos', 'Cerro Navia', 'Conchalí', 'El Bosque', 'Estación Central', 'Huechuraba',
    'Independencia', 'La Cisterna', 'La Florida', 'La Granja', 'La Pintana', 'La Reina', 'Las Condes',
    'Lo Barnechea', 'Lo Espejo', 'Lo Prado', 'Macul', 'Maipú', 'Ñuñoa', 'Pedro Aguirre Cerda',
    'Peñalolén', 'Providencia', 'Pudahuel', 'Quilicura', 'Quinta Normal', 'Recoleta', 'Renca',
    'San Joaquín', 'San Miguel', 'San Ramón', 'Vitacura',
    'Puente Alto', 'Pirque', 'San José de Maipo',
    'Colina', 'Lampa', 'Tiltil',
    'San Bernardo', 'Buin', 'Calera de Tango', 'Paine',
    'Melipilla', 'Alhué', 'Curacaví', 'María Pinto', 'San Pedro',
    'Talagante', 'El Monte', 'Isla de Maipo', 'Padre Hurtado', 'Peñaflor'
]) AS c;

INSERT INTO comunas (nombre_comuna, region_id)
SELECT c, (SELECT id FROM regiones WHERE nombre_region = 'Región de Valparaíso')
FROM unnest(ARRAY[
    'Valparaíso', 'Casablanca', 'Concón', 'Juan Fernández', 'Puchuncaví', 'Quintero', 'Viña del Mar',
    'Isla de Pascua',
    'Los Andes', 'Calle Larga', 'Rinconada', 'San Esteban',
    'La Ligua', 'Cabildo', 'Papudo', 'Petorca', 'Zapallar',
    'Quillota', 'La Calera', 'Hijuelas', 'La Cruz', 'Nogales',
    'San Antonio', 'Algarrobo', 'Cartagena', 'El Quisco', 'El Tabo', 'Santo Domingo',
    'San Felipe', 'Catemu', 'Llaillay', 'Panquehue', 'Putaendo', 'Santa María',
    'Quilpué', 'Limache', 'Olmué', 'Villa Alemana'
]) AS c;

COMMIT;
