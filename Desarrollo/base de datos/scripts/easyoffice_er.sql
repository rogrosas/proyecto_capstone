-- EASY OFFICE · Base de datos
BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- 0. FUNCIONES AUXILIARES

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

-- 2026-10-02 → '02 DE OCTUBRE DE 2026'
CREATE OR REPLACE FUNCTION fn_fecha_larga(d date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN d IS NULL THEN NULL ELSE
        lpad(extract(day FROM d)::int::text, 2, '0') || ' DE ' ||
        (ARRAY['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO',
               'SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'])[extract(month FROM d)::int] ||
        ' DE ' || extract(year FROM d)::int END
$$;

-- Usuario y rol de la sesión (los fija la aplicación al conectarse).
CREATE OR REPLACE FUNCTION app_usuario() RETURNS int
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.usuario_actual', true), '')::int $$;

CREATE OR REPLACE FUNCTION app_es_admin() RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.rol_actual', true) IN ('admin', 'dueno'), false) $$;


-- 1. TERRITORIO Y DIRECCIONES

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
    numero       text NOT NULL,
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


-- 2. PERSONAS Y ENTIDADES

-- Representantes legales (de clientes, de Easy Office y de propietarios).
-- Nacionalidad / estado civil / profesión los exige la comparecencia del contrato.
CREATE TABLE representantes_legales (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut              text NOT NULL UNIQUE CHECK (fn_rut_valido(rut)),
    nombre_completo  text NOT NULL,
    nacionalidad     text,
    estado_civil     text,
    profesion        text,
    direccion_id     int REFERENCES direcciones (id)
);
CREATE INDEX ix_representantes_direccion ON representantes_legales (direccion_id);

-- Empresa / marca que emite el contrato: EASY OFFICE e INOFFICE.
-- Una marca puede cobrar a nombre de la misma razón social (la cuenta de INOFFICE
-- está a nombre de EASY OFFICE SpA), por eso el RUT no es único.
CREATE TABLE empresas_emisoras (
    id                      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_comercial        text NOT NULL UNIQUE,
    razon_social            text NOT NULL,
    rut                     text NOT NULL CHECK (fn_rut_valido(rut)),
    representante_legal_id  int REFERENCES representantes_legales (id),
    personeria_fecha        date,      -- "con fecha 10 de agosto de 2017"
    personeria_fuente       text,      -- "Registro de Empresas y Sociedades, Ley 20.659"
    telefono                text,      -- "+56 2 22777781"
    email                   citext,
    activo                  boolean NOT NULL DEFAULT true
);

-- Dueño del inmueble que autoriza el uso del domicilio (hoja "AUTORIZACIÓN" del contrato)
CREATE TABLE propietarios_inmueble (
    id                      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut                     text NOT NULL UNIQUE CHECK (fn_rut_valido(rut)),
    razon_social            text NOT NULL,     -- "MARCO ANTONIO ESCOBAR DONOSO SERVICIOS RETAIL E.I.R.L"
    representante_legal_id  int REFERENCES representantes_legales (id),
    direccion_id            int REFERENCES direcciones (id)
);

-- Hoja INFORMACIONES: comuna, dirección, rol, región; el prefijo sale de ObtenerCodigoSucursal()
CREATE TABLE sucursales (
    id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    empresa_id      int  NOT NULL REFERENCES empresas_emisoras (id),
    nombre          text NOT NULL,
    direccion_id    int  NOT NULL REFERENCES direcciones (id),
    rol_propiedad   text NOT NULL CHECK (rol_propiedad ~ '^[0-9]+-[0-9]+$'),
    prefijo_folio   text NOT NULL CHECK (prefijo_folio ~ '^[A-Z]{2}$'),     -- LF, VL, SA
    propietario_id  int REFERENCES propietarios_inmueble (id),
    unidad_sii      text,              -- unidad del SII ante la que se presenta la autorización
    activo          boolean NOT NULL DEFAULT true,
    UNIQUE (id, empresa_id),
    UNIQUE (empresa_id, nombre),
    UNIQUE (prefijo_folio)             -- el prefijo identifica la sucursal
);

-- Hoja INFORMACIONES (columna BANCOS): una cuenta por empresa emisora
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

-- 3. ROLES, PERMISOS Y USUARIOS

CREATE TABLE roles (
    id   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rol  text NOT NULL UNIQUE
);
CREATE TABLE permisos (
    id       int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    permiso  text NOT NULL UNIQUE
);
CREATE TABLE roles_permisos (
    rol_id       int NOT NULL REFERENCES roles (id)    ON DELETE CASCADE,
    permisos_id  int NOT NULL REFERENCES permisos (id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permisos_id)
);
CREATE INDEX ix_roles_permisos_permiso ON roles_permisos (permisos_id);

CREATE TABLE usuarios (
    id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre         text   NOT NULL,
    email          citext NOT NULL UNIQUE,
    rol_id         int    NOT NULL REFERENCES roles (id),
    password_hash  text   NOT NULL,
    activo         boolean NOT NULL DEFAULT true
);
CREATE INDEX ix_usuarios_rol ON usuarios (rol_id);


-- Quién registró al representante (base de la visibilidad por ejecutivo)
ALTER TABLE representantes_legales
    ADD COLUMN registrado_por int NOT NULL DEFAULT app_usuario() REFERENCES usuarios (id);
CREATE INDEX ix_representantes_registrado_por ON representantes_legales (registrado_por);

-- 4. AUDITORÍA (usuario_id NULL = acción automática del sistema)

CREATE TABLE registros_actividad (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id          int REFERENCES usuarios (id),
    tabla_afectada      text NOT NULL,
    registro_id         text,
    accion              text NOT NULL
                        CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT')),
    valores_anteriores  jsonb,
    valores_nuevos      jsonb,
    fecha               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_registros_actividad_usuario ON registros_actividad (usuario_id, fecha DESC);
CREATE INDEX ix_registros_actividad_tabla   ON registros_actividad (tabla_afectada, registro_id, fecha DESC);

-- 5. CLIENTES
--    Una razón social = un cliente. Puede tener varios contratos (renovaciones
--    anuales: la macro BuscarCliente recorre todas las hojas por año).

CREATE TABLE clientes (
    id                      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rut                     text NOT NULL UNIQUE CHECK (fn_rut_valido(rut)),
    razon_social            text NOT NULL,
    nombre_fantasia         text,
    giro_principal          text,
    email                   citext CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    celular                 text   CHECK (celular ~ '^9[0-9]{8}$'),
    representante_legal_id  int REFERENCES representantes_legales (id),
    fecha_escritura         date,      -- escritura / estatuto actualizado
    sitio_notaria           text,      -- sitio web o notaría
    registrado_por          int NOT NULL REFERENCES usuarios (id),
    creado_en               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_clientes_representante  ON clientes (representante_legal_id);
CREATE INDEX ix_clientes_registrado_por ON clientes (registrado_por);
CREATE INDEX ix_clientes_email          ON clientes (email);
CREATE INDEX ix_clientes_razon_social   ON clientes (lower(razon_social));

-- 6. CATÁLOGO DE SERVICIOS
--    PRINCIPAL: los del formulario (hoja INFORMACIONES).
--    COMPLEMENTARIO: "Servicios de cargo complementario" del Anexo 1.
--    Los precios del contrato son NETOS: "TODOS LOS VALORES MÁS I.V.A.".

CREATE TABLE servicios (
    id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    campos_formulario   jsonb,
    activo              boolean NOT NULL DEFAULT true
);

-- 7. CONTRATOS DE SERVICIO (= un FOLIO)

-- La macro GenerarFolio toma el MAYOR correlativo del año entre TODOS los folios
-- (sin distinguir sucursal) y suma 1. Se replica: un contador por año.
CREATE TABLE folios_correlativos (
    anio    int PRIMARY KEY,
    ultimo  int NOT NULL DEFAULT 0
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
    lugar_celebracion      text NOT NULL DEFAULT 'Santiago',      -- "En Santiago, a ..."
    fecha_celebracion      date NOT NULL DEFAULT CURRENT_DATE,
    fecha_inicio           date NOT NULL,
    duracion_meses         int  NOT NULL CHECK (duracion_meses > 0),   -- 12, 6, 4, 3, 1
    fecha_vencimiento      date NOT NULL,
    renovacion_automatica  boolean NOT NULL DEFAULT true,         -- cláusula QUINTO
    estado                 text NOT NULL DEFAULT 'activo'
                           CHECK (estado IN ('pendiente','activo','vencido','cancelado')),
    ejecutivo_id           int REFERENCES usuarios (id),
    observaciones          text,
    datos_formulario       jsonb,
    creado_en              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, cliente_id),
    CHECK (fecha_vencimiento >= fecha_inicio),
    CHECK (cuenta_recaudacion_id IS NOT NULL OR link_pago IS NOT NULL),
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursales (id, empresa_id),
    FOREIGN KEY (cuenta_recaudacion_id, empresa_id) REFERENCES cuentas_recaudacion (id, empresa_id)
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

-- 8. DOCUMENTOS POR PLANTILLA
--    Contratos de servicio, poder simple, acuerdo de accionistas,
--    arriendo de vehículo / estacionamiento y los que vengan.

CREATE TABLE plantillas_documento (
    id                   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo_documento       text NOT NULL,
    version              int  NOT NULL DEFAULT 1,
    familia              text NOT NULL
                         CHECK (familia IN ('CONTRATO_SERVICIO','PODER','ACUERDO_ACCIONISTAS','ARRIENDO','OTRO')),
    archivo_base         text,                 -- .docx de origen
    contenido_plantilla  text,
    campos               jsonb,                -- variables del documento: [{clave, etiqueta, tipo}]
    requiere_revision    boolean NOT NULL DEFAULT false,   -- verificación humana antes de firmar
    activo               boolean NOT NULL DEFAULT true,
    UNIQUE (tipo_documento, version)
);

-- Cláusulas reutilizables: el acuerdo de accionistas se arma eligiendo artículos
-- (cambio de razón social, eliminar accionista, ajustar capital...).
CREATE TABLE clausulas_documento (
    id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    familia          text NOT NULL,
    codigo           text NOT NULL,
    titulo           text NOT NULL,
    texto_plantilla  text NOT NULL,            -- con {variables}
    campos           jsonb,
    activo           boolean NOT NULL DEFAULT true,
    UNIQUE (familia, codigo)
);

-- Un documento pertenece a un cliente y, si nace de un contrato de servicio, a su folio.
CREATE TABLE documentos (
    id                  int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id          int  NOT NULL REFERENCES clientes (id),
    contrato_id         int,
    servicio_id         int  REFERENCES servicios (id),   -- servicio vendido (p. ej. "Declaración jurada")
    plantilla_id        int  REFERENCES plantillas_documento (id),
    tipo                text NOT NULL,
    lugar               text,
    fecha_documento     date,
    datos               jsonb,                             -- valores de las variables de la plantilla
    estado              text NOT NULL DEFAULT 'borrador'
                        CHECK (estado IN ('borrador','en_revision','aprobado','enviado_firma',
                                          'firmado','rechazado','anulado')),
    requiere_revision   boolean NOT NULL,                  -- se copia de la plantilla
    revisado_por        int  REFERENCES usuarios (id),
    revisado_en         timestamptz,
    ejecutivo_id        int  REFERENCES usuarios (id),
    url_archivo         text,
    firma_id_externo    text,                              -- id en la plataforma de firma
    firmado_en          timestamptz,
    codigo_verificacion text,
    generado_en         timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (contrato_id, cliente_id) REFERENCES contratos (id, cliente_id) ON DELETE CASCADE,
    -- regla de negocio: sin aprobación humana no se envía a firma
    CHECK (NOT requiere_revision
           OR estado NOT IN ('aprobado','enviado_firma','firmado')
           OR revisado_por IS NOT NULL)
);
CREATE INDEX ix_documentos_cliente  ON documentos (cliente_id);
CREATE INDEX ix_documentos_contrato ON documentos (contrato_id);
CREATE INDEX ix_documentos_estado   ON documentos (estado) WHERE estado IN ('en_revision','enviado_firma');

-- Partes que comparecen: arrendador/arrendatario, accionistas, poderdante/apoderado...
CREATE TABLE documento_partes (
    id                   int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    documento_id         int  NOT NULL REFERENCES documentos (id) ON DELETE CASCADE,
    orden                smallint NOT NULL DEFAULT 1,
    rol                  text NOT NULL,                  -- 'arrendador', 'accionista', 'apoderado'...
    tipo_persona         text NOT NULL CHECK (tipo_persona IN ('natural','juridica')),
    nombre               text NOT NULL,                  -- persona o razón social
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


-- 9. PAGOS Y ALERTAS

-- Un pago es de un contrato o de un documento suelto (servicios instantáneos del e-commerce).
CREATE TABLE pagos (
    id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contrato_id   int REFERENCES contratos (id),
    documento_id  int REFERENCES documentos (id),
    monto         numeric(12, 0) NOT NULL CHECK (monto > 0),
    estado        text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','pagado','rechazado','reembolsado')),
    pasarela      text CHECK (pasarela IN ('mercado_pago','transbank','transferencia')),
    fecha_pago    timestamptz,
    cuota         smallint NOT NULL DEFAULT 1,      -- 50/50 = dos pagos: cuota 1 de 2 y 2 de 2
    total_cuotas  smallint NOT NULL DEFAULT 1,
    CHECK (contrato_id IS NOT NULL OR documento_id IS NOT NULL),
    CHECK (cuota BETWEEN 1 AND total_cuotas)
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
INSERT INTO config_alertas (dias_anticipacion) VALUES (60), (30), (15), (7);

CREATE TABLE alertas (
    id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contrato_id        int  NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
    fecha_alerta       date NOT NULL,
    dias_anticipacion  int  NOT NULL,
    notificado         boolean NOT NULL DEFAULT false,
    UNIQUE (contrato_id, dias_anticipacion)
);
CREATE INDEX ix_alertas_fecha ON alertas (fecha_alerta) WHERE NOT notificado;

-- 10. AUTOMATIZACIONES

-- 10.1 Servicio contratado: precio, ciclo y contenido salen del catálogo si no se indican.
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

-- 10.2 Vencimiento por defecto = inicio + duración - 1 día
--      (ej.: 02-oct-2026 + 12 meses → 01-oct-2027, como en el contrato de oficina).
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

-- 10.3 Folio PREFIJO-correlativo(4 dígitos)-año, igual que la macro de Excel.
--      Si se ingresa uno manual (migración desde el Excel) se valida el prefijo
--      y el contador avanza para que el siguiente automático no choque.
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

-- 10.4 Alertas de vencimiento (60/30/15/7 días, configurables).
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

-- 10.5 Documento: copia "requiere revisión" desde la plantilla.
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

-- 11. VISTAS PARA COMBINACIÓN DE CORRESPONDENCIA
--     Reemplazan la hoja de Excel que alimentaba el contrato en Word.
--     security_invoker: respetan los permisos y la visibilidad por fila de quien consulta.

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
    fn_dir_region(p.direccion_id)                    AS propietario_region
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

-- 12. AUDITORÍA AUTOMÁTICA

CREATE OR REPLACE FUNCTION fn_registrar_actividad() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO registros_actividad
        (usuario_id, tabla_afectada, registro_id, accion, valores_anteriores, valores_nuevos)
    VALUES (
        app_usuario(),
        TG_TABLE_NAME,
        CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD)->>'id' ELSE to_jsonb(NEW)->>'id' END,
        TG_OP,
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
    );
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'clientes', 'representantes_legales', 'direcciones', 'empresas_emisoras',
        'propietarios_inmueble', 'sucursales', 'cuentas_recaudacion', 'servicios',
        'contratos', 'contrato_servicios',
        'plantillas_documento', 'clausulas_documento',
        'documentos', 'documento_partes', 'documento_clausulas', 'pagos'
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

-- 13. SEGURIDAD A NIVEL DE FILA
--     Contratos: solo los del ejecutivo asignado. Documentos: los de sus
--     contratos o los que él gestiona. Partes, cláusulas, pagos y alertas
--     heredan la visibilidad de su contrato o documento.

ALTER TABLE contratos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE representantes_legales ENABLE ROW LEVEL SECURITY;
ALTER TABLE contrato_servicios ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_partes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_clausulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas            ENABLE ROW LEVEL SECURITY;

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

-- Un representante se ve si lo registró el usuario, si es de un cliente visible,
-- o si es el representante de Easy Office / de un propietario (necesario para los contratos).
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
CREATE POLICY p_documento_partes ON documento_partes
    USING (EXISTS (SELECT 1 FROM documentos d WHERE d.id = documento_partes.documento_id));
CREATE POLICY p_documento_clausulas ON documento_clausulas
    USING (EXISTS (SELECT 1 FROM documentos d WHERE d.id = documento_clausulas.documento_id));
CREATE POLICY p_pagos ON pagos
    USING (
        EXISTS (SELECT 1 FROM contratos  c WHERE c.id = pagos.contrato_id)
        OR EXISTS (SELECT 1 FROM documentos d WHERE d.id = pagos.documento_id)
    );

-- 14. ROLES DE BASE DE DATOS (el personal operativo no recibe DELETE)

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_ejecutivo') THEN
        CREATE ROLE rol_ejecutivo NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_admin') THEN
        CREATE ROLE rol_admin NOLOGIN;
    END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON
    clientes, representantes_legales, direcciones,
    contratos, contrato_servicios,
    documentos, documento_partes, documento_clausulas, pagos
    TO rol_ejecutivo;
GRANT SELECT, UPDATE ON alertas TO rol_ejecutivo;
GRANT SELECT ON
    regiones, comunas, empresas_emisoras, propietarios_inmueble, sucursales,
    cuentas_recaudacion, servicios, plantillas_documento, clausulas_documento,
    config_alertas, roles, permisos, roles_permisos,
    v_datos_contrato, v_datos_contrato_servicios, v_saldo_contrato
    TO rol_ejecutivo;
GRANT SELECT (id, nombre, email, rol_id, activo) ON usuarios TO rol_ejecutivo;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rol_ejecutivo;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO rol_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rol_admin;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON registros_actividad FROM rol_ejecutivo, rol_admin;
REVOKE ALL ON folios_correlativos FROM rol_ejecutivo;

COMMIT;
