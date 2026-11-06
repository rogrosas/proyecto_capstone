-- =====================================================================
-- EASY OFFICE · Base de datos completa (esquema + datos), en un solo archivo
-- Generado el 6 de noviembre de 2026 desde la base EO_ER (PostgreSQL 18).
--
-- Trae TODO lo de EO_ER: tablas, reglas, vistas, funciones, disparadores,
-- auditoría, seguridad por fila, permisos y los datos actuales (clientes,
-- contratos, documentos, pagos, tickets, usuarios de prueba…).
-- Equivale a easyoffice_v2.sql + todas las migraciones de scripts/ + los datos.
--
-- CÓMO CARGARLO EN OTRO EQUIPO (PostgreSQL 15 o superior)
--   pgAdmin 4:
--     1. Clic derecho en "Databases" → Create → Database… → nombre: EO_ER → Save.
--     2. Sobre EO_ER: Tools → Query Tool → abrir este archivo → Ejecutar (F5).
--   Terminal:
--     createdb -U postgres EO_ER
--     psql -U postgres -d EO_ER -f easyoffice_completo.sql
--
-- Requisitos: una base VACÍA y un usuario que pueda crear roles y extensiones
-- (el usuario postgres). Todo corre en una transacción: si algo falla, no queda
-- nada a medias.
--
-- Después de cargarlo:
--   - En el .env de la aplicación: PGDATABASE=EO_ER y la contraseña de PostgreSQL.
--   - Los archivos Word (plantillas y contratos generados) NO van en este SQL:
--     copie también la carpeta "base de datos/Contratos".
--   - Los usuarios del CRM y del portal conservan sus contraseñas (bcrypt);
--     cámbielas en un equipo que no sea de desarrollo (npm run crear-usuario).
-- =====================================================================

BEGIN;

-- Roles que usa la aplicación (son del servidor, no de la base: se crean solo si faltan)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_ejecutivo') THEN CREATE ROLE rol_ejecutivo NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_admin')     THEN CREATE ROLE rol_admin NOLOGIN;     END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rol_portal')    THEN CREATE ROLE rol_portal NOLOGIN;    END IF;
END;
$$;

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: app_cliente(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_cliente() RETURNS integer
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.cliente_actual', true), '')::int $$;


--
-- Name: app_es_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_es_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ SELECT COALESCE(current_setting('app.rol_actual', true) IN ('admin', 'dueno'), false) $$;


--
-- Name: app_es_recepcion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_es_recepcion() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ SELECT COALESCE(current_setting('app.rol_actual', true) = 'recepcion', false) $$;


--
-- Name: app_ip(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_ip() RETURNS inet
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN NULLIF(current_setting('app.ip_actual', true), '')::inet;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;


--
-- Name: app_usuario(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_usuario() RETURNS integer
    LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.usuario_actual', true), '')::int $$;


--
-- Name: fn_alerta_enviada(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_alerta_enviada() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.notificado AND NEW.enviado_en IS NULL THEN
        NEW.enviado_en := now();
        NEW.canal := COALESCE(NEW.canal, 'manual');
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: fn_asignar_folio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_asignar_folio() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
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
$_$;


--
-- Name: fn_auditoria_inmutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_auditoria_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'registros_actividad es de solo lectura';
END;
$$;


--
-- Name: fn_defaults_cliente(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_defaults_cliente() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: fn_defaults_contrato(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_defaults_contrato() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.fecha_vencimiento := COALESCE(
        NEW.fecha_vencimiento,
        (NEW.fecha_inicio + make_interval(months => NEW.duracion_meses))::date - 1);
    RETURN NEW;
END;
$$;


--
-- Name: fn_defaults_contrato_servicio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_defaults_contrato_servicio() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE s servicios%ROWTYPE;
BEGIN
    SELECT * INTO s FROM servicios WHERE id = NEW.servicio_id;
    NEW.precio      := COALESCE(NEW.precio, s.precio_lista);
    NEW.ciclo_pago  := COALESCE(NEW.ciclo_pago, s.ciclo_pago_defecto);
    NEW.descripcion := COALESCE(NEW.descripcion, s.descripcion_base);
    RETURN NEW;
END;
$$;


--
-- Name: fn_defaults_correspondencia(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_defaults_correspondencia() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: fn_defaults_documento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_defaults_documento() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.requiere_revision IS NULL THEN
        SELECT p.requiere_revision INTO NEW.requiere_revision
        FROM plantillas_documento p WHERE p.id = NEW.plantilla_id;
        NEW.requiere_revision := COALESCE(NEW.requiere_revision, false);
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: fn_dir_calle(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dir_calle(p_id integer) RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT d.calle || ' ' || d.numero || COALESCE(', ' || d.complemento, '')
    FROM direcciones d WHERE d.id = p_id $$;


--
-- Name: fn_dir_comuna(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dir_comuna(p_id integer) RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT c.nombre_comuna FROM direcciones d JOIN comunas c ON c.id = d.comuna_id WHERE d.id = p_id $$;


--
-- Name: fn_dir_region(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dir_region(p_id integer) RETURNS text
    LANGUAGE sql STABLE
    AS $$
    SELECT r.nombre_region FROM direcciones d JOIN comunas c ON c.id = d.comuna_id
    JOIN regiones r ON r.id = c.region_id WHERE d.id = p_id $$;


--
-- Name: fn_fecha_larga(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_fecha_larga(d date) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE WHEN d IS NULL THEN NULL ELSE
        lpad(extract(day FROM d)::int::text, 2, '0') || ' DE ' ||
        (ARRAY['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO',
               'SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'])[extract(month FROM d)::int] ||
        ' DE ' || extract(year FROM d)::int END
$$;


--
-- Name: fn_firmas_por_documento(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_firmas_por_documento() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: fn_firmas_por_servicio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_firmas_por_servicio() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: fn_generar_alertas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_generar_alertas() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: fn_registrar_actividad(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_registrar_actividad() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: fn_rut_formato(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_rut_formato(rut text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
    SELECT CASE WHEN rut IS NULL THEN NULL
           ELSE regexp_replace(split_part(rut, '-', 1), '(\d)(?=(\d{3})+$)', '\1.', 'g')
                || '-' || split_part(rut, '-', 2) END
$_$;


--
-- Name: fn_rut_valido(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_rut_valido(rut text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
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
$_$;


--
-- Name: fn_tipo_persona_por_rut(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tipo_persona_por_rut(rut text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE WHEN split_part(rut, '-', 1)::bigint >= 50000000 THEN 'juridica' ELSE 'natural' END
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alertas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alertas (
    id integer NOT NULL,
    contrato_id integer NOT NULL,
    fecha_alerta date NOT NULL,
    dias_anticipacion integer NOT NULL,
    notificado boolean DEFAULT false NOT NULL,
    canal text,
    enviado_en timestamp with time zone,
    CONSTRAINT alertas_canal_check CHECK ((canal = ANY (ARRAY['correo'::text, 'whatsapp'::text, 'llamada'::text, 'manual'::text]))),
    CONSTRAINT alertas_check CHECK (((NOT notificado) OR (enviado_en IS NOT NULL)))
);


--
-- Name: alertas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.alertas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.alertas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: carros; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carros (
    id integer NOT NULL,
    email public.citext NOT NULL,
    servicio_id integer,
    codigo_plan text,
    datos jsonb,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    recordado_en timestamp with time zone,
    convertido_contrato_id integer,
    convertido_en timestamp with time zone,
    CONSTRAINT carros_check CHECK (((convertido_contrato_id IS NULL) OR (convertido_en IS NOT NULL)))
);


--
-- Name: carros_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.carros ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.carros_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: clausulas_documento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clausulas_documento (
    id integer NOT NULL,
    familia text NOT NULL,
    codigo text NOT NULL,
    titulo text NOT NULL,
    texto_plantilla text NOT NULL,
    campos jsonb,
    activo boolean DEFAULT true NOT NULL
);


--
-- Name: clausulas_documento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.clausulas_documento ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.clausulas_documento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id integer NOT NULL,
    rut text NOT NULL,
    tipo_persona text NOT NULL,
    razon_social text NOT NULL,
    nombre_fantasia text,
    giro_principal text,
    email public.citext,
    celular text,
    direccion_id integer,
    representante_legal_id integer,
    fecha_escritura date,
    sitio_notaria text,
    origen text DEFAULT 'crm'::text NOT NULL,
    acepta_comunicaciones boolean DEFAULT false NOT NULL,
    consentimiento_en timestamp with time zone,
    registrado_por integer DEFAULT public.app_usuario(),
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_clientes_consentimiento CHECK (((NOT acepta_comunicaciones) OR (consentimiento_en IS NOT NULL))),
    CONSTRAINT ck_clientes_juridica_con_representante CHECK (((tipo_persona = 'natural'::text) OR (representante_legal_id IS NOT NULL))),
    CONSTRAINT ck_clientes_natural_sin_escritura CHECK (((tipo_persona = 'juridica'::text) OR (fecha_escritura IS NULL))),
    CONSTRAINT ck_clientes_registrado_por CHECK (((registrado_por IS NOT NULL) OR (origen <> 'crm'::text))),
    CONSTRAINT clientes_celular_check CHECK ((celular ~ '^9[0-9]{8}$'::text)),
    CONSTRAINT clientes_email_check CHECK ((email OPERATOR(public.~) '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::public.citext)),
    CONSTRAINT clientes_origen_check CHECK ((origen = ANY (ARRAY['crm'::text, 'web'::text, 'migracion'::text]))),
    CONSTRAINT clientes_rut_check CHECK (public.fn_rut_valido(rut)),
    CONSTRAINT clientes_tipo_persona_check CHECK ((tipo_persona = ANY (ARRAY['natural'::text, 'juridica'::text])))
);


--
-- Name: clientes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.clientes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.clientes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: comunas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comunas (
    id integer NOT NULL,
    nombre_comuna text NOT NULL,
    region_id integer NOT NULL
);


--
-- Name: comunas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.comunas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.comunas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: config_alertas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_alertas (
    dias_anticipacion integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    CONSTRAINT config_alertas_dias_anticipacion_check CHECK ((dias_anticipacion > 0))
);


--
-- Name: contrato_servicios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contrato_servicios (
    id integer NOT NULL,
    contrato_id integer NOT NULL,
    orden smallint NOT NULL,
    servicio_id integer NOT NULL,
    precio numeric(12,0) NOT NULL,
    ciclo_pago text NOT NULL,
    descripcion text,
    CONSTRAINT contrato_servicios_ciclo_pago_check CHECK ((ciclo_pago = ANY (ARRAY['UNICO'::text, 'MENSUAL'::text, 'TRIMESTRAL'::text, 'SEMESTRAL'::text, 'ANUAL'::text]))),
    CONSTRAINT contrato_servicios_orden_check CHECK ((orden > 0)),
    CONSTRAINT contrato_servicios_precio_check CHECK ((precio >= (0)::numeric))
);


--
-- Name: contrato_servicios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.contrato_servicios ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.contrato_servicios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: contratos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos (
    id integer NOT NULL,
    folio text NOT NULL,
    empresa_id integer NOT NULL,
    cliente_id integer NOT NULL,
    sucursal_id integer NOT NULL,
    cuenta_recaudacion_id integer,
    link_pago text,
    lugar_celebracion text DEFAULT 'Santiago'::text NOT NULL,
    fecha_celebracion date DEFAULT CURRENT_DATE NOT NULL,
    fecha_inicio date NOT NULL,
    duracion_meses integer NOT NULL,
    fecha_vencimiento date NOT NULL,
    renovacion_automatica boolean DEFAULT true NOT NULL,
    estado text DEFAULT 'activo'::text NOT NULL,
    contrato_anterior_id integer,
    origen text DEFAULT 'crm'::text NOT NULL,
    ejecutivo_id integer,
    observaciones text,
    datos_formulario jsonb,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contratos_check CHECK ((fecha_vencimiento >= fecha_inicio)),
    CONSTRAINT contratos_check1 CHECK (((cuenta_recaudacion_id IS NOT NULL) OR (link_pago IS NOT NULL))),
    CONSTRAINT contratos_check2 CHECK (((contrato_anterior_id IS NULL) OR (contrato_anterior_id <> id))),
    CONSTRAINT contratos_duracion_meses_check CHECK ((duracion_meses > 0)),
    CONSTRAINT contratos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'activo'::text, 'vencido'::text, 'cancelado'::text]))),
    CONSTRAINT contratos_folio_check CHECK ((folio ~ '^[A-Z]{2}-[0-9]{2,4}-[0-9]{4}$'::text)),
    CONSTRAINT contratos_origen_check CHECK ((origen = ANY (ARRAY['crm'::text, 'web'::text, 'migracion'::text])))
);


--
-- Name: contratos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.contratos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.contratos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: correspondencia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.correspondencia (
    id integer NOT NULL,
    cliente_id integer NOT NULL,
    sucursal_id integer NOT NULL,
    remitente text NOT NULL,
    tipo text NOT NULL,
    descripcion text,
    urgente boolean DEFAULT false NOT NULL,
    estado text DEFAULT 'recibida'::text NOT NULL,
    recibida_en timestamp with time zone DEFAULT now() NOT NULL,
    plazo_en timestamp with time zone NOT NULL,
    digitalizada_en timestamp with time zone,
    notificada_en timestamp with time zone,
    leida_en timestamp with time zone,
    retirada_en timestamp with time zone,
    url_archivo text,
    registrado_por integer DEFAULT public.app_usuario(),
    CONSTRAINT correspondencia_check CHECK ((plazo_en >= recibida_en)),
    CONSTRAINT correspondencia_check1 CHECK (((estado = ANY (ARRAY['recibida'::text, 'devuelta'::text])) OR (digitalizada_en IS NOT NULL) OR (estado = 'retirada'::text))),
    CONSTRAINT correspondencia_check2 CHECK (((estado <> 'notificada'::text) OR (notificada_en IS NOT NULL))),
    CONSTRAINT correspondencia_estado_check CHECK ((estado = ANY (ARRAY['recibida'::text, 'digitalizada'::text, 'notificada'::text, 'retirada'::text, 'devuelta'::text]))),
    CONSTRAINT correspondencia_tipo_check CHECK ((tipo = ANY (ARRAY['fiscal'::text, 'judicial'::text, 'laboral'::text, 'municipal'::text, 'bancaria'::text, 'comercial'::text, 'otra'::text])))
);


--
-- Name: correspondencia_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.correspondencia ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.correspondencia_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cuentas_portal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cuentas_portal (
    id integer NOT NULL,
    cliente_id integer NOT NULL,
    email public.citext NOT NULL,
    nombre text,
    autorizado boolean DEFAULT false NOT NULL,
    password_hash text,
    activo boolean DEFAULT true NOT NULL,
    clave_definida_en timestamp with time zone,
    ultimo_ingreso timestamp with time zone,
    registrado_por integer DEFAULT public.app_usuario(),
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cuentas_portal_email_check CHECK ((email OPERATOR(public.~) '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::public.citext)),
    CONSTRAINT cuentas_portal_password_hash_check CHECK ((password_hash ~ '^\$2[aby]\$'::text))
);


--
-- Name: cuentas_portal_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cuentas_portal ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cuentas_portal_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: cuentas_recaudacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cuentas_recaudacion (
    id integer NOT NULL,
    empresa_id integer NOT NULL,
    banco text NOT NULL,
    tipo_cuenta text NOT NULL,
    numero_cuenta text NOT NULL,
    titular text NOT NULL,
    rut_titular text NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    CONSTRAINT cuentas_recaudacion_rut_titular_check CHECK (public.fn_rut_valido(rut_titular))
);


--
-- Name: cuentas_recaudacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.cuentas_recaudacion ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.cuentas_recaudacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: direcciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.direcciones (
    id integer NOT NULL,
    calle text NOT NULL,
    numero text NOT NULL,
    complemento text,
    comuna_id integer NOT NULL
);


--
-- Name: direcciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.direcciones ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.direcciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documento_clausulas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_clausulas (
    id integer NOT NULL,
    documento_id integer NOT NULL,
    orden smallint NOT NULL,
    clausula_id integer NOT NULL,
    valores jsonb
);


--
-- Name: documento_clausulas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.documento_clausulas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.documento_clausulas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documento_firmantes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_firmantes (
    id integer NOT NULL,
    documento_id integer NOT NULL,
    orden smallint NOT NULL,
    nombre text NOT NULL,
    rut text,
    email public.citext NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    id_externo text,
    firmado_en timestamp with time zone,
    ip inet,
    motivo_rechazo text,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documento_firmantes_check CHECK (((estado <> 'firmado'::text) OR (firmado_en IS NOT NULL))),
    CONSTRAINT documento_firmantes_check1 CHECK (((estado <> 'rechazado'::text) OR (motivo_rechazo IS NOT NULL))),
    CONSTRAINT documento_firmantes_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'firmado'::text, 'rechazado'::text]))),
    CONSTRAINT documento_firmantes_orden_check CHECK ((orden > 0)),
    CONSTRAINT documento_firmantes_rut_check CHECK (((rut IS NULL) OR public.fn_rut_valido(rut)))
);


--
-- Name: documento_firmantes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.documento_firmantes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.documento_firmantes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documento_partes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_partes (
    id integer NOT NULL,
    documento_id integer NOT NULL,
    orden smallint DEFAULT 1 NOT NULL,
    rol text NOT NULL,
    tipo_persona text NOT NULL,
    nombre text NOT NULL,
    rut text,
    nacionalidad text,
    estado_civil text,
    profesion text,
    direccion_id integer,
    email public.citext,
    telefono text,
    representante_nombre text,
    representante_rut text,
    cantidad_acciones bigint,
    CONSTRAINT documento_partes_cantidad_acciones_check CHECK ((cantidad_acciones >= 0)),
    CONSTRAINT documento_partes_representante_rut_check CHECK (((representante_rut IS NULL) OR public.fn_rut_valido(representante_rut))),
    CONSTRAINT documento_partes_rut_check CHECK (((rut IS NULL) OR public.fn_rut_valido(rut))),
    CONSTRAINT documento_partes_tipo_persona_check CHECK ((tipo_persona = ANY (ARRAY['natural'::text, 'juridica'::text])))
);


--
-- Name: documento_partes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.documento_partes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.documento_partes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documento_versiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_versiones (
    id integer NOT NULL,
    documento_id integer NOT NULL,
    version integer NOT NULL,
    url_archivo text NOT NULL,
    hash_sha256 text,
    generado_por integer DEFAULT public.app_usuario(),
    generado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documento_versiones_hash_sha256_check CHECK ((hash_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT documento_versiones_version_check CHECK ((version > 0))
);


--
-- Name: documento_versiones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.documento_versiones ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.documento_versiones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos (
    id integer NOT NULL,
    cliente_id integer NOT NULL,
    contrato_id integer,
    servicio_id integer,
    plantilla_id integer,
    tipo text NOT NULL,
    lugar text,
    fecha_documento date,
    datos jsonb,
    estado text DEFAULT 'borrador'::text NOT NULL,
    requiere_revision boolean NOT NULL,
    revisado_por integer,
    revisado_en timestamp with time zone,
    version_aprobada integer,
    ejecutivo_id integer,
    url_archivo text,
    firma_id_externo text,
    firmado_en timestamp with time zone,
    codigo_verificacion text,
    generado_en timestamp with time zone DEFAULT now() NOT NULL,
    estado_cliente text,
    publicado_en timestamp with time zone,
    aceptado_en timestamp with time zone,
    aceptado_por public.citext,
    aceptado_ip inet,
    version_aceptada integer,
    firma_proveedor text,
    enviado_firma_en timestamp with time zone,
    archivo_firmado text,
    hash_firmado text,
    CONSTRAINT ck_documentos_aceptado CHECK (((estado_cliente IS DISTINCT FROM 'aceptado'::text) OR ((aceptado_en IS NOT NULL) AND (aceptado_por IS NOT NULL)))),
    CONSTRAINT ck_documentos_firmado_con_hash CHECK (((archivo_firmado IS NULL) OR (hash_firmado IS NOT NULL))),
    CONSTRAINT documentos_check CHECK (((NOT requiere_revision) OR (estado <> ALL (ARRAY['aprobado'::text, 'enviado_firma'::text, 'firmado'::text])) OR (revisado_por IS NOT NULL))),
    CONSTRAINT documentos_check1 CHECK (((estado <> 'firmado'::text) OR (firmado_en IS NOT NULL))),
    CONSTRAINT documentos_codigo_verificacion_check CHECK (((codigo_verificacion IS NULL) OR (codigo_verificacion ~ '^EO-[0-9A-F]{4}-[0-9A-F]{4}$'::text))),
    CONSTRAINT documentos_estado_check CHECK ((estado = ANY (ARRAY['borrador'::text, 'en_revision'::text, 'aprobado'::text, 'enviado_firma'::text, 'firmado'::text, 'rechazado'::text, 'anulado'::text]))),
    CONSTRAINT documentos_estado_cliente_check CHECK ((estado_cliente = ANY (ARRAY['por_revisar'::text, 'aceptado'::text, 'objetado'::text]))),
    CONSTRAINT documentos_hash_firmado_check CHECK ((hash_firmado ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: documentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.documentos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.documentos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ejecuciones_avisos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ejecuciones_avisos (
    id integer NOT NULL,
    origen text NOT NULL,
    usuario_id integer,
    iniciado_en timestamp with time zone DEFAULT now() NOT NULL,
    terminado_en timestamp with time zone,
    contratos integer DEFAULT 0 NOT NULL,
    correos integer DEFAULT 0 NOT NULL,
    sin_correo integer DEFAULT 0 NOT NULL,
    errores integer DEFAULT 0 NOT NULL,
    detalle jsonb,
    CONSTRAINT ejecuciones_avisos_check CHECK (((origen = 'automatico'::text) OR (usuario_id IS NOT NULL))),
    CONSTRAINT ejecuciones_avisos_contratos_check CHECK ((contratos >= 0)),
    CONSTRAINT ejecuciones_avisos_correos_check CHECK ((correos >= 0)),
    CONSTRAINT ejecuciones_avisos_errores_check CHECK ((errores >= 0)),
    CONSTRAINT ejecuciones_avisos_origen_check CHECK ((origen = ANY (ARRAY['automatico'::text, 'manual'::text]))),
    CONSTRAINT ejecuciones_avisos_sin_correo_check CHECK ((sin_correo >= 0))
);


--
-- Name: ejecuciones_avisos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ejecuciones_avisos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ejecuciones_avisos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: empresas_emisoras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empresas_emisoras (
    id integer NOT NULL,
    nombre_comercial text NOT NULL,
    razon_social text NOT NULL,
    rut text NOT NULL,
    representante_legal_id integer,
    personeria_fecha date,
    personeria_fuente text,
    telefono text,
    email public.citext,
    activo boolean DEFAULT true NOT NULL,
    CONSTRAINT empresas_emisoras_rut_check CHECK (public.fn_rut_valido(rut))
);


--
-- Name: empresas_emisoras_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.empresas_emisoras ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.empresas_emisoras_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: folios_correlativos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.folios_correlativos (
    anio integer NOT NULL,
    ultimo integer DEFAULT 0 NOT NULL,
    CONSTRAINT folios_correlativos_ultimo_check CHECK ((ultimo >= 0))
);


--
-- Name: gestiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gestiones (
    id integer NOT NULL,
    cliente_id integer NOT NULL,
    contrato_id integer,
    usuario_id integer DEFAULT public.app_usuario() NOT NULL,
    tipo text NOT NULL,
    resultado text,
    nota text,
    proxima_accion_en date,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gestiones_resultado_check CHECK ((resultado = ANY (ARRAY['sin_respuesta'::text, 'contactado'::text, 'promete_pago'::text, 'renueva'::text, 'no_renueva'::text, 'otro'::text]))),
    CONSTRAINT gestiones_tipo_check CHECK ((tipo = ANY (ARRAY['llamada'::text, 'correo'::text, 'whatsapp'::text, 'reunion'::text, 'link_pago'::text, 'nota'::text])))
);


--
-- Name: gestiones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.gestiones ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.gestiones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: movimientos_firmas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.movimientos_firmas (
    id integer NOT NULL,
    cliente_id integer NOT NULL,
    motivo text NOT NULL,
    cantidad integer NOT NULL,
    vence_en date,
    contrato_id integer,
    documento_id integer,
    detalle text,
    registrado_por integer DEFAULT public.app_usuario(),
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT movimientos_firmas_cantidad_check CHECK ((cantidad <> 0)),
    CONSTRAINT movimientos_firmas_check CHECK (((motivo <> 'compra'::text) OR ((cantidad > 0) AND (vence_en IS NOT NULL)))),
    CONSTRAINT movimientos_firmas_check1 CHECK (((motivo <> 'consumo'::text) OR ((cantidad < 0) AND (documento_id IS NOT NULL)))),
    CONSTRAINT movimientos_firmas_motivo_check CHECK ((motivo = ANY (ARRAY['compra'::text, 'consumo'::text, 'ajuste'::text])))
);


--
-- Name: movimientos_firmas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.movimientos_firmas ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.movimientos_firmas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pagos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos (
    id integer NOT NULL,
    contrato_id integer,
    documento_id integer,
    monto numeric(12,0) NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    pasarela text,
    fecha_pago timestamp with time zone,
    cuota smallint DEFAULT 1 NOT NULL,
    total_cuotas smallint DEFAULT 1 NOT NULL,
    id_transaccion text,
    codigo_autorizacion text,
    ultimos_4 text,
    respuesta_pasarela jsonb,
    conciliado_en timestamp with time zone,
    tipo_dte text,
    folio_dte bigint,
    url_dte text,
    CONSTRAINT pagos_check CHECK (((contrato_id IS NOT NULL) OR (documento_id IS NOT NULL))),
    CONSTRAINT pagos_check1 CHECK (((cuota >= 1) AND (cuota <= total_cuotas))),
    CONSTRAINT pagos_check2 CHECK (((estado <> 'pagado'::text) OR (fecha_pago IS NOT NULL))),
    CONSTRAINT pagos_check3 CHECK (((folio_dte IS NULL) OR (tipo_dte IS NOT NULL))),
    CONSTRAINT pagos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'pagado'::text, 'rechazado'::text, 'reembolsado'::text]))),
    CONSTRAINT pagos_folio_dte_check CHECK ((folio_dte > 0)),
    CONSTRAINT pagos_monto_check CHECK ((monto > (0)::numeric)),
    CONSTRAINT pagos_pasarela_check CHECK ((pasarela = ANY (ARRAY['mercado_pago'::text, 'transbank'::text, 'transferencia'::text]))),
    CONSTRAINT pagos_tipo_dte_check CHECK ((tipo_dte = ANY (ARRAY['boleta'::text, 'factura'::text, 'exento'::text]))),
    CONSTRAINT pagos_ultimos_4_check CHECK ((ultimos_4 ~ '^[0-9]{4}$'::text))
);


--
-- Name: pagos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pagos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pagos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: permisos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permisos (
    id integer NOT NULL,
    permiso text NOT NULL
);


--
-- Name: permisos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.permisos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.permisos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: plantilla_planes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plantilla_planes (
    plantilla_id integer NOT NULL,
    plan_codigo text NOT NULL,
    CONSTRAINT plantilla_planes_plan_codigo_check CHECK ((plan_codigo ~ '^[a-z0-9-]+$'::text))
);


--
-- Name: plantillas_documento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plantillas_documento (
    id integer NOT NULL,
    tipo_documento text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    familia text NOT NULL,
    archivo_base text,
    contenido_plantilla text,
    campos jsonb,
    requiere_revision boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    entrega text DEFAULT 'revision'::text NOT NULL,
    mapa_campos jsonb,
    CONSTRAINT plantillas_documento_entrega_check CHECK ((entrega = ANY (ARRAY['automatica'::text, 'revision'::text]))),
    CONSTRAINT plantillas_documento_familia_check CHECK ((familia = ANY (ARRAY['CONTRATO_SERVICIO'::text, 'PODER'::text, 'ACUERDO_ACCIONISTAS'::text, 'ARRIENDO'::text, 'OTRO'::text])))
);


--
-- Name: plantillas_documento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.plantillas_documento ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.plantillas_documento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: propietarios_inmueble; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.propietarios_inmueble (
    id integer NOT NULL,
    rut text NOT NULL,
    razon_social text NOT NULL,
    representante_legal_id integer,
    direccion_id integer,
    CONSTRAINT propietarios_inmueble_rut_check CHECK (public.fn_rut_valido(rut))
);


--
-- Name: propietarios_inmueble_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.propietarios_inmueble ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.propietarios_inmueble_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: prospectos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospectos (
    id integer NOT NULL,
    nombre text NOT NULL,
    email public.citext,
    celular text,
    servicio_interes text,
    mensaje text,
    origen text DEFAULT 'web'::text NOT NULL,
    estado text DEFAULT 'nuevo'::text NOT NULL,
    asignado_a integer,
    cliente_id integer,
    acepta_comunicaciones boolean DEFAULT false NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prospectos_celular_check CHECK ((celular ~ '^9[0-9]{8}$'::text)),
    CONSTRAINT prospectos_check CHECK (((email IS NOT NULL) OR (celular IS NOT NULL))),
    CONSTRAINT prospectos_check1 CHECK (((estado <> 'convertido'::text) OR (cliente_id IS NOT NULL))),
    CONSTRAINT prospectos_email_check CHECK ((email OPERATOR(public.~) '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::public.citext)),
    CONSTRAINT prospectos_estado_check CHECK ((estado = ANY (ARRAY['nuevo'::text, 'contactado'::text, 'convertido'::text, 'descartado'::text]))),
    CONSTRAINT prospectos_origen_check CHECK ((origen = ANY (ARRAY['web'::text, 'telefono'::text, 'correo'::text, 'referido'::text, 'agenda'::text, 'otro'::text])))
);


--
-- Name: prospectos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.prospectos ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.prospectos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: regiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regiones (
    id integer NOT NULL,
    nombre_region text NOT NULL
);


--
-- Name: regiones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.regiones ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.regiones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: registros_actividad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registros_actividad (
    id bigint NOT NULL,
    usuario_id integer,
    cliente_id integer,
    tabla_afectada text NOT NULL,
    registro_id text,
    accion text NOT NULL,
    detalle text,
    valores_anteriores jsonb,
    valores_nuevos jsonb,
    ip inet,
    user_agent text,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registros_actividad_accion_check CHECK ((accion = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text, 'LOGIN'::text, 'LOGOUT'::text, 'LOGIN_FALLIDO'::text, 'DENEGADO'::text])))
);


--
-- Name: registros_actividad_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.registros_actividad ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.registros_actividad_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: representantes_legales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.representantes_legales (
    id integer NOT NULL,
    rut text NOT NULL,
    nombre_completo text NOT NULL,
    nacionalidad text,
    estado_civil text,
    profesion text,
    email public.citext,
    direccion_id integer,
    registrado_por integer DEFAULT public.app_usuario(),
    CONSTRAINT representantes_legales_email_check CHECK ((email OPERATOR(public.~) '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::public.citext)),
    CONSTRAINT representantes_legales_rut_check CHECK (public.fn_rut_valido(rut))
);


--
-- Name: representantes_legales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.representantes_legales ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.representantes_legales_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    rol text NOT NULL
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: roles_permisos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles_permisos (
    rol_id integer NOT NULL,
    permisos_id integer NOT NULL
);


--
-- Name: servicios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servicios (
    id integer NOT NULL,
    codigo text,
    nombre text NOT NULL,
    tipo text DEFAULT 'PRINCIPAL'::text NOT NULL,
    descripcion_base text,
    precio_lista numeric(12,0),
    precio_desde boolean DEFAULT false NOT NULL,
    unidad text,
    incluye_iva boolean DEFAULT false NOT NULL,
    ciclo_pago_defecto text DEFAULT 'UNICO'::text NOT NULL,
    firmas_incluidas integer DEFAULT 0 NOT NULL,
    campos_formulario jsonb,
    activo boolean DEFAULT true NOT NULL,
    CONSTRAINT servicios_ciclo_pago_defecto_check CHECK ((ciclo_pago_defecto = ANY (ARRAY['UNICO'::text, 'MENSUAL'::text, 'TRIMESTRAL'::text, 'SEMESTRAL'::text, 'ANUAL'::text]))),
    CONSTRAINT servicios_codigo_check CHECK ((codigo ~ '^[a-z0-9-]+$'::text)),
    CONSTRAINT servicios_firmas_incluidas_check CHECK ((firmas_incluidas >= 0)),
    CONSTRAINT servicios_precio_lista_check CHECK ((precio_lista >= (0)::numeric)),
    CONSTRAINT servicios_tipo_check CHECK ((tipo = ANY (ARRAY['PRINCIPAL'::text, 'COMPLEMENTARIO'::text])))
);


--
-- Name: servicios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.servicios ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.servicios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: solicitudes_titular; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitudes_titular (
    id integer NOT NULL,
    cliente_id integer,
    email public.citext NOT NULL,
    tipo text NOT NULL,
    detalle text,
    estado text DEFAULT 'recibida'::text NOT NULL,
    recibida_en timestamp with time zone DEFAULT now() NOT NULL,
    plazo_en date DEFAULT (CURRENT_DATE + 30) NOT NULL,
    respondida_en timestamp with time zone,
    respuesta text,
    atendida_por integer,
    CONSTRAINT solicitudes_titular_check CHECK (((estado <> ALL (ARRAY['respondida'::text, 'rechazada'::text])) OR ((respondida_en IS NOT NULL) AND (respuesta IS NOT NULL)))),
    CONSTRAINT solicitudes_titular_estado_check CHECK ((estado = ANY (ARRAY['recibida'::text, 'en_proceso'::text, 'respondida'::text, 'rechazada'::text]))),
    CONSTRAINT solicitudes_titular_tipo_check CHECK ((tipo = ANY (ARRAY['acceso'::text, 'rectificacion'::text, 'supresion'::text, 'oposicion'::text, 'portabilidad'::text, 'bloqueo'::text])))
);


--
-- Name: solicitudes_titular_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.solicitudes_titular ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.solicitudes_titular_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sucursales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sucursales (
    id integer NOT NULL,
    empresa_id integer NOT NULL,
    nombre text NOT NULL,
    direccion_id integer NOT NULL,
    rol_propiedad text NOT NULL,
    prefijo_folio text NOT NULL,
    propietario_id integer,
    unidad_sii text,
    activo boolean DEFAULT true NOT NULL,
    CONSTRAINT sucursales_prefijo_folio_check CHECK ((prefijo_folio ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT sucursales_rol_propiedad_check CHECK ((rol_propiedad ~ '^[0-9]+-[0-9]+$'::text))
);


--
-- Name: sucursales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sucursales ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sucursales_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ticket_mensajes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_mensajes (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    autor_tipo text NOT NULL,
    usuario_id integer,
    email public.citext,
    texto text NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ticket_mensajes_autor_tipo_check CHECK ((autor_tipo = ANY (ARRAY['cliente'::text, 'personal'::text, 'sistema'::text]))),
    CONSTRAINT ticket_mensajes_check CHECK (((autor_tipo <> 'personal'::text) OR (usuario_id IS NOT NULL))),
    CONSTRAINT ticket_mensajes_check1 CHECK (((autor_tipo <> 'cliente'::text) OR (email IS NOT NULL))),
    CONSTRAINT ticket_mensajes_texto_check CHECK (((length(texto) >= 1) AND (length(texto) <= 4000)))
);


--
-- Name: ticket_mensajes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ticket_mensajes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ticket_mensajes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id integer NOT NULL,
    cliente_id integer NOT NULL,
    documento_id integer,
    email public.citext,
    motivo text NOT NULL,
    detalle text NOT NULL,
    estado text DEFAULT 'abierto'::text NOT NULL,
    respuesta text,
    atendido_por integer,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_en timestamp with time zone,
    CONSTRAINT tickets_detalle_check CHECK (((length(detalle) >= 1) AND (length(detalle) <= 4000))),
    CONSTRAINT tickets_estado_check CHECK ((estado = ANY (ARRAY['abierto'::text, 'en_proceso'::text, 'resuelto'::text, 'cerrado'::text]))),
    CONSTRAINT tickets_motivo_check CHECK ((motivo = ANY (ARRAY['datos_incorrectos'::text, 'condiciones'::text, 'falta_informacion'::text, 'otro'::text])))
);


--
-- Name: tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tickets ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    nombre text NOT NULL,
    email public.citext NOT NULL,
    rol_id integer NOT NULL,
    password_hash text NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    totp_secreto text,
    totp_activo boolean DEFAULT false NOT NULL,
    intentos_fallidos integer DEFAULT 0 NOT NULL,
    bloqueado_hasta timestamp with time zone,
    ultimo_acceso timestamp with time zone,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usuarios_check CHECK (((NOT totp_activo) OR (totp_secreto IS NOT NULL))),
    CONSTRAINT usuarios_intentos_fallidos_check CHECK ((intentos_fallidos >= 0))
);


--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.usuarios ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usuarios_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: v_datos_contrato; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_datos_contrato WITH (security_invoker='true') AS
 SELECT k.id AS contrato_id,
    k.folio,
    k.lugar_celebracion,
    public.fn_fecha_larga(k.fecha_celebracion) AS fecha_celebracion,
    e.razon_social AS emisora_razon_social,
    public.fn_rut_formato(e.rut) AS emisora_rut,
    er.nombre_completo AS emisora_rep_nombre,
    public.fn_rut_formato(er.rut) AS emisora_rep_rut,
    er.nacionalidad AS emisora_rep_nacionalidad,
    er.estado_civil AS emisora_rep_estado_civil,
    er.profesion AS emisora_rep_profesion,
    public.fn_dir_calle(er.direccion_id) AS emisora_domicilio,
    public.fn_dir_comuna(er.direccion_id) AS emisora_comuna,
    public.fn_dir_region(er.direccion_id) AS emisora_region,
    e.telefono AS emisora_telefono,
    e.email AS emisora_email,
    public.fn_fecha_larga(e.personeria_fecha) AS emisora_personeria_fecha,
    e.personeria_fuente AS emisora_personeria_fuente,
    public.fn_dir_calle(su.direccion_id) AS sucursal_direccion,
    public.fn_dir_comuna(su.direccion_id) AS sucursal_comuna,
    public.fn_dir_region(su.direccion_id) AS sucursal_region,
    su.rol_propiedad,
    su.unidad_sii,
    cl.razon_social AS cliente_razon_social,
    public.fn_rut_formato(cl.rut) AS cliente_rut,
    cl.giro_principal AS cliente_giro,
    cl.email AS cliente_email,
    cl.celular AS cliente_celular,
    cr.nombre_completo AS cliente_rep_nombre,
    public.fn_rut_formato(cr.rut) AS cliente_rep_rut,
    public.fn_dir_calle(cr.direccion_id) AS cliente_rep_domicilio,
    public.fn_dir_comuna(cr.direccion_id) AS cliente_rep_comuna,
    public.fn_dir_region(cr.direccion_id) AS cliente_rep_region,
    public.fn_fecha_larga(cl.fecha_escritura) AS cliente_fecha_escritura,
    cl.sitio_notaria AS cliente_sitio_notaria,
    public.fn_fecha_larga(k.fecha_inicio) AS fecha_inicio,
    public.fn_fecha_larga(k.fecha_vencimiento) AS fecha_vencimiento,
    (('('::text || k.duracion_meses) ||
        CASE
            WHEN (k.duracion_meses = 1) THEN ' MES)'::text
            ELSE ' MESES)'::text
        END) AS duracion,
    ( SELECT string_agg(sv.nombre, '; '::text ORDER BY cs.orden) AS string_agg
           FROM (public.contrato_servicios cs
             JOIN public.servicios sv ON ((sv.id = cs.servicio_id)))
          WHERE (cs.contrato_id = k.id)) AS servicios,
        CASE
            WHEN (ca.id IS NOT NULL) THEN ((((((((('transferencia en la '::text || ca.tipo_cuenta) || ' Nº '::text) || ca.numero_cuenta) || ' del '::text) || ca.banco) || ', a nombre de su titular '::text) || ca.titular) || ', R.U.T. '::text) || public.fn_rut_formato(ca.rut_titular))
            ELSE k.link_pago
        END AS medio_pago,
    p.razon_social AS propietario_razon_social,
    public.fn_rut_formato(p.rut) AS propietario_rut,
    pr.nombre_completo AS propietario_rep_nombre,
    public.fn_rut_formato(pr.rut) AS propietario_rep_rut,
    pr.nacionalidad AS propietario_rep_nacionalidad,
    pr.estado_civil AS propietario_rep_estado_civil,
    pr.profesion AS propietario_rep_profesion,
    public.fn_dir_calle(p.direccion_id) AS propietario_domicilio,
    public.fn_dir_comuna(p.direccion_id) AS propietario_comuna,
    public.fn_dir_region(p.direccion_id) AS propietario_region,
    cl.tipo_persona AS cliente_tipo_persona,
    public.fn_dir_calle(COALESCE(cl.direccion_id, cr.direccion_id)) AS cliente_domicilio,
    public.fn_dir_comuna(COALESCE(cl.direccion_id, cr.direccion_id)) AS cliente_comuna,
    public.fn_dir_region(COALESCE(cl.direccion_id, cr.direccion_id)) AS cliente_region,
        CASE
            WHEN (cl.tipo_persona = 'natural'::text) THEN ((((cl.razon_social || ', cédula de identidad N° '::text) || public.fn_rut_formato(cl.rut)) || COALESCE((((', domiciliado en '::text || public.fn_dir_calle(COALESCE(cl.direccion_id, cr.direccion_id))) || ', comuna de '::text) || public.fn_dir_comuna(COALESCE(cl.direccion_id, cr.direccion_id))), ''::text)) || ', por sí'::text)
            ELSE ((((((((((cl.razon_social || ', R.U.T. '::text) || public.fn_rut_formato(cl.rut)) || ', representada por '::text) || cr.nombre_completo) || COALESCE((', '::text || cr.nacionalidad), ''::text)) || COALESCE((', '::text || cr.estado_civil), ''::text)) || COALESCE((', '::text || cr.profesion), ''::text)) || ', cédula de identidad N° '::text) || public.fn_rut_formato(cr.rut)) || COALESCE((((', ambos domiciliados en '::text || public.fn_dir_calle(COALESCE(cl.direccion_id, cr.direccion_id))) || ', comuna de '::text) || public.fn_dir_comuna(COALESCE(cl.direccion_id, cr.direccion_id))), ''::text))
        END AS cliente_comparecencia,
    k.contrato_anterior_id
   FROM ((((((((public.contratos k
     JOIN public.empresas_emisoras e ON ((e.id = k.empresa_id)))
     JOIN public.sucursales su ON ((su.id = k.sucursal_id)))
     JOIN public.clientes cl ON ((cl.id = k.cliente_id)))
     LEFT JOIN public.representantes_legales er ON ((er.id = e.representante_legal_id)))
     LEFT JOIN public.representantes_legales cr ON ((cr.id = cl.representante_legal_id)))
     LEFT JOIN public.cuentas_recaudacion ca ON ((ca.id = k.cuenta_recaudacion_id)))
     LEFT JOIN public.propietarios_inmueble p ON ((p.id = su.propietario_id)))
     LEFT JOIN public.representantes_legales pr ON ((pr.id = p.representante_legal_id)));


--
-- Name: v_datos_contrato_servicios; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_datos_contrato_servicios WITH (security_invoker='true') AS
 SELECT k.id AS contrato_id,
    k.folio,
    cs.orden,
    sv.nombre AS servicio,
    cs.precio,
    cs.ciclo_pago AS ciclo,
    cs.descripcion AS contenido
   FROM ((public.contratos k
     JOIN public.contrato_servicios cs ON ((cs.contrato_id = k.id)))
     JOIN public.servicios sv ON ((sv.id = cs.servicio_id)));


--
-- Name: v_estado_renovacion; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_estado_renovacion WITH (security_invoker='true') AS
 SELECT k.id AS contrato_id,
    k.folio,
    k.cliente_id,
    k.fecha_vencimiento,
    (k.fecha_vencimiento - CURRENT_DATE) AS dias_para_vencer,
    r.id AS renovado_por_id,
    r.folio AS renovado_por_folio,
    ((k.fecha_vencimiento < CURRENT_DATE) AND (r.id IS NULL) AND (k.estado = ANY (ARRAY['activo'::text, 'vencido'::text]))) AS vencido_sin_renovar
   FROM (public.contratos k
     LEFT JOIN public.contratos r ON (((r.contrato_anterior_id = k.id) AND (r.estado <> 'cancelado'::text))));


--
-- Name: v_saldo_contrato; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_saldo_contrato WITH (security_invoker='true') AS
 SELECT k.id AS contrato_id,
    k.folio,
    k.fecha_vencimiento,
    k.estado,
    COALESCE(sv.total, (0)::numeric) AS total_servicios,
    COALESCE(pg.pagado, (0)::numeric) AS pagado,
    (COALESCE(sv.total, (0)::numeric) - COALESCE(pg.pagado, (0)::numeric)) AS saldo
   FROM ((public.contratos k
     LEFT JOIN ( SELECT contrato_servicios.contrato_id,
            sum(contrato_servicios.precio) AS total
           FROM public.contrato_servicios
          GROUP BY contrato_servicios.contrato_id) sv ON ((sv.contrato_id = k.id)))
     LEFT JOIN ( SELECT pagos.contrato_id,
            sum(pagos.monto) AS pagado
           FROM public.pagos
          WHERE ((pagos.estado = 'pagado'::text) AND (pagos.contrato_id IS NOT NULL))
          GROUP BY pagos.contrato_id) pg ON ((pg.contrato_id = k.id)));


--
-- Name: v_saldo_firmas; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_saldo_firmas WITH (security_invoker='true') AS
 WITH vigentes AS (
         SELECT movimientos_firmas.cliente_id,
            (sum(movimientos_firmas.cantidad))::integer AS compradas,
            min(movimientos_firmas.creado_en) AS desde,
            min(movimientos_firmas.vence_en) AS proximo_vencimiento
           FROM public.movimientos_firmas
          WHERE ((movimientos_firmas.motivo = 'compra'::text) AND (movimientos_firmas.vence_en >= CURRENT_DATE))
          GROUP BY movimientos_firmas.cliente_id
        ), usados AS (
         SELECT m.cliente_id,
            ((- sum(m.cantidad)))::integer AS consumidas
           FROM (public.movimientos_firmas m
             JOIN vigentes v_1 ON ((v_1.cliente_id = m.cliente_id)))
          WHERE ((m.motivo = ANY (ARRAY['consumo'::text, 'ajuste'::text])) AND (m.creado_en >= v_1.desde))
          GROUP BY m.cliente_id
        )
 SELECT v.cliente_id,
    v.compradas,
    COALESCE(u.consumidas, 0) AS consumidas,
    GREATEST((v.compradas - COALESCE(u.consumidas, 0)), 0) AS disponibles,
    v.proximo_vencimiento
   FROM (vigentes v
     LEFT JOIN usados u ON ((u.cliente_id = v.cliente_id)));


--
-- Data for Name: alertas; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.alertas OVERRIDING SYSTEM VALUE VALUES
	(1, 1, '2026-11-14', 60, false, NULL, NULL),
	(2, 1, '2026-12-14', 30, false, NULL, NULL),
	(3, 1, '2026-12-29', 15, false, NULL, NULL),
	(4, 1, '2027-01-06', 7, false, NULL, NULL),
	(5, 2, '2026-11-15', 60, false, NULL, NULL),
	(6, 2, '2026-12-15', 30, false, NULL, NULL),
	(7, 2, '2026-12-30', 15, false, NULL, NULL),
	(8, 2, '2027-01-07', 7, false, NULL, NULL),
	(9, 3, '2027-08-02', 60, false, NULL, NULL),
	(10, 3, '2027-09-01', 30, false, NULL, NULL),
	(11, 3, '2027-09-16', 15, false, NULL, NULL),
	(12, 3, '2027-09-24', 7, false, NULL, NULL),
	(13, 4, '2027-07-26', 60, false, NULL, NULL),
	(14, 4, '2027-08-25', 30, false, NULL, NULL),
	(15, 4, '2027-09-09', 15, false, NULL, NULL),
	(16, 4, '2027-09-17', 7, false, NULL, NULL),
	(17, 5, '2027-06-01', 60, false, NULL, NULL),
	(18, 5, '2027-07-01', 30, false, NULL, NULL),
	(19, 5, '2027-07-16', 15, false, NULL, NULL),
	(20, 5, '2027-07-24', 7, false, NULL, NULL),
	(21, 6, '2027-02-28', 60, false, NULL, NULL),
	(22, 6, '2027-03-30', 30, false, NULL, NULL),
	(23, 6, '2027-04-14', 15, false, NULL, NULL),
	(24, 6, '2027-04-22', 7, false, NULL, NULL),
	(29, 8, '2027-08-30', 60, false, NULL, NULL),
	(30, 8, '2027-09-29', 30, false, NULL, NULL),
	(31, 8, '2027-10-14', 15, false, NULL, NULL),
	(32, 8, '2027-10-22', 7, false, NULL, NULL),
	(25, 7, '2027-08-30', 60, true, 'manual', '2026-11-03 16:06:07.326091-03'),
	(26, 7, '2027-09-29', 30, true, 'manual', '2026-11-03 16:06:08.913462-03'),
	(27, 7, '2027-10-14', 15, true, 'manual', '2026-11-03 16:06:10.120946-03'),
	(28, 7, '2027-10-22', 7, true, 'manual', '2026-11-03 16:06:11.165346-03'),
	(33, 9, '2027-09-03', 60, false, NULL, NULL),
	(34, 9, '2027-10-03', 30, false, NULL, NULL),
	(35, 9, '2027-10-18', 15, false, NULL, NULL),
	(36, 9, '2027-10-26', 7, false, NULL, NULL),
	(37, 10, '2027-09-03', 60, false, NULL, NULL),
	(38, 10, '2027-10-03', 30, false, NULL, NULL),
	(39, 10, '2027-10-18', 15, false, NULL, NULL),
	(40, 10, '2027-10-26', 7, false, NULL, NULL);


--
-- Data for Name: carros; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: clausulas_documento; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.clausulas_documento OVERRIDING SYSTEM VALUE VALUES
	(1, 'ACUERDO_ACCIONISTAS', 'ELIMINAR_REPRESENTANTE', 'Eliminar representante legal', 'Se elimina a don {saliente_nombre}, como representante legal y gerente. En su reemplazo asume como gerente don {entrante_nombre}, cédula nacional de identidad número {entrante_rut}, también como representante legal ante el Servicio de Impuestos Internos.', '["saliente_nombre", "entrante_nombre", "entrante_rut"]', true),
	(2, 'ACUERDO_ACCIONISTAS', 'CAMBIO_RAZON_SOCIAL', 'Cambio de razón social', 'Se elimina la razón social antigua de {razon_social_antigua} y se agrega la nueva razón social de la empresa: {razon_social_nueva}.', '["razon_social_antigua", "razon_social_nueva"]', true),
	(3, 'ACUERDO_ACCIONISTAS', 'CAMBIO_NOMBRE_FANTASIA', 'Cambio de nombre de fantasía', 'Se elimina el nombre de fantasía antiguo de {nombre_antiguo} y se agrega el nuevo nombre de fantasía de la empresa: {nombre_nuevo}.', '["nombre_antiguo", "nombre_nuevo"]', true),
	(4, 'ACUERDO_ACCIONISTAS', 'ELIMINAR_ACCIONISTA', 'Eliminar accionista', 'Se elimina a don {accionista_nombre}, cédula nacional de identidad número {accionista_rut}, como accionista de la sociedad.', '["accionista_nombre", "accionista_rut"]', true),
	(5, 'ACUERDO_ACCIONISTAS', 'AJUSTAR_CAPITAL', 'Ajustar capital', 'Se modifica el capital de la sociedad, que pasa de {capital_anterior} a {capital_nuevo} pesos, dividido en {acciones} acciones ordinarias de la serie única.', '["capital_anterior", "capital_nuevo", "acciones"]', true),
	(6, 'ACUERDO_ACCIONISTAS', 'FACULTAR_GESTION', 'Facultar para realizar los trámites', 'Los accionistas facultan a don {apoderado_nombre}, cédula nacional de identidad número {apoderado_rut}, para que efectúe las modificaciones y suscripciones ante el Registro de Empresas y Sociedades del presente acto.', '["apoderado_nombre", "apoderado_rut"]', true);


--
-- Data for Name: clientes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.clientes OVERRIDING SYSTEM VALUE VALUES
	(1, '77496835-0', 'juridica', 'JM IMPORT SpA', NULL, 'VENTA X INTERNET', 'jrmj1592@gmail.com', '949836363', NULL, 1, '2021-12-16', 'www.registrodeempresasysociedades.cl', 'crm', false, NULL, 1, '2026-10-27 11:35:30.449926-03'),
	(2, '78332529-2', 'juridica', 'Sx4x4 SpA', NULL, 'MECÁNICA A DOMICILIO', 'soissaextreme@gmail.com', '991882417', NULL, 2, '2026-01-12', 'www.tuempresaenundia.cl', 'crm', false, NULL, 1, '2026-10-27 11:35:30.449926-03'),
	(3, '78526673-0', 'juridica', 'ALTUS AND COMPANY CO. SPA', NULL, 'COMERCIALIZADORA', 'contacto@altusandcompany.cl', '932365169', NULL, 3, '2026-10-02', 'www.tuempresaenundia.cl', 'crm', false, NULL, 1, '2026-10-27 11:35:30.449926-03'),
	(4, '78007592-9', 'juridica', 'SOLDADURAS IRON SOLDERING MATIAS JIMENEZ LEAL E.I.R.L.', NULL, 'SERVICIOS DE SOLDADURA', 'aironsoldiering@gmail.com', '957482381', NULL, 4, NULL, NULL, 'crm', false, NULL, 1, '2026-10-27 11:35:30.449926-03'),
	(5, '16543210-K', 'natural', 'CAMILA ANDREA ROJAS PEREZ', NULL, 'ASESORÍAS DE DISEÑO', 'camila.rojas@ejemplo.test', '987654321', 7, NULL, NULL, NULL, 'crm', false, NULL, 1, '2026-10-27 11:35:30.449926-03'),
	(6, '21167684-1', 'natural', 'Roger Rosas', NULL, NULL, 'roger.andres.r@gmail.com', '973421628', 9, NULL, NULL, NULL, 'web', false, NULL, NULL, '2026-10-30 02:06:43.628927-03');


--
-- Data for Name: comunas; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.comunas OVERRIDING SYSTEM VALUE VALUES
	(1, 'Santiago', 7),
	(2, 'Cerrillos', 7),
	(3, 'Cerro Navia', 7),
	(4, 'Conchalí', 7),
	(5, 'El Bosque', 7),
	(6, 'Estación Central', 7),
	(7, 'Huechuraba', 7),
	(8, 'Independencia', 7),
	(9, 'La Cisterna', 7),
	(10, 'La Florida', 7),
	(11, 'La Granja', 7),
	(12, 'La Pintana', 7),
	(13, 'La Reina', 7),
	(14, 'Las Condes', 7),
	(15, 'Lo Barnechea', 7),
	(16, 'Lo Espejo', 7),
	(17, 'Lo Prado', 7),
	(18, 'Macul', 7),
	(19, 'Maipú', 7),
	(20, 'Ñuñoa', 7),
	(21, 'Pedro Aguirre Cerda', 7),
	(22, 'Peñalolén', 7),
	(23, 'Providencia', 7),
	(24, 'Pudahuel', 7),
	(25, 'Quilicura', 7),
	(26, 'Quinta Normal', 7),
	(27, 'Recoleta', 7),
	(28, 'Renca', 7),
	(29, 'San Joaquín', 7),
	(30, 'San Miguel', 7),
	(31, 'San Ramón', 7),
	(32, 'Vitacura', 7),
	(33, 'Puente Alto', 7),
	(34, 'Pirque', 7),
	(35, 'San José de Maipo', 7),
	(36, 'Colina', 7),
	(37, 'Lampa', 7),
	(38, 'Tiltil', 7),
	(39, 'San Bernardo', 7),
	(40, 'Buin', 7),
	(41, 'Calera de Tango', 7),
	(42, 'Paine', 7),
	(43, 'Melipilla', 7),
	(44, 'Alhué', 7),
	(45, 'Curacaví', 7),
	(46, 'María Pinto', 7),
	(47, 'San Pedro', 7),
	(48, 'Talagante', 7),
	(49, 'El Monte', 7),
	(50, 'Isla de Maipo', 7),
	(51, 'Padre Hurtado', 7),
	(52, 'Peñaflor', 7),
	(53, 'Valparaíso', 6),
	(54, 'Casablanca', 6),
	(55, 'Concón', 6),
	(56, 'Juan Fernández', 6),
	(57, 'Puchuncaví', 6),
	(58, 'Quintero', 6),
	(59, 'Viña del Mar', 6),
	(60, 'Isla de Pascua', 6),
	(61, 'Los Andes', 6),
	(62, 'Calle Larga', 6),
	(63, 'Rinconada', 6),
	(64, 'San Esteban', 6),
	(65, 'La Ligua', 6),
	(66, 'Cabildo', 6),
	(67, 'Papudo', 6),
	(68, 'Petorca', 6),
	(69, 'Zapallar', 6),
	(70, 'Quillota', 6),
	(71, 'La Calera', 6),
	(72, 'Hijuelas', 6),
	(73, 'La Cruz', 6),
	(74, 'Nogales', 6),
	(75, 'San Antonio', 6),
	(76, 'Algarrobo', 6),
	(77, 'Cartagena', 6),
	(78, 'El Quisco', 6),
	(79, 'El Tabo', 6),
	(80, 'Santo Domingo', 6),
	(81, 'San Felipe', 6),
	(82, 'Catemu', 6),
	(83, 'Llaillay', 6),
	(84, 'Panquehue', 6),
	(85, 'Putaendo', 6),
	(86, 'Santa María', 6),
	(87, 'Quilpué', 6),
	(88, 'Limache', 6),
	(89, 'Olmué', 6),
	(90, 'Villa Alemana', 6);


--
-- Data for Name: config_alertas; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.config_alertas VALUES
	(60, true),
	(30, true),
	(15, true),
	(7, true);


--
-- Data for Name: contrato_servicios; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.contrato_servicios OVERRIDING SYSTEM VALUE VALUES
	(1, 4, 1, 1, 59990, 'ANUAL', 'Domicilio. Tributario, postal y comercial
Recepción de correspondencia fiscal
Escaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo
Uso 1 hora semanal de estación de trabajo
Inicio de actividades'),
	(2, 3, 2, 1, 59990, 'ANUAL', 'Domicilio. Tributario, postal y comercial
Recepción de correspondencia fiscal
Escaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo
Uso 1 hora semanal de estación de trabajo
Inicio de actividades'),
	(3, 2, 1, 1, 59990, 'ANUAL', 'Domicilio. Tributario, postal y comercial
Recepción de correspondencia fiscal
Escaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo
Uso 1 hora semanal de estación de trabajo
Inicio de actividades'),
	(4, 1, 1, 1, 59990, 'ANUAL', 'Domicilio. Tributario, postal y comercial
Recepción de correspondencia fiscal
Escaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo
Uso 1 hora semanal de estación de trabajo
Inicio de actividades'),
	(5, 4, 2, 2, 59990, 'ANUAL', 'Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.'),
	(6, 1, 2, 2, 71388, 'ANUAL', 'Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.'),
	(7, 3, 1, 3, 49990, 'UNICO', 'Constitución empresa en un día, hasta 3 socios
Obtención de rut
Domicilio tributario x 3 meses
Inicio de actividad ante el SII
Inscripción factura electrónica
Gestión conjunta solicitud cuenta emprendedor BancoEstado'),
	(8, 2, 2, 3, 49990, 'UNICO', 'Constitución empresa en un día, hasta 3 socios
Obtención de rut
Domicilio tributario x 3 meses
Inicio de actividad ante el SII
Inscripción factura electrónica
Gestión conjunta solicitud cuenta emprendedor BancoEstado'),
	(9, 3, 3, 4, 14990, 'ANUAL', 'Servicio web mail corporativo 1 GB + dominio x 1 año'),
	(10, 5, 1, 1, 59990, 'ANUAL', 'Domicilio. Tributario, postal y comercial
Recepción de correspondencia fiscal
Escaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo
Uso 1 hora semanal de estación de trabajo
Inicio de actividades'),
	(11, 6, 1, 18, 39990, 'SEMESTRAL', 'Domicilio tributario, postal y comercial x 6 meses
Recepción de correspondencia y oficina de partes
Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)
Inicio de actividad ante el S.I.I.
Firma avanzada del contrato $5.000'),
	(12, 7, 1, 2, 59990, 'ANUAL', 'Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.'),
	(13, 8, 1, 19, 49990, 'ANUAL', '50 firmas electrónicas avanzadas
Vigencia 12 meses
Recordatorio antes de vencer
Mejor precio por firma'),
	(14, 9, 1, 1, 59990, 'ANUAL', 'Domicilio. Tributario, postal y comercial
Recepción de correspondencia fiscal
Escaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo
Uso 1 hora semanal de estación de trabajo
Inicio de actividades'),
	(15, 10, 1, 20, 3490, 'UNICO', '1 firma electrónica avanzada
Validez legal Ley 19.799
Firma desde cualquier dispositivo
Sin ir a notaría');


--
-- Data for Name: contratos; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.contratos OVERRIDING SYSTEM VALUE VALUES
	(1, 'LF-01-2026', 1, 1, 1, 1, NULL, 'Santiago', '2026-01-15', '2026-01-15', 12, '2027-01-13', true, 'activo', NULL, 'crm', 1, NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(2, 'LF-02-2026', 1, 2, 1, 1, NULL, 'Santiago', '2026-01-15', '2026-01-15', 12, '2027-01-14', true, 'activo', NULL, 'crm', 1, NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(3, 'LF-0152-2026', 1, 3, 1, 1, NULL, 'Santiago', '2026-10-02', '2026-10-02', 12, '2027-10-01', true, 'activo', NULL, 'crm', 1, NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(4, 'LF-0150-2026', 1, 4, 1, 1, NULL, 'Santiago', '2026-09-25', '2026-09-25', 12, '2027-09-24', true, 'activo', NULL, 'crm', 1, NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(5, 'LF-0153-2026', 1, 5, 1, 1, NULL, 'Santiago', '2026-08-01', '2026-08-01', 12, '2027-07-31', true, 'activo', NULL, 'crm', 1, NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(8, 'LF-0156-2026', 1, 6, 1, 1, NULL, 'Santiago', '2026-10-30', '2026-10-30', 12, '2027-10-29', true, 'activo', NULL, 'web', 3, NULL, '{"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-50", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}', '2026-10-30 15:05:15.648079-03'),
	(7, 'LF-0155-2026', 1, 6, 1, 1, NULL, 'Santiago', '2026-10-30', '2026-10-30', 12, '2027-10-29', true, 'activo', NULL, 'web', 3, NULL, '{"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-bod", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}', '2026-10-30 02:59:08.720934-03'),
	(6, 'LF-0154-2026', 1, 6, 1, 1, NULL, 'Santiago', '2026-10-30', '2026-10-30', 6, '2027-04-29', true, 'activo', NULL, 'web', 3, NULL, '{"tienda": {"pago": {"modo": "total", "medio": "mp"}, "plan": "dom-sem", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}', '2026-10-30 02:06:43.628927-03'),
	(9, 'LF-0157-2026', 1, 6, 1, 1, NULL, 'Santiago', '2026-11-03', '2026-11-03', 12, '2027-11-02', true, 'activo', NULL, 'web', 3, NULL, '{"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-anual", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "entrega": {"cuenta": "con_clave", "documentos": [{"tipo": "CONTRATO DE SERVICIOS OFICINA", "publicado": false}]}, "respuestas": {}}', '2026-11-03 18:09:43.703419-03'),
	(10, 'LF-0158-2026', 1, 6, 1, 1, NULL, 'Santiago', '2026-11-03', '2026-11-03', 12, '2027-11-02', true, 'activo', NULL, 'web', 3, NULL, '{"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-1", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "entrega": {"cuenta": "con_clave", "documentos": []}, "respuestas": {}}', '2026-11-03 18:13:14.306928-03');


--
-- Data for Name: correspondencia; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: cuentas_portal; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.cuentas_portal OVERRIDING SYSTEM VALUE VALUES
	(1, 6, 'roger.andres.r@gmail.com', NULL, false, '$2b$12$OEGYPIgR1DFxhi97j5Wz9.kafRkJ4e14Opj2xBaskyOeA.o707AcW', true, '2026-10-30 02:18:27.327429-03', '2026-11-03 18:08:28.892217-03', NULL, '2026-10-30 02:18:27.327429-03');


--
-- Data for Name: cuentas_recaudacion; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.cuentas_recaudacion OVERRIDING SYSTEM VALUE VALUES
	(1, 1, 'Banco Estado', 'Cuenta Corriente / Chequera Electrónica', '25770158951', 'EASY OFFICE SpA', '76767272-1', true),
	(2, 2, 'Banco Mercado Pago', 'Cuenta Vista', '1159226880', 'EASY OFFICE SpA', '76767272-1', true);


--
-- Data for Name: direcciones; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.direcciones OVERRIDING SYSTEM VALUE VALUES
	(1, 'Vicuña Mackenna Poniente', '7255', 'Oficina 707', 10),
	(2, 'Avenida General Oscar Bonilla', '5933', 'Depto 102', 17),
	(3, 'Los Guindos', '5970', NULL, 22),
	(4, 'Panamericana Norte', '213', NULL, 38),
	(5, 'Las Acacias', '2200', NULL, 39),
	(6, 'Blanco', '1215', 'Oficina 405', 53),
	(7, 'Los Aromos', '1450', 'Depto 31', 59),
	(8, 'El Potrerillo', '8', 'Oficina C', 76),
	(9, 'el fogonero', '311', NULL, 40);


--
-- Data for Name: documento_clausulas; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: documento_firmantes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.documento_firmantes OVERRIDING SYSTEM VALUE VALUES
	(1, 3, 1, 'Roger Rosas', '21167684-1', 'roger.andres.r@gmail.com', 'pendiente', 'SIM-3-FA9106-F1', NULL, NULL, NULL, '2026-11-03 16:10:12.142287-03'),
	(2, 5, 1, 'Roger Rosas', '21167684-1', 'roger.andres.r@gmail.com', 'pendiente', 'SIM-5-155FB7-F1', NULL, NULL, NULL, '2026-11-03 18:16:24.536671-03');


--
-- Data for Name: documento_partes; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: documento_versiones; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.documento_versiones OVERRIDING SYSTEM VALUE VALUES
	(1, 3, 1, 'generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx', '59ca809677b286f44b467d9beaa1a69997115cf7e8347a21ba1e39e0e20f289f', NULL, '2026-10-30 02:06:43.628927-03'),
	(2, 4, 1, 'generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx', 'aa88f02cef0646f4fd42f57aad8408d8cb7a0e32e428dc0253c05120d675cd44', NULL, '2026-10-30 02:59:08.720934-03'),
	(3, 5, 1, 'generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx', 'ba9de79ab2728422adf82735a996f5689de5529f7464309b678a72072face261', NULL, '2026-11-03 18:09:48.775735-03');


--
-- Data for Name: documentos; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.documentos OVERRIDING SYSTEM VALUE VALUES
	(1, 3, 3, NULL, 1, 'CONTRATO DE SERVICIOS OFICINA', 'Santiago', '2026-10-02', NULL, 'borrador', false, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, '2026-10-27 11:35:30.449926-03', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	(2, 4, 4, NULL, 2, 'CONTRATO DE SERVICIOS BODEGA', 'Santiago', '2026-09-25', NULL, 'borrador', false, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, '2026-10-27 11:35:30.449926-03', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	(5, 6, 9, NULL, 1, 'CONTRATO DE SERVICIOS OFICINA', 'Santiago', NULL, '{"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}', 'enviado_firma', false, 2, '2026-11-03 18:16:04.493632-03', NULL, 3, 'generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx', 'SIM-5-155FB7', NULL, NULL, '2026-11-03 18:09:48.775735-03', 'aceptado', '2026-11-03 18:16:04.493632-03', '2026-11-03 18:16:24.506119-03', 'roger.andres.r@gmail.com', '::1', 1, 'simulador', '2026-11-03 18:16:24.536671-03', NULL, NULL),
	(4, 6, 7, NULL, 2, 'CONTRATO DE SERVICIOS BODEGA', 'Santiago', NULL, '{"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}', 'firmado', false, NULL, NULL, NULL, 3, 'generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx', NULL, '2026-11-03 16:09:55.309744-03', 'EO-35CC-EC69', '2026-10-30 02:59:08.720934-03', 'aceptado', '2026-10-30 02:59:08.720934-03', '2026-10-30 02:59:46.403165-03', 'roger.andres.r@gmail.com', '::1', 1, NULL, NULL, NULL, NULL),
	(3, 6, 6, NULL, 1, 'CONTRATO DE SERVICIOS OFICINA', 'Santiago', NULL, '{"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}', 'firmado', false, 2, '2026-10-30 02:53:24.958685-03', NULL, 3, 'generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx', 'SIM-3-FA9106', '2026-11-03 16:10:16.355172-03', 'EO-4F39-0438', '2026-10-30 02:06:43.628927-03', 'aceptado', '2026-10-30 02:53:24.958685-03', '2026-10-30 02:55:13.481904-03', 'roger.andres.r@gmail.com', '::1', 1, 'simulador', '2026-11-03 16:10:12.142287-03', NULL, NULL);


--
-- Data for Name: ejecuciones_avisos; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ejecuciones_avisos OVERRIDING SYSTEM VALUE VALUES
	(1, 'automatico', NULL, '2026-11-02 18:41:23.799-03', '2026-11-02 18:41:23.813906-03', 0, 0, 0, 0, '[]'),
	(2, 'automatico', NULL, '2026-11-03 15:53:42.588-03', '2026-11-03 15:53:42.6163-03', 0, 0, 0, 0, '[]');


--
-- Data for Name: empresas_emisoras; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.empresas_emisoras OVERRIDING SYSTEM VALUE VALUES
	(1, 'EASY OFFICE', 'EASY OFFICE SpA', '76767272-1', 5, '2017-08-10', 'Registro de Empresas y Sociedades, Ley Nº 20.659', '+56 2 22777781', NULL, true),
	(2, 'INOFFICE', 'EASY OFFICE SpA', '76767272-1', 5, '2017-08-10', 'Registro de Empresas y Sociedades, Ley Nº 20.659', '+56 2 22777781', NULL, true);


--
-- Data for Name: folios_correlativos; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.folios_correlativos VALUES
	(2026, 158);


--
-- Data for Name: gestiones; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: movimientos_firmas; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: pagos; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.pagos OVERRIDING SYSTEM VALUE VALUES
	(1, 3, NULL, 62485, 'pagado', 'transbank', '2026-10-02 10:31:00-03', 1, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	(3, 5, NULL, 59990, 'pagado', 'transferencia', '2026-08-01 12:00:00-04', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	(2, 3, NULL, 62485, 'pagado', 'transbank', '2026-11-03 16:08:55.544998-03', 2, 2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	(4, 6, NULL, 39990, 'pagado', 'mercado_pago', '2026-11-03 16:09:01.012306-03', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	(5, 7, NULL, 59990, 'pagado', 'transbank', '2026-11-03 16:09:07.685949-03', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	(6, 8, NULL, 49990, 'pagado', 'transbank', '2026-11-03 16:09:15.848743-03', 1, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
	(8, 9, NULL, 59990, 'pagado', 'transbank', '2026-11-03 18:09:48.767266-03', 1, 1, 'SIM-8-576DAF35FAA5', '479051', '6623', '{"id": "SIM-8-576DAF35FAA5", "fecha": "2026-11-03T21:09:48.769Z", "estado": "AUTHORIZED", "simulador": true, "ultimos_4": "6623", "codigo_autorizacion": "479051"}', '2026-11-03 18:09:48.767266-03', NULL, NULL, NULL),
	(9, 10, NULL, 3490, 'pagado', 'transbank', '2026-11-03 18:13:16.595287-03', 1, 1, 'SIM-9-F68AAFFE4603', '891599', '6623', '{"id": "SIM-9-F68AAFFE4603", "fecha": "2026-11-03T21:13:16.597Z", "estado": "AUTHORIZED", "simulador": true, "ultimos_4": "6623", "codigo_autorizacion": "891599"}', '2026-11-03 18:13:16.595287-03', NULL, NULL, NULL);


--
-- Data for Name: permisos; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.permisos OVERRIDING SYSTEM VALUE VALUES
	(1, 'ver_auditoria'),
	(2, 'eliminar_registros'),
	(3, 'administrar_usuarios'),
	(4, 'administrar_catalogos'),
	(5, 'aprobar_documentos'),
	(6, 'registrar_pagos'),
	(7, 'gestionar_renovaciones'),
	(8, 'registrar_correspondencia'),
	(9, 'ver_reportes');


--
-- Data for Name: plantilla_planes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.plantilla_planes VALUES
	(1, 'dom-sem'),
	(1, 'dom-anual'),
	(2, 'dom-bod');


--
-- Data for Name: plantillas_documento; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.plantillas_documento OVERRIDING SYSTEM VALUE VALUES
	(1, 'CONTRATO DE SERVICIOS OFICINA', 1, 'CONTRATO_SERVICIO', 'CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx', NULL, '[{"tipo": "texto", "clave": "folio", "origen": "contratos.folio"}, {"tipo": "vista", "clave": "datos", "origen": "v_datos_contrato"}, {"tipo": "vista", "clave": "servicios", "origen": "v_datos_contrato_servicios"}]', false, true, 'revision', NULL),
	(3, 'PODER SIMPLE', 1, 'PODER', NULL, NULL, '[{"tipo": "fecha", "clave": "fecha", "etiqueta": "Fecha"}, {"tipo": "cliente", "clave": "empresa", "etiqueta": "Datos de la empresa"}, {"tipo": "parte", "clave": "representante", "etiqueta": "Representante / apoderado"}]', true, true, 'revision', NULL),
	(4, 'ACUERDO DE ACCIONISTAS', 1, 'ACUERDO_ACCIONISTAS', 'TE1D - ACUERDO DE ACCIONISTAS PARA SPA (1).docx', NULL, '[{"tipo": "texto", "clave": "sociedad", "etiqueta": "Sociedad"}, {"tipo": "texto", "clave": "lugar", "etiqueta": "Ciudad"}, {"tipo": "fecha", "clave": "fecha", "etiqueta": "Fecha"}, {"tipo": "entero", "clave": "total_acciones", "etiqueta": "Total de acciones"}, {"tipo": "monto", "clave": "capital", "etiqueta": "Capital (CLP)"}]', true, true, 'revision', NULL),
	(5, 'CONTRATO DE ARRIENDO DE ESTACIONAMIENTO', 1, 'ARRIENDO', 'CONTRATO DE ARRIENDO ESTACIONAMIENTO (1).docx', NULL, '[{"tipo": "fecha", "clave": "fecha"}, {"tipo": "texto", "clave": "depto_numero"}, {"tipo": "texto", "clave": "fojas"}, {"tipo": "texto", "clave": "inscripcion_numero"}, {"tipo": "texto", "clave": "conservador"}, {"tipo": "entero", "clave": "anio_inscripcion"}, {"tipo": "texto", "clave": "estacionamiento_numero"}, {"tipo": "texto", "clave": "piso"}, {"tipo": "monto", "clave": "renta"}, {"tipo": "texto", "clave": "banco"}, {"tipo": "texto", "clave": "tipo_cuenta"}, {"tipo": "texto", "clave": "numero_cuenta"}, {"tipo": "email", "clave": "email_aviso_pago"}, {"tipo": "entero", "clave": "vigencia_meses"}, {"tipo": "fecha", "clave": "fecha_inicio"}, {"tipo": "entero", "clave": "renovacion_meses"}]', false, true, 'revision', NULL),
	(6, 'CONTRATO DE ARRIENDO DE VEHÍCULO', 1, 'ARRIENDO', 'CONTRATO DE ARRIENDO VEHICULO (1).docx', NULL, '[{"tipo": "texto", "clave": "comuna"}, {"tipo": "fecha", "clave": "fecha"}, {"tipo": "texto", "clave": "marca"}, {"tipo": "texto", "clave": "modelo"}, {"tipo": "entero", "clave": "anio"}, {"tipo": "texto", "clave": "patente"}, {"tipo": "texto", "clave": "color"}, {"tipo": "texto", "clave": "vin"}, {"tipo": "texto", "clave": "plazo"}, {"tipo": "fecha", "clave": "fecha_inicio"}, {"tipo": "fecha", "clave": "fecha_termino"}, {"tipo": "monto", "clave": "renta_mensual"}, {"tipo": "texto", "clave": "renta_en_palabras"}, {"tipo": "entero", "clave": "dias_pago"}, {"tipo": "texto", "clave": "medio_pago"}]', false, true, 'revision', NULL),
	(2, 'CONTRATO DE SERVICIOS BODEGA', 1, 'CONTRATO_SERVICIO', 'CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx', NULL, '[{"tipo": "texto", "clave": "folio", "origen": "contratos.folio"}, {"tipo": "vista", "clave": "datos", "origen": "v_datos_contrato"}, {"tipo": "vista", "clave": "servicios", "origen": "v_datos_contrato_servicios"}]', false, true, 'automatica', NULL);


--
-- Data for Name: propietarios_inmueble; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.propietarios_inmueble OVERRIDING SYSTEM VALUE VALUES
	(1, '76431160-4', 'MARCO ANTONIO ESCOBAR DONOSO SERVICIOS RETAIL E.I.R.L', 5, 6);


--
-- Data for Name: prospectos; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: regiones; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.regiones OVERRIDING SYSTEM VALUE VALUES
	(1, 'Región de Arica y Parinacota'),
	(2, 'Región de Tarapacá'),
	(3, 'Región de Antofagasta'),
	(4, 'Región de Atacama'),
	(5, 'Región de Coquimbo'),
	(6, 'Región de Valparaíso'),
	(7, 'Región Metropolitana'),
	(8, 'Región del Libertador General Bernardo O''Higgins'),
	(9, 'Región del Maule'),
	(10, 'Región de Ñuble'),
	(11, 'Región del Biobío'),
	(12, 'Región de La Araucanía'),
	(13, 'Región de Los Ríos'),
	(14, 'Región de Los Lagos'),
	(15, 'Región de Aysén del General Carlos Ibáñez del Campo'),
	(16, 'Región de Magallanes y de la Antártica Chilena');


--
-- Data for Name: registros_actividad; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.registros_actividad OVERRIDING SYSTEM VALUE VALUES
	(1, NULL, NULL, 'roles', '1', 'INSERT', NULL, NULL, '{"id": 1, "rol": "dueno"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(2, NULL, NULL, 'roles', '2', 'INSERT', NULL, NULL, '{"id": 2, "rol": "admin"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(3, NULL, NULL, 'roles', '3', 'INSERT', NULL, NULL, '{"id": 3, "rol": "ejecutivo"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(4, NULL, NULL, 'roles', '4', 'INSERT', NULL, NULL, '{"id": 4, "rol": "recepcion"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(5, NULL, NULL, 'permisos', '1', 'INSERT', NULL, NULL, '{"id": 1, "permiso": "ver_auditoria"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(6, NULL, NULL, 'permisos', '2', 'INSERT', NULL, NULL, '{"id": 2, "permiso": "eliminar_registros"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(7, NULL, NULL, 'permisos', '3', 'INSERT', NULL, NULL, '{"id": 3, "permiso": "administrar_usuarios"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(8, NULL, NULL, 'permisos', '4', 'INSERT', NULL, NULL, '{"id": 4, "permiso": "administrar_catalogos"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(9, NULL, NULL, 'permisos', '5', 'INSERT', NULL, NULL, '{"id": 5, "permiso": "aprobar_documentos"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(10, NULL, NULL, 'permisos', '6', 'INSERT', NULL, NULL, '{"id": 6, "permiso": "registrar_pagos"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(11, NULL, NULL, 'permisos', '7', 'INSERT', NULL, NULL, '{"id": 7, "permiso": "gestionar_renovaciones"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(12, NULL, NULL, 'permisos', '8', 'INSERT', NULL, NULL, '{"id": 8, "permiso": "registrar_correspondencia"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(13, NULL, NULL, 'permisos', '9', 'INSERT', NULL, NULL, '{"id": 9, "permiso": "ver_reportes"}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(14, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 1}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(15, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 1}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(16, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 2}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(17, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 2}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(18, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 3}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(19, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 3}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(20, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 4}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(21, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 4}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(22, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 5}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(23, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 5}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(24, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 6}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(25, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 6}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(26, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 7}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(27, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 7}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(28, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 8}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(29, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 8}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(30, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 1, "permisos_id": 9}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(31, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 2, "permisos_id": 9}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(32, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 3, "permisos_id": 5}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(33, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 3, "permisos_id": 6}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(34, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 3, "permisos_id": 7}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(35, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 3, "permisos_id": 9}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(36, NULL, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 4, "permisos_id": 8}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(37, NULL, NULL, 'config_alertas', NULL, 'INSERT', NULL, NULL, '{"activo": true, "dias_anticipacion": 60}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(38, NULL, NULL, 'config_alertas', NULL, 'INSERT', NULL, NULL, '{"activo": true, "dias_anticipacion": 30}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(39, NULL, NULL, 'config_alertas', NULL, 'INSERT', NULL, NULL, '{"activo": true, "dias_anticipacion": 15}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(40, NULL, NULL, 'config_alertas', NULL, 'INSERT', NULL, NULL, '{"activo": true, "dias_anticipacion": 7}', NULL, NULL, '2026-10-27 10:20:35.456195-03'),
	(41, NULL, NULL, 'direcciones', '1', 'INSERT', NULL, NULL, '{"id": 1, "calle": "Vicuña Mackenna Poniente", "numero": "7255", "comuna_id": 10, "complemento": "Oficina 707"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(42, NULL, NULL, 'direcciones', '2', 'INSERT', NULL, NULL, '{"id": 2, "calle": "Avenida General Oscar Bonilla", "numero": "5933", "comuna_id": 17, "complemento": "Depto 102"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(43, NULL, NULL, 'direcciones', '3', 'INSERT', NULL, NULL, '{"id": 3, "calle": "Los Guindos", "numero": "5970", "comuna_id": 22, "complemento": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(44, NULL, NULL, 'direcciones', '4', 'INSERT', NULL, NULL, '{"id": 4, "calle": "Panamericana Norte", "numero": "213", "comuna_id": 38, "complemento": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(45, NULL, NULL, 'direcciones', '5', 'INSERT', NULL, NULL, '{"id": 5, "calle": "Las Acacias", "numero": "2200", "comuna_id": 39, "complemento": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(46, NULL, NULL, 'direcciones', '6', 'INSERT', NULL, NULL, '{"id": 6, "calle": "Blanco", "numero": "1215", "comuna_id": 53, "complemento": "Oficina 405"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(47, NULL, NULL, 'direcciones', '7', 'INSERT', NULL, NULL, '{"id": 7, "calle": "Los Aromos", "numero": "1450", "comuna_id": 59, "complemento": "Depto 31"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(48, NULL, NULL, 'direcciones', '8', 'INSERT', NULL, NULL, '{"id": 8, "calle": "El Potrerillo", "numero": "8", "comuna_id": 76, "complemento": "Oficina C"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(49, 1, NULL, 'representantes_legales', '1', 'INSERT', NULL, NULL, '{"id": 1, "rut": "26204447-5", "email": "jesus.marcano@ejemplo.test", "profesion": null, "direccion_id": 2, "estado_civil": null, "nacionalidad": null, "registrado_por": 1, "nombre_completo": "JESUS RAMÓN MARCANO JIMENEZ"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(50, 1, NULL, 'representantes_legales', '2', 'INSERT', NULL, NULL, '{"id": 2, "rut": "15378280-6", "email": "javier.gonzalez@ejemplo.test", "profesion": null, "direccion_id": 3, "estado_civil": null, "nacionalidad": null, "registrado_por": 1, "nombre_completo": "JAVIER IGNACIO GONZALEZ SOISSA"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(51, 1, NULL, 'representantes_legales', '3', 'INSERT', NULL, NULL, '{"id": 3, "rut": "14144266-K", "email": "oscar.contreras@ejemplo.test", "profesion": null, "direccion_id": 4, "estado_civil": null, "nacionalidad": null, "registrado_por": 1, "nombre_completo": "OSCAR CONTRERAS BENAVIDES"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(52, 1, NULL, 'representantes_legales', '4', 'INSERT', NULL, NULL, '{"id": 4, "rut": "21456590-0", "email": "matias.jimenez@ejemplo.test", "profesion": null, "direccion_id": 5, "estado_civil": null, "nacionalidad": null, "registrado_por": 1, "nombre_completo": "MATIAS JIMENEZ LEAL"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(53, 1, NULL, 'representantes_legales', '5', 'INSERT', NULL, NULL, '{"id": 5, "rut": "10398885-3", "email": null, "profesion": "ingeniero de ejecución", "direccion_id": 6, "estado_civil": "divorciado", "nacionalidad": "chileno", "registrado_por": 1, "nombre_completo": "MARCO ANTONIO ESCOBAR DONOSO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(54, 1, NULL, 'empresas_emisoras', '1', 'INSERT', NULL, NULL, '{"id": 1, "rut": "76767272-1", "email": null, "activo": true, "telefono": "+56 2 22777781", "razon_social": "EASY OFFICE SpA", "nombre_comercial": "EASY OFFICE", "personeria_fecha": "2017-08-10", "personeria_fuente": "Registro de Empresas y Sociedades, Ley Nº 20.659", "representante_legal_id": 5}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(55, 1, NULL, 'empresas_emisoras', '2', 'INSERT', NULL, NULL, '{"id": 2, "rut": "76767272-1", "email": null, "activo": true, "telefono": "+56 2 22777781", "razon_social": "EASY OFFICE SpA", "nombre_comercial": "INOFFICE", "personeria_fecha": "2017-08-10", "personeria_fuente": "Registro de Empresas y Sociedades, Ley Nº 20.659", "representante_legal_id": 5}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(56, 1, NULL, 'propietarios_inmueble', '1', 'INSERT', NULL, NULL, '{"id": 1, "rut": "76431160-4", "direccion_id": 6, "razon_social": "MARCO ANTONIO ESCOBAR DONOSO SERVICIOS RETAIL E.I.R.L", "representante_legal_id": 5}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(57, 1, NULL, 'sucursales', '1', 'INSERT', NULL, NULL, '{"id": 1, "activo": true, "nombre": "La Florida", "empresa_id": 1, "unidad_sii": "SAN ANTONIO LA FLORIDA", "direccion_id": 1, "prefijo_folio": "LF", "rol_propiedad": "271-147", "propietario_id": 1}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(58, 1, NULL, 'sucursales', '2', 'INSERT', NULL, NULL, '{"id": 2, "activo": true, "nombre": "Valparaíso", "empresa_id": 1, "unidad_sii": null, "direccion_id": 6, "prefijo_folio": "VL", "rol_propiedad": "15-12", "propietario_id": 1}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(59, 1, NULL, 'sucursales', '3', 'INSERT', NULL, NULL, '{"id": 3, "activo": true, "nombre": "San Antonio", "empresa_id": 1, "unidad_sii": null, "direccion_id": 8, "prefijo_folio": "SA", "rol_propiedad": "267-56", "propietario_id": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(60, 1, NULL, 'cuentas_recaudacion', '1', 'INSERT', NULL, NULL, '{"id": 1, "banco": "Banco Estado", "activa": true, "titular": "EASY OFFICE SpA", "empresa_id": 1, "rut_titular": "76767272-1", "tipo_cuenta": "Cuenta Corriente / Chequera Electrónica", "numero_cuenta": "25770158951"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(61, 1, NULL, 'cuentas_recaudacion', '2', 'INSERT', NULL, NULL, '{"id": 2, "banco": "Banco Mercado Pago", "activa": true, "titular": "EASY OFFICE SpA", "empresa_id": 2, "rut_titular": "76767272-1", "tipo_cuenta": "Cuenta Vista", "numero_cuenta": "1159226880"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(62, 1, NULL, 'servicios', '1', 'INSERT', NULL, NULL, '{"id": 1, "tipo": "PRINCIPAL", "activo": true, "codigo": null, "nombre": "DOMICILIO TRIBUTARIO", "unidad": null, "incluye_iva": false, "precio_desde": false, "precio_lista": 59990, "descripcion_base": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "ANUAL"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(63, 1, NULL, 'servicios', '2', 'INSERT', NULL, NULL, '{"id": 2, "tipo": "PRINCIPAL", "activo": true, "codigo": null, "nombre": "BODEGA VIRTUAL", "unidad": null, "incluye_iva": false, "precio_desde": false, "precio_lista": 59990, "descripcion_base": "Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "ANUAL"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(64, 1, NULL, 'servicios', '3', 'INSERT', NULL, NULL, '{"id": 3, "tipo": "PRINCIPAL", "activo": true, "codigo": null, "nombre": "CREACION DE EMPRESAS", "unidad": null, "incluye_iva": false, "precio_desde": false, "precio_lista": 49990, "descripcion_base": "Constitución empresa en un día, hasta 3 socios\nObtención de rut\nDomicilio tributario x 3 meses\nInicio de actividad ante el SII\nInscripción factura electrónica\nGestión conjunta solicitud cuenta emprendedor BancoEstado", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(65, 1, NULL, 'servicios', '4', 'INSERT', NULL, NULL, '{"id": 4, "tipo": "PRINCIPAL", "activo": true, "codigo": null, "nombre": "WEB MAIL + DOMINIO", "unidad": null, "incluye_iva": false, "precio_desde": false, "precio_lista": 14990, "descripcion_base": "Servicio web mail corporativo 1 GB + dominio x 1 año", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "ANUAL"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(66, 1, NULL, 'servicios', '5', 'INSERT', NULL, NULL, '{"id": 5, "tipo": "PRINCIPAL", "activo": true, "codigo": null, "nombre": "CONTABILIDAD", "unidad": null, "incluye_iva": false, "precio_desde": true, "precio_lista": 15900, "descripcion_base": null, "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "MENSUAL"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(67, 1, NULL, 'servicios', '6', 'INSERT', NULL, NULL, '{"id": 6, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "FIRMA ELECTRÓNICA AVANZADA", "unidad": "por firma", "incluye_iva": false, "precio_desde": false, "precio_lista": 5900, "descripcion_base": "Autentificado con Clave Única y Red de Notarios digitales. Trámite 100% online.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(68, 1, NULL, 'servicios', '7', 'INSERT', NULL, NULL, '{"id": 7, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "BOLSA DE 10 FIRMAS ELECTRÓNICAS AVANZADAS", "unidad": "por bolsa", "incluye_iva": false, "precio_desde": false, "precio_lista": 29990, "descripcion_base": "Autentificado con Clave Única y red de notarios digitales. Vigencia 6 meses, renovables.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(69, 1, NULL, 'servicios', '8', 'INSERT', NULL, NULL, '{"id": 8, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "FIRMA ELECTRÓNICA AVANZADA PARA CONTRATOS", "unidad": "por contrato", "incluye_iva": false, "precio_desde": true, "precio_lista": 14900, "descripcion_base": "Hasta 3 firmantes. Contratos entre dos partes: laborales, servicios, compraventa, arriendo de vehículo y propiedades, entre otros. Trámite 100% online.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(70, 1, NULL, 'servicios', '9', 'INSERT', NULL, NULL, '{"id": 9, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "DECLARACIONES JURADAS DE UNA FIRMA", "unidad": "por documento", "incluye_iva": false, "precio_desde": true, "precio_lista": 9900, "descripcion_base": null, "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(71, 1, NULL, 'servicios', '10', 'INSERT', NULL, NULL, '{"id": 10, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "DECLARACIONES JURADAS DE DOS FIRMAS", "unidad": "por documento", "incluye_iva": false, "precio_desde": false, "precio_lista": 14900, "descripcion_base": null, "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(72, 1, NULL, 'servicios', '11', 'INSERT', NULL, NULL, '{"id": 11, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "PODERES Y AUTORIZACIONES", "unidad": "por documento", "incluye_iva": false, "precio_desde": true, "precio_lista": 9900, "descripcion_base": "Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(73, 1, NULL, 'servicios', '12', 'INSERT', NULL, NULL, '{"id": 12, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "CERTIFICACIÓN NOTARIAL", "unidad": "por documento", "incluye_iva": false, "precio_desde": true, "precio_lista": 14900, "descripcion_base": "Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(74, 1, NULL, 'servicios', '13', 'INSERT', NULL, NULL, '{"id": 13, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "PROTOCOLIZACIÓN NOTARIAL", "unidad": "por documento", "incluye_iva": false, "precio_desde": true, "precio_lista": 14900, "descripcion_base": "Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(75, 1, NULL, 'servicios', '14', 'INSERT', NULL, NULL, '{"id": 14, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "AUTENTIFICACIÓN NOTARIAL", "unidad": "por documento", "incluye_iva": false, "precio_desde": true, "precio_lista": 14900, "descripcion_base": "Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(76, 1, NULL, 'servicios', '15', 'INSERT', NULL, NULL, '{"id": 15, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "SERVICIO DE REMUNERACIONES", "unidad": "por persona", "incluye_iva": false, "precio_desde": true, "precio_lista": 14900, "descripcion_base": null, "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "MENSUAL"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(77, 1, NULL, 'servicios', '16', 'INSERT', NULL, NULL, '{"id": 16, "tipo": "COMPLEMENTARIO", "activo": true, "codigo": null, "nombre": "IMPRESIÓN/DIGITALIZACIÓN DE DOCUMENTOS", "unidad": "por página", "incluye_iva": false, "precio_desde": false, "precio_lista": 1900, "descripcion_base": null, "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(78, 1, NULL, 'plantillas_documento', '1', 'INSERT', NULL, NULL, '{"id": 1, "activo": true, "campos": [{"tipo": "texto", "clave": "folio", "origen": "contratos.folio"}, {"tipo": "vista", "clave": "datos", "origen": "v_datos_contrato"}, {"tipo": "vista", "clave": "servicios", "origen": "v_datos_contrato_servicios"}], "familia": "CONTRATO_SERVICIO", "version": 1, "archivo_base": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "tipo_documento": "CONTRATO DE SERVICIOS OFICINA", "requiere_revision": false, "contenido_plantilla": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(79, 1, NULL, 'plantillas_documento', '2', 'INSERT', NULL, NULL, '{"id": 2, "activo": true, "campos": [{"tipo": "texto", "clave": "folio", "origen": "contratos.folio"}, {"tipo": "vista", "clave": "datos", "origen": "v_datos_contrato"}, {"tipo": "vista", "clave": "servicios", "origen": "v_datos_contrato_servicios"}], "familia": "CONTRATO_SERVICIO", "version": 1, "archivo_base": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "tipo_documento": "CONTRATO DE SERVICIOS BODEGA", "requiere_revision": false, "contenido_plantilla": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(80, 1, NULL, 'plantillas_documento', '3', 'INSERT', NULL, NULL, '{"id": 3, "activo": true, "campos": [{"tipo": "fecha", "clave": "fecha", "etiqueta": "Fecha"}, {"tipo": "cliente", "clave": "empresa", "etiqueta": "Datos de la empresa"}, {"tipo": "parte", "clave": "representante", "etiqueta": "Representante / apoderado"}], "familia": "PODER", "version": 1, "archivo_base": null, "tipo_documento": "PODER SIMPLE", "requiere_revision": true, "contenido_plantilla": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(81, 1, NULL, 'plantillas_documento', '4', 'INSERT', NULL, NULL, '{"id": 4, "activo": true, "campos": [{"tipo": "texto", "clave": "sociedad", "etiqueta": "Sociedad"}, {"tipo": "texto", "clave": "lugar", "etiqueta": "Ciudad"}, {"tipo": "fecha", "clave": "fecha", "etiqueta": "Fecha"}, {"tipo": "entero", "clave": "total_acciones", "etiqueta": "Total de acciones"}, {"tipo": "monto", "clave": "capital", "etiqueta": "Capital (CLP)"}], "familia": "ACUERDO_ACCIONISTAS", "version": 1, "archivo_base": "TE1D - ACUERDO DE ACCIONISTAS PARA SPA (1).docx", "tipo_documento": "ACUERDO DE ACCIONISTAS", "requiere_revision": true, "contenido_plantilla": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(82, 1, NULL, 'plantillas_documento', '5', 'INSERT', NULL, NULL, '{"id": 5, "activo": true, "campos": [{"tipo": "fecha", "clave": "fecha"}, {"tipo": "texto", "clave": "depto_numero"}, {"tipo": "texto", "clave": "fojas"}, {"tipo": "texto", "clave": "inscripcion_numero"}, {"tipo": "texto", "clave": "conservador"}, {"tipo": "entero", "clave": "anio_inscripcion"}, {"tipo": "texto", "clave": "estacionamiento_numero"}, {"tipo": "texto", "clave": "piso"}, {"tipo": "monto", "clave": "renta"}, {"tipo": "texto", "clave": "banco"}, {"tipo": "texto", "clave": "tipo_cuenta"}, {"tipo": "texto", "clave": "numero_cuenta"}, {"tipo": "email", "clave": "email_aviso_pago"}, {"tipo": "entero", "clave": "vigencia_meses"}, {"tipo": "fecha", "clave": "fecha_inicio"}, {"tipo": "entero", "clave": "renovacion_meses"}], "familia": "ARRIENDO", "version": 1, "archivo_base": "CONTRATO DE ARRIENDO ESTACIONAMIENTO (1).docx", "tipo_documento": "CONTRATO DE ARRIENDO DE ESTACIONAMIENTO", "requiere_revision": false, "contenido_plantilla": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(83, 1, NULL, 'plantillas_documento', '6', 'INSERT', NULL, NULL, '{"id": 6, "activo": true, "campos": [{"tipo": "texto", "clave": "comuna"}, {"tipo": "fecha", "clave": "fecha"}, {"tipo": "texto", "clave": "marca"}, {"tipo": "texto", "clave": "modelo"}, {"tipo": "entero", "clave": "anio"}, {"tipo": "texto", "clave": "patente"}, {"tipo": "texto", "clave": "color"}, {"tipo": "texto", "clave": "vin"}, {"tipo": "texto", "clave": "plazo"}, {"tipo": "fecha", "clave": "fecha_inicio"}, {"tipo": "fecha", "clave": "fecha_termino"}, {"tipo": "monto", "clave": "renta_mensual"}, {"tipo": "texto", "clave": "renta_en_palabras"}, {"tipo": "entero", "clave": "dias_pago"}, {"tipo": "texto", "clave": "medio_pago"}], "familia": "ARRIENDO", "version": 1, "archivo_base": "CONTRATO DE ARRIENDO VEHICULO (1).docx", "tipo_documento": "CONTRATO DE ARRIENDO DE VEHÍCULO", "requiere_revision": false, "contenido_plantilla": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(84, 1, NULL, 'clausulas_documento', '1', 'INSERT', NULL, NULL, '{"id": 1, "activo": true, "campos": ["saliente_nombre", "entrante_nombre", "entrante_rut"], "codigo": "ELIMINAR_REPRESENTANTE", "titulo": "Eliminar representante legal", "familia": "ACUERDO_ACCIONISTAS", "texto_plantilla": "Se elimina a don {saliente_nombre}, como representante legal y gerente. En su reemplazo asume como gerente don {entrante_nombre}, cédula nacional de identidad número {entrante_rut}, también como representante legal ante el Servicio de Impuestos Internos."}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(85, 1, NULL, 'clausulas_documento', '2', 'INSERT', NULL, NULL, '{"id": 2, "activo": true, "campos": ["razon_social_antigua", "razon_social_nueva"], "codigo": "CAMBIO_RAZON_SOCIAL", "titulo": "Cambio de razón social", "familia": "ACUERDO_ACCIONISTAS", "texto_plantilla": "Se elimina la razón social antigua de {razon_social_antigua} y se agrega la nueva razón social de la empresa: {razon_social_nueva}."}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(86, 1, NULL, 'clausulas_documento', '3', 'INSERT', NULL, NULL, '{"id": 3, "activo": true, "campos": ["nombre_antiguo", "nombre_nuevo"], "codigo": "CAMBIO_NOMBRE_FANTASIA", "titulo": "Cambio de nombre de fantasía", "familia": "ACUERDO_ACCIONISTAS", "texto_plantilla": "Se elimina el nombre de fantasía antiguo de {nombre_antiguo} y se agrega el nuevo nombre de fantasía de la empresa: {nombre_nuevo}."}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(87, 1, NULL, 'clausulas_documento', '4', 'INSERT', NULL, NULL, '{"id": 4, "activo": true, "campos": ["accionista_nombre", "accionista_rut"], "codigo": "ELIMINAR_ACCIONISTA", "titulo": "Eliminar accionista", "familia": "ACUERDO_ACCIONISTAS", "texto_plantilla": "Se elimina a don {accionista_nombre}, cédula nacional de identidad número {accionista_rut}, como accionista de la sociedad."}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(88, 1, NULL, 'clausulas_documento', '5', 'INSERT', NULL, NULL, '{"id": 5, "activo": true, "campos": ["capital_anterior", "capital_nuevo", "acciones"], "codigo": "AJUSTAR_CAPITAL", "titulo": "Ajustar capital", "familia": "ACUERDO_ACCIONISTAS", "texto_plantilla": "Se modifica el capital de la sociedad, que pasa de {capital_anterior} a {capital_nuevo} pesos, dividido en {acciones} acciones ordinarias de la serie única."}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(89, 1, NULL, 'clausulas_documento', '6', 'INSERT', NULL, NULL, '{"id": 6, "activo": true, "campos": ["apoderado_nombre", "apoderado_rut"], "codigo": "FACULTAR_GESTION", "titulo": "Facultar para realizar los trámites", "familia": "ACUERDO_ACCIONISTAS", "texto_plantilla": "Los accionistas facultan a don {apoderado_nombre}, cédula nacional de identidad número {apoderado_rut}, para que efectúe las modificaciones y suscripciones ante el Registro de Empresas y Sociedades del presente acto."}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(90, 1, NULL, 'clientes', '1', 'INSERT', NULL, NULL, '{"id": 1, "rut": "77496835-0", "email": "jrmj1592@gmail.com", "origen": "crm", "celular": "949836363", "creado_en": "2026-10-27T11:35:30.449926-03:00", "direccion_id": null, "razon_social": "JM IMPORT SpA", "tipo_persona": "juridica", "sitio_notaria": "www.registrodeempresasysociedades.cl", "giro_principal": "VENTA X INTERNET", "registrado_por": 1, "fecha_escritura": "2021-12-16", "nombre_fantasia": null, "consentimiento_en": null, "acepta_comunicaciones": false, "representante_legal_id": 1}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(91, 1, NULL, 'clientes', '2', 'INSERT', NULL, NULL, '{"id": 2, "rut": "78332529-2", "email": "soissaextreme@gmail.com", "origen": "crm", "celular": "991882417", "creado_en": "2026-10-27T11:35:30.449926-03:00", "direccion_id": null, "razon_social": "Sx4x4 SpA", "tipo_persona": "juridica", "sitio_notaria": "www.tuempresaenundia.cl", "giro_principal": "MECÁNICA A DOMICILIO", "registrado_por": 1, "fecha_escritura": "2026-01-12", "nombre_fantasia": null, "consentimiento_en": null, "acepta_comunicaciones": false, "representante_legal_id": 2}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(92, 1, NULL, 'clientes', '3', 'INSERT', NULL, NULL, '{"id": 3, "rut": "78526673-0", "email": "contacto@altusandcompany.cl", "origen": "crm", "celular": "932365169", "creado_en": "2026-10-27T11:35:30.449926-03:00", "direccion_id": null, "razon_social": "ALTUS AND COMPANY CO. SPA", "tipo_persona": "juridica", "sitio_notaria": "www.tuempresaenundia.cl", "giro_principal": "COMERCIALIZADORA", "registrado_por": 1, "fecha_escritura": "2026-10-02", "nombre_fantasia": null, "consentimiento_en": null, "acepta_comunicaciones": false, "representante_legal_id": 3}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(93, 1, NULL, 'clientes', '4', 'INSERT', NULL, NULL, '{"id": 4, "rut": "78007592-9", "email": "aironsoldiering@gmail.com", "origen": "crm", "celular": "957482381", "creado_en": "2026-10-27T11:35:30.449926-03:00", "direccion_id": null, "razon_social": "SOLDADURAS IRON SOLDERING MATIAS JIMENEZ LEAL E.I.R.L.", "tipo_persona": "juridica", "sitio_notaria": null, "giro_principal": "SERVICIOS DE SOLDADURA", "registrado_por": 1, "fecha_escritura": null, "nombre_fantasia": null, "consentimiento_en": null, "acepta_comunicaciones": false, "representante_legal_id": 4}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(94, 1, NULL, 'clientes', '5', 'INSERT', NULL, NULL, '{"id": 5, "rut": "16543210-K", "email": "camila.rojas@ejemplo.test", "origen": "crm", "celular": "987654321", "creado_en": "2026-10-27T11:35:30.449926-03:00", "direccion_id": 7, "razon_social": "CAMILA ANDREA ROJAS PEREZ", "tipo_persona": "natural", "sitio_notaria": null, "giro_principal": "ASESORÍAS DE DISEÑO", "registrado_por": 1, "fecha_escritura": null, "nombre_fantasia": null, "consentimiento_en": null, "acepta_comunicaciones": false, "representante_legal_id": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(95, 1, NULL, 'contratos', '1', 'INSERT', NULL, NULL, '{"id": 1, "folio": "LF-01-2026", "estado": "activo", "origen": "crm", "creado_en": "2026-10-27T11:35:30.449926-03:00", "link_pago": null, "cliente_id": 1, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 1, "fecha_inicio": "2026-01-15", "observaciones": null, "duracion_meses": 12, "datos_formulario": null, "fecha_celebracion": "2026-01-15", "fecha_vencimiento": "2027-01-13", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(96, 1, NULL, 'contratos', '2', 'INSERT', NULL, NULL, '{"id": 2, "folio": "LF-02-2026", "estado": "activo", "origen": "crm", "creado_en": "2026-10-27T11:35:30.449926-03:00", "link_pago": null, "cliente_id": 2, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 1, "fecha_inicio": "2026-01-15", "observaciones": null, "duracion_meses": 12, "datos_formulario": null, "fecha_celebracion": "2026-01-15", "fecha_vencimiento": "2027-01-14", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(97, 1, NULL, 'contratos', '3', 'INSERT', NULL, NULL, '{"id": 3, "folio": "LF-0152-2026", "estado": "activo", "origen": "crm", "creado_en": "2026-10-27T11:35:30.449926-03:00", "link_pago": null, "cliente_id": 3, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 1, "fecha_inicio": "2026-10-02", "observaciones": null, "duracion_meses": 12, "datos_formulario": null, "fecha_celebracion": "2026-10-02", "fecha_vencimiento": "2027-10-01", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(98, 1, NULL, 'contratos', '4', 'INSERT', NULL, NULL, '{"id": 4, "folio": "LF-0150-2026", "estado": "activo", "origen": "crm", "creado_en": "2026-10-27T11:35:30.449926-03:00", "link_pago": null, "cliente_id": 4, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 1, "fecha_inicio": "2026-09-25", "observaciones": null, "duracion_meses": 12, "datos_formulario": null, "fecha_celebracion": "2026-09-25", "fecha_vencimiento": "2027-09-24", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(99, 1, NULL, 'contratos', '5', 'INSERT', NULL, NULL, '{"id": 5, "folio": "LF-0153-2026", "estado": "activo", "origen": "crm", "creado_en": "2026-10-27T11:35:30.449926-03:00", "link_pago": null, "cliente_id": 5, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 1, "fecha_inicio": "2026-08-01", "observaciones": null, "duracion_meses": 12, "datos_formulario": null, "fecha_celebracion": "2026-08-01", "fecha_vencimiento": "2027-07-31", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(100, 1, NULL, 'contrato_servicios', '1', 'INSERT', NULL, NULL, '{"id": 1, "orden": 1, "precio": 59990, "ciclo_pago": "ANUAL", "contrato_id": 4, "descripcion": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "servicio_id": 1}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(101, 1, NULL, 'contrato_servicios', '2', 'INSERT', NULL, NULL, '{"id": 2, "orden": 2, "precio": 59990, "ciclo_pago": "ANUAL", "contrato_id": 3, "descripcion": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "servicio_id": 1}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(102, 1, NULL, 'contrato_servicios', '3', 'INSERT', NULL, NULL, '{"id": 3, "orden": 1, "precio": 59990, "ciclo_pago": "ANUAL", "contrato_id": 2, "descripcion": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "servicio_id": 1}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(103, 1, NULL, 'contrato_servicios', '4', 'INSERT', NULL, NULL, '{"id": 4, "orden": 1, "precio": 59990, "ciclo_pago": "ANUAL", "contrato_id": 1, "descripcion": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "servicio_id": 1}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(104, 1, NULL, 'contrato_servicios', '5', 'INSERT', NULL, NULL, '{"id": 5, "orden": 2, "precio": 59990, "ciclo_pago": "ANUAL", "contrato_id": 4, "descripcion": "Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.", "servicio_id": 2}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(105, 1, NULL, 'contrato_servicios', '6', 'INSERT', NULL, NULL, '{"id": 6, "orden": 2, "precio": 71388, "ciclo_pago": "ANUAL", "contrato_id": 1, "descripcion": "Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.", "servicio_id": 2}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(106, 1, NULL, 'contrato_servicios', '7', 'INSERT', NULL, NULL, '{"id": 7, "orden": 1, "precio": 49990, "ciclo_pago": "UNICO", "contrato_id": 3, "descripcion": "Constitución empresa en un día, hasta 3 socios\nObtención de rut\nDomicilio tributario x 3 meses\nInicio de actividad ante el SII\nInscripción factura electrónica\nGestión conjunta solicitud cuenta emprendedor BancoEstado", "servicio_id": 3}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(107, 1, NULL, 'contrato_servicios', '8', 'INSERT', NULL, NULL, '{"id": 8, "orden": 2, "precio": 49990, "ciclo_pago": "UNICO", "contrato_id": 2, "descripcion": "Constitución empresa en un día, hasta 3 socios\nObtención de rut\nDomicilio tributario x 3 meses\nInicio de actividad ante el SII\nInscripción factura electrónica\nGestión conjunta solicitud cuenta emprendedor BancoEstado", "servicio_id": 3}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(108, 1, NULL, 'contrato_servicios', '9', 'INSERT', NULL, NULL, '{"id": 9, "orden": 3, "precio": 14990, "ciclo_pago": "ANUAL", "contrato_id": 3, "descripcion": "Servicio web mail corporativo 1 GB + dominio x 1 año", "servicio_id": 4}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(109, 1, NULL, 'contrato_servicios', '10', 'INSERT', NULL, NULL, '{"id": 10, "orden": 1, "precio": 59990, "ciclo_pago": "ANUAL", "contrato_id": 5, "descripcion": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "servicio_id": 1}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(110, 1, NULL, 'documentos', '1', 'INSERT', NULL, NULL, '{"id": 1, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": null, "lugar": "Santiago", "estado": "borrador", "cliente_id": 3, "firmado_en": null, "contrato_id": 3, "generado_en": "2026-10-27T11:35:30.449926-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": null, "ejecutivo_id": 1, "plantilla_id": 1, "revisado_por": null, "fecha_documento": "2026-10-02", "firma_id_externo": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(111, 1, NULL, 'documentos', '2', 'INSERT', NULL, NULL, '{"id": 2, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": null, "lugar": "Santiago", "estado": "borrador", "cliente_id": 4, "firmado_en": null, "contrato_id": 4, "generado_en": "2026-10-27T11:35:30.449926-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": null, "ejecutivo_id": 1, "plantilla_id": 2, "revisado_por": null, "fecha_documento": "2026-09-25", "firma_id_externo": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(112, 1, NULL, 'pagos', '1', 'INSERT', NULL, NULL, '{"id": 1, "cuota": 1, "monto": 62485, "estado": "pagado", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": "2026-10-02T10:31:00-03:00", "contrato_id": 3, "documento_id": null, "total_cuotas": 2, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(113, 1, NULL, 'pagos', '2', 'INSERT', NULL, NULL, '{"id": 2, "cuota": 2, "monto": 62485, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 3, "documento_id": null, "total_cuotas": 2, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(114, 1, NULL, 'pagos', '3', 'INSERT', NULL, NULL, '{"id": 3, "cuota": 1, "monto": 59990, "estado": "pagado", "url_dte": null, "pasarela": "transferencia", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": "2026-08-01T12:00:00-04:00", "contrato_id": 5, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(115, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-27 11:44:26.69219-03'),
	(116, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-27 11:44:26.740703-03'),
	(117, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-27 11:50:37.947841-03'),
	(118, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-27 11:51:54.355341-03'),
	(119, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-27 11:52:02.334125-03'),
	(120, NULL, NULL, 'servicios', '1', 'UPDATE', NULL, '{"id": 1, "tipo": "PRINCIPAL", "activo": true, "codigo": null, "nombre": "DOMICILIO TRIBUTARIO", "unidad": null, "incluye_iva": false, "precio_desde": false, "precio_lista": 59990, "descripcion_base": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "ANUAL"}', '{"id": 1, "tipo": "PRINCIPAL", "activo": true, "codigo": "dom-anual", "nombre": "DOMICILIO TRIBUTARIO", "unidad": null, "incluye_iva": false, "precio_desde": false, "precio_lista": 59990, "descripcion_base": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "ANUAL"}', NULL, NULL, '2026-10-27 20:16:22.86296-03'),
	(121, NULL, NULL, 'servicios', '2', 'UPDATE', NULL, '{"id": 2, "tipo": "PRINCIPAL", "activo": true, "codigo": null, "nombre": "BODEGA VIRTUAL", "unidad": null, "incluye_iva": false, "precio_desde": false, "precio_lista": 59990, "descripcion_base": "Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "ANUAL"}', '{"id": 2, "tipo": "PRINCIPAL", "activo": true, "codigo": "dom-bod", "nombre": "BODEGA VIRTUAL", "unidad": null, "incluye_iva": false, "precio_desde": false, "precio_lista": 59990, "descripcion_base": "Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "ANUAL"}', NULL, NULL, '2026-10-27 20:16:22.86296-03'),
	(122, NULL, NULL, 'plantilla_planes', NULL, 'INSERT', NULL, NULL, '{"plan_codigo": "dom-sem", "plantilla_id": 1}', NULL, NULL, '2026-10-27 20:16:22.86296-03'),
	(123, NULL, NULL, 'plantilla_planes', NULL, 'INSERT', NULL, NULL, '{"plan_codigo": "dom-anual", "plantilla_id": 1}', NULL, NULL, '2026-10-27 20:16:22.86296-03'),
	(124, NULL, NULL, 'plantilla_planes', NULL, 'INSERT', NULL, NULL, '{"plan_codigo": "dom-bod", "plantilla_id": 2}', NULL, NULL, '2026-10-27 20:16:22.86296-03'),
	(125, NULL, NULL, 'plantillas_documento', '2', 'UPDATE', NULL, '{"id": 2, "activo": true, "campos": [{"tipo": "texto", "clave": "folio", "origen": "contratos.folio"}, {"tipo": "vista", "clave": "datos", "origen": "v_datos_contrato"}, {"tipo": "vista", "clave": "servicios", "origen": "v_datos_contrato_servicios"}], "entrega": "revision", "familia": "CONTRATO_SERVICIO", "version": 1, "mapa_campos": null, "archivo_base": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "tipo_documento": "CONTRATO DE SERVICIOS BODEGA", "requiere_revision": false, "contenido_plantilla": null}', '{"id": 2, "activo": true, "campos": [{"tipo": "texto", "clave": "folio", "origen": "contratos.folio"}, {"tipo": "vista", "clave": "datos", "origen": "v_datos_contrato"}, {"tipo": "vista", "clave": "servicios", "origen": "v_datos_contrato_servicios"}], "entrega": "automatica", "familia": "CONTRATO_SERVICIO", "version": 1, "mapa_campos": null, "archivo_base": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "tipo_documento": "CONTRATO DE SERVICIOS BODEGA", "requiere_revision": false, "contenido_plantilla": null}', NULL, NULL, '2026-10-27 20:16:22.86296-03'),
	(126, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-27 20:18:06.446141-03'),
	(127, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-27 20:18:06.519423-03'),
	(129, NULL, NULL, 'servicios', '18', 'INSERT', NULL, NULL, '{"id": 18, "tipo": "PRINCIPAL", "activo": true, "codigo": "dom-sem", "nombre": "DOMICILIO TRIBUTARIO · PLAN SEMESTRAL", "unidad": null, "incluye_iva": true, "precio_desde": false, "precio_lista": 39990, "descripcion_base": "Domicilio tributario, postal y comercial x 6 meses\nRecepción de correspondencia y oficina de partes\nDigitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)\nInicio de actividad ante el S.I.I.\nFirma avanzada del contrato $5.000", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "SEMESTRAL"}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(130, NULL, NULL, 'direcciones', '9', 'INSERT', NULL, NULL, '{"id": 9, "calle": "el fogonero", "numero": "311", "comuna_id": 40, "complemento": null}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(131, NULL, NULL, 'clientes', '6', 'INSERT', NULL, NULL, '{"id": 6, "rut": "21167684-1", "email": "roger.andres.r@gmail.com", "origen": "web", "celular": "973421628", "creado_en": "2026-10-30T02:06:43.628927-03:00", "direccion_id": 9, "razon_social": "Roger Rosas", "tipo_persona": "natural", "sitio_notaria": null, "giro_principal": null, "registrado_por": null, "fecha_escritura": null, "nombre_fantasia": null, "consentimiento_en": null, "acepta_comunicaciones": false, "representante_legal_id": null}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(132, NULL, NULL, 'contratos', '6', 'INSERT', NULL, NULL, '{"id": 6, "folio": "LF-0154-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-10-30T02:06:43.628927-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 6, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "mp"}, "plan": "dom-sem", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-04-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(133, NULL, NULL, 'contrato_servicios', '11', 'INSERT', NULL, NULL, '{"id": 11, "orden": 1, "precio": 39990, "ciclo_pago": "SEMESTRAL", "contrato_id": 6, "descripcion": "Domicilio tributario, postal y comercial x 6 meses\nRecepción de correspondencia y oficina de partes\nDigitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)\nInicio de actividad ante el S.I.I.\nFirma avanzada del contrato $5.000", "servicio_id": 18}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(134, NULL, NULL, 'pagos', '4', 'INSERT', NULL, NULL, '{"id": 4, "cuota": 1, "monto": 39990, "estado": "pendiente", "url_dte": null, "pasarela": "mercado_pago", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 6, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(135, NULL, NULL, 'documentos', '3', 'INSERT', NULL, NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": null, "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(136, NULL, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": null, "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(137, NULL, NULL, 'documento_versiones', '1', 'INSERT', NULL, NULL, '{"id": 1, "version": 1, "generado_en": "2026-10-30T02:06:43.628927-03:00", "hash_sha256": "59ca809677b286f44b467d9beaa1a69997115cf7e8347a21ba1e39e0e20f289f", "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "documento_id": 3, "generado_por": null}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(138, NULL, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:06:43.628927-03'),
	(139, NULL, NULL, 'clientes', '6', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 02:18:50.065668-03'),
	(140, NULL, NULL, 'clientes', '6', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-30 02:18:50.133402-03'),
	(141, NULL, NULL, 'clientes', '6', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 02:37:44.57081-03'),
	(142, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 02:38:55.950002-03'),
	(143, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 02:52:50.201356-03'),
	(144, 2, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": 2, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:53:24.958685-03'),
	(145, 2, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": 2, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "por_revisar", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:53:24.958685-03'),
	(146, 2, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "por_revisar", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "por_revisar", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:53:48.110842-03'),
	(147, NULL, NULL, 'clientes', '6', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 02:54:57.970477-03'),
	(148, NULL, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "por_revisar", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-10-30T02:55:13.481904-03:00", "aceptado_ip": "::1", "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:55:13.481904-03'),
	(149, NULL, 6, 'documentos', '3', 'UPDATE', 'Aceptado por el cliente (roger.andres.r@gmail.com), versión 1', NULL, NULL, '::1', NULL, '2026-10-30 02:55:13.481904-03'),
	(150, NULL, NULL, 'contratos', '7', 'INSERT', NULL, NULL, '{"id": 7, "folio": "LF-0155-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-10-30T02:59:08.720934-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-bod", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-10-30 02:59:08.720934-03'),
	(151, NULL, NULL, 'contrato_servicios', '12', 'INSERT', NULL, NULL, '{"id": 12, "orden": 1, "precio": 59990, "ciclo_pago": "ANUAL", "contrato_id": 7, "descripcion": "Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.", "servicio_id": 2}', NULL, NULL, '2026-10-30 02:59:08.720934-03'),
	(152, NULL, NULL, 'pagos', '5', 'INSERT', NULL, NULL, '{"id": 5, "cuota": 1, "monto": 59990, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 7, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-10-30 02:59:08.720934-03'),
	(153, NULL, NULL, 'documentos', '4', 'INSERT', NULL, NULL, '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": null, "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:59:08.720934-03'),
	(154, NULL, NULL, 'documentos', '4', 'UPDATE', NULL, '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": null, "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:59:08.720934-03'),
	(155, NULL, NULL, 'documento_versiones', '2', 'INSERT', NULL, NULL, '{"id": 2, "version": 1, "generado_en": "2026-10-30T02:59:08.720934-03:00", "hash_sha256": "aa88f02cef0646f4fd42f57aad8408d8cb7a0e32e428dc0253c05120d675cd44", "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "documento_id": 4, "generado_por": null}', NULL, NULL, '2026-10-30 02:59:08.720934-03'),
	(156, NULL, NULL, 'documentos', '4', 'UPDATE', NULL, '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "por_revisar", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:59:08.720934-03'),
	(157, NULL, NULL, 'documentos', '4', 'UPDATE', NULL, '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": null, "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "por_revisar", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-10-30T02:59:46.403165-03:00", "aceptado_ip": "::1", "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "aceptado", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 02:59:46.403165-03'),
	(158, NULL, 6, 'documentos', '4', 'UPDATE', 'Aceptado por el cliente (roger.andres.r@gmail.com), versión 1', NULL, NULL, '::1', NULL, '2026-10-30 02:59:46.403165-03'),
	(159, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-30 02:59:59.275696-03'),
	(160, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 03:00:20.165438-03'),
	(184, 2, NULL, 'pagos', '2', 'UPDATE', NULL, '{"id": 2, "cuota": 2, "monto": 62485, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 3, "documento_id": null, "total_cuotas": 2, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', '{"id": 2, "cuota": 2, "monto": 62485, "estado": "pagado", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": "2026-11-03T16:08:55.544998-03:00", "contrato_id": 3, "documento_id": null, "total_cuotas": 2, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-11-03 16:08:55.544998-03'),
	(161, 2, NULL, 'documentos', '4', 'UPDATE', NULL, '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-10-30T02:59:46.403165-03:00", "aceptado_ip": "::1", "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "aceptado", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-10-30T02:59:46.403165-03:00", "aceptado_ip": "::1", "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "aceptado", "fecha_documento": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-10-30 03:00:49.906522-03'),
	(162, NULL, NULL, 'tickets', '1', 'INSERT', NULL, NULL, '{"id": 1, "email": "roger.andres.r@gmail.com", "estado": "abierto", "motivo": "otro", "detalle": "Necesito ayuda para...", "creado_en": "2026-10-30T03:01:24.7284-03:00", "respuesta": null, "cliente_id": 6, "atendido_por": null, "documento_id": null, "actualizado_en": null}', NULL, NULL, '2026-10-30 03:01:24.7284-03'),
	(163, 2, NULL, 'tickets', '1', 'UPDATE', NULL, '{"id": 1, "email": "roger.andres.r@gmail.com", "estado": "abierto", "motivo": "otro", "detalle": "Necesito ayuda para...", "creado_en": "2026-10-30T03:01:24.7284-03:00", "respuesta": null, "cliente_id": 6, "atendido_por": null, "documento_id": null, "actualizado_en": null}', '{"id": 1, "email": "roger.andres.r@gmail.com", "estado": "en_proceso", "motivo": "otro", "detalle": "Necesito ayuda para...", "creado_en": "2026-10-30T03:01:24.7284-03:00", "respuesta": "Claro usted tiene que....", "cliente_id": 6, "atendido_por": 2, "documento_id": null, "actualizado_en": "2026-10-30T03:01:46.055764-03:00"}', NULL, NULL, '2026-10-30 03:01:46.055764-03'),
	(164, 2, NULL, 'tickets', '1', 'UPDATE', NULL, '{"id": 1, "email": "roger.andres.r@gmail.com", "estado": "en_proceso", "motivo": "otro", "detalle": "Necesito ayuda para...", "creado_en": "2026-10-30T03:01:24.7284-03:00", "respuesta": "Claro usted tiene que....", "cliente_id": 6, "atendido_por": 2, "documento_id": null, "actualizado_en": "2026-10-30T03:01:46.055764-03:00"}', '{"id": 1, "email": "roger.andres.r@gmail.com", "estado": "cerrado", "motivo": "otro", "detalle": "Necesito ayuda para...", "creado_en": "2026-10-30T03:01:24.7284-03:00", "respuesta": "Claro usted tiene que....\n..............\nse realizaron los cambios que se necesitaban en el documento, cualquier duda puede abrir otro ticket", "cliente_id": 6, "atendido_por": 2, "documento_id": null, "actualizado_en": "2026-10-30T03:02:42.318987-03:00"}', NULL, NULL, '2026-10-30 03:02:42.318987-03'),
	(165, NULL, NULL, 'clientes', '6', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 15:02:50.971008-03'),
	(166, NULL, NULL, 'servicios', '19', 'INSERT', NULL, NULL, '{"id": 19, "tipo": "PRINCIPAL", "activo": true, "codigo": "fir-50", "nombre": "FIRMAS ELECTRÓNICAS · PLAN · 50 FIRMAS AVANZADAS", "unidad": null, "incluye_iva": true, "precio_desde": false, "precio_lista": 49990, "descripcion_base": "50 firmas electrónicas avanzadas\nVigencia 12 meses\nRecordatorio antes de vencer\nMejor precio por firma", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "ANUAL"}', NULL, NULL, '2026-10-30 15:05:15.648079-03'),
	(167, NULL, NULL, 'contratos', '8', 'INSERT', NULL, NULL, '{"id": 8, "folio": "LF-0156-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-10-30T15:05:15.648079-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-50", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-10-30 15:05:15.648079-03'),
	(168, NULL, NULL, 'contrato_servicios', '13', 'INSERT', NULL, NULL, '{"id": 13, "orden": 1, "precio": 49990, "ciclo_pago": "ANUAL", "contrato_id": 8, "descripcion": "50 firmas electrónicas avanzadas\nVigencia 12 meses\nRecordatorio antes de vencer\nMejor precio por firma", "servicio_id": 19}', NULL, NULL, '2026-10-30 15:05:15.648079-03'),
	(169, NULL, NULL, 'pagos', '6', 'INSERT', NULL, NULL, '{"id": 6, "cuota": 1, "monto": 49990, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 8, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-10-30 15:05:15.648079-03'),
	(170, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 15:06:12.870225-03'),
	(171, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-30 15:21:19.954485-03'),
	(172, NULL, NULL, 'clientes', '6', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-30 15:21:26.802223-03'),
	(173, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 17:07:31.410178-03'),
	(174, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-30 17:47:10.893444-03'),
	(175, 3, NULL, 'usuarios', '3', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 17:47:20.246696-03'),
	(176, 3, NULL, 'usuarios', '3', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-30 17:48:19.531009-03'),
	(177, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 17:48:26.998779-03'),
	(178, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-10-30 17:48:56.221379-03'),
	(179, 1, NULL, 'usuarios', '1', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-10-30 17:49:04.333388-03'),
	(180, NULL, NULL, 'clientes', '6', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-02 18:41:47.189065-03'),
	(181, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-02 18:42:27.753261-03'),
	(182, NULL, NULL, 'clientes', '6', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 16:05:20.629252-03'),
	(183, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 16:05:43.503615-03'),
	(224, NULL, NULL, 'pagos', '9', 'UPDATE', NULL, '{"id": 9, "cuota": 1, "monto": 3490, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 10, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', '{"id": 9, "cuota": 1, "monto": 3490, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 10, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": "SIM-9-F68AAFFE4603", "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-11-03 18:13:14.306928-03'),
	(185, 2, NULL, 'pagos', '4', 'UPDATE', NULL, '{"id": 4, "cuota": 1, "monto": 39990, "estado": "pendiente", "url_dte": null, "pasarela": "mercado_pago", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 6, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', '{"id": 4, "cuota": 1, "monto": 39990, "estado": "pagado", "url_dte": null, "pasarela": "mercado_pago", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": "2026-11-03T16:09:01.012306-03:00", "contrato_id": 6, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-11-03 16:09:01.012306-03'),
	(186, 2, NULL, 'pagos', '5', 'UPDATE', NULL, '{"id": 5, "cuota": 1, "monto": 59990, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 7, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', '{"id": 5, "cuota": 1, "monto": 59990, "estado": "pagado", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": "2026-11-03T16:09:07.685949-03:00", "contrato_id": 7, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-11-03 16:09:07.685949-03'),
	(187, 2, NULL, 'pagos', '6', 'UPDATE', NULL, '{"id": 6, "cuota": 1, "monto": 49990, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 8, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', '{"id": 6, "cuota": 1, "monto": 49990, "estado": "pagado", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": "2026-11-03T16:09:15.848743-03:00", "contrato_id": 8, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-11-03 16:09:15.848743-03'),
	(188, 2, NULL, 'documentos', '4', 'UPDATE', NULL, '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-10-30T02:59:46.403165-03:00", "aceptado_ip": "::1", "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "hash_firmado": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "firmado", "cliente_id": 6, "firmado_en": "2026-11-03T16:09:55.309744-03:00", "aceptado_en": "2026-10-30T02:59:46.403165-03:00", "aceptado_ip": "::1", "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "hash_firmado": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": "EO-35CC-EC69"}', NULL, NULL, '2026-11-03 16:09:55.309744-03'),
	(189, 2, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-10-30T02:55:13.481904-03:00", "aceptado_ip": "::1", "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-10-30T02:55:13.481904-03:00", "aceptado_ip": "::1", "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": "simulador", "enviado_firma_en": "2026-11-03T16:10:12.142287-03:00", "firma_id_externo": "SIM-3-FA9106", "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-11-03 16:10:12.142287-03'),
	(190, 2, NULL, 'documento_firmantes', '1', 'INSERT', NULL, NULL, '{"id": 1, "ip": null, "rut": "21167684-1", "email": "roger.andres.r@gmail.com", "orden": 1, "estado": "pendiente", "nombre": "Roger Rosas", "creado_en": "2026-11-03T16:10:12.142287-03:00", "firmado_en": null, "id_externo": "SIM-3-FA9106-F1", "documento_id": 3, "motivo_rechazo": null}', NULL, NULL, '2026-11-03 16:10:12.142287-03'),
	(213, NULL, NULL, 'documentos', '5', 'INSERT', NULL, NULL, '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": null, "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-11-03 18:09:48.775735-03'),
	(191, 2, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-10-30T02:55:13.481904-03:00", "aceptado_ip": "::1", "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": "simulador", "enviado_firma_en": "2026-11-03T16:10:12.142287-03:00", "firma_id_externo": "SIM-3-FA9106", "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "firmado", "cliente_id": 6, "firmado_en": "2026-11-03T16:10:16.355172-03:00", "aceptado_en": "2026-10-30T02:55:13.481904-03:00", "aceptado_ip": "::1", "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": "simulador", "enviado_firma_en": "2026-11-03T16:10:12.142287-03:00", "firma_id_externo": "SIM-3-FA9106", "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": "EO-4F39-0438"}', NULL, NULL, '2026-11-03 16:10:16.355172-03'),
	(192, NULL, NULL, 'contratos', '6', 'UPDATE', NULL, '{"id": 6, "folio": "LF-0154-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-10-30T02:06:43.628927-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 6, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "mp"}, "plan": "dom-sem", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-04-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 6, "folio": "LF-0154-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T02:06:43.628927-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 6, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "mp"}, "plan": "dom-sem", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-04-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 16:12:41.299132-03'),
	(193, NULL, NULL, 'contratos', '7', 'UPDATE', NULL, '{"id": 7, "folio": "LF-0155-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-10-30T02:59:08.720934-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-bod", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 7, "folio": "LF-0155-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T02:59:08.720934-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-bod", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 16:12:41.299132-03'),
	(194, NULL, NULL, 'contratos', '8', 'UPDATE', NULL, '{"id": 8, "folio": "LF-0156-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-10-30T15:05:15.648079-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-50", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 8, "folio": "LF-0156-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T15:05:15.648079-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-50", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 16:12:41.299132-03'),
	(195, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 16:14:11.560629-03'),
	(196, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-11-03 16:14:12.04751-03'),
	(197, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 16:32:09.95047-03'),
	(198, NULL, NULL, 'contratos', '8', 'UPDATE', NULL, '{"id": 8, "folio": "LF-0156-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T15:05:15.648079-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-50", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 8, "folio": "LF-0156-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T15:05:15.648079-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-50", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 16:38:38.980532-03'),
	(199, NULL, NULL, 'contratos', '7', 'UPDATE', NULL, '{"id": 7, "folio": "LF-0155-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T02:59:08.720934-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-bod", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 7, "folio": "LF-0155-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T02:59:08.720934-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-bod", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-10-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 16:38:38.980532-03');
INSERT INTO public.registros_actividad OVERRIDING SYSTEM VALUE VALUES
	(200, NULL, NULL, 'contratos', '6', 'UPDATE', NULL, '{"id": 6, "folio": "LF-0154-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T02:06:43.628927-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": null, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 6, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "mp"}, "plan": "dom-sem", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-04-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 6, "folio": "LF-0154-2026", "estado": "activo", "origen": "web", "creado_en": "2026-10-30T02:06:43.628927-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-10-30", "observaciones": null, "duracion_meses": 6, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "mp"}, "plan": "dom-sem", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-10-30", "fecha_vencimiento": "2027-04-29", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 16:38:38.980532-03'),
	(201, NULL, NULL, 'documentos', '4', 'UPDATE', NULL, '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "firmado", "cliente_id": 6, "firmado_en": "2026-11-03T16:09:55.309744-03:00", "aceptado_en": "2026-10-30T02:59:46.403165-03:00", "aceptado_ip": "::1", "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "hash_firmado": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": "EO-35CC-EC69"}', '{"id": 4, "tipo": "CONTRATO DE SERVICIOS BODEGA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS BODEGA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "firmado", "cliente_id": 6, "firmado_en": "2026-11-03T16:09:55.309744-03:00", "aceptado_en": "2026-10-30T02:59:46.403165-03:00", "aceptado_ip": "::1", "contrato_id": 7, "generado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0155-2026 CONTRATO DE SERVICIOS BODEGA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 2, "publicado_en": "2026-10-30T02:59:08.720934-03:00", "revisado_por": null, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": "EO-35CC-EC69"}', NULL, NULL, '2026-11-03 16:38:38.980532-03'),
	(223, NULL, NULL, 'pagos', '9', 'INSERT', NULL, NULL, '{"id": 9, "cuota": 1, "monto": 3490, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 10, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-11-03 18:13:14.306928-03'),
	(202, NULL, NULL, 'documentos', '3', 'UPDATE', NULL, '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "firmado", "cliente_id": 6, "firmado_en": "2026-11-03T16:10:16.355172-03:00", "aceptado_en": "2026-10-30T02:55:13.481904-03:00", "aceptado_ip": "::1", "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": null, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": "simulador", "enviado_firma_en": "2026-11-03T16:10:12.142287-03:00", "firma_id_externo": "SIM-3-FA9106", "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": "EO-4F39-0438"}', '{"id": 3, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "firmado", "cliente_id": 6, "firmado_en": "2026-11-03T16:10:16.355172-03:00", "aceptado_en": "2026-10-30T02:55:13.481904-03:00", "aceptado_ip": "::1", "contrato_id": 6, "generado_en": "2026-10-30T02:06:43.628927-03:00", "revisado_en": "2026-10-30T02:53:24.958685-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0154-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-10-30T02:53:24.958685-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": "simulador", "enviado_firma_en": "2026-11-03T16:10:12.142287-03:00", "firma_id_externo": "SIM-3-FA9106", "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": "EO-4F39-0438"}', NULL, NULL, '2026-11-03 16:38:38.980532-03'),
	(203, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 16:44:17.065748-03'),
	(204, NULL, NULL, 'clientes', '6', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:06:52.490014-03'),
	(205, NULL, NULL, 'clientes', '6', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:07:32.799049-03'),
	(206, NULL, NULL, 'clientes', '6', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:08:28.913934-03'),
	(207, NULL, NULL, 'contratos', '9', 'INSERT', NULL, NULL, '{"id": 9, "folio": "LF-0157-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-11-03T18:09:43.703419-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-anual", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 18:09:43.703419-03'),
	(208, NULL, NULL, 'contrato_servicios', '14', 'INSERT', NULL, NULL, '{"id": 14, "orden": 1, "precio": 59990, "ciclo_pago": "ANUAL", "contrato_id": 9, "descripcion": "Domicilio. Tributario, postal y comercial\nRecepción de correspondencia fiscal\nEscaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo\nUso 1 hora semanal de estación de trabajo\nInicio de actividades", "servicio_id": 1}', NULL, NULL, '2026-11-03 18:09:43.703419-03'),
	(209, NULL, NULL, 'pagos', '8', 'INSERT', NULL, NULL, '{"id": 8, "cuota": 1, "monto": 59990, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 9, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-11-03 18:09:43.703419-03'),
	(210, NULL, NULL, 'pagos', '8', 'UPDATE', NULL, '{"id": 8, "cuota": 1, "monto": 59990, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 9, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": null, "respuesta_pasarela": null, "codigo_autorizacion": null}', '{"id": 8, "cuota": 1, "monto": 59990, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 9, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": "SIM-8-576DAF35FAA5", "respuesta_pasarela": null, "codigo_autorizacion": null}', NULL, NULL, '2026-11-03 18:09:43.703419-03'),
	(211, NULL, NULL, 'pagos', '8', 'UPDATE', NULL, '{"id": 8, "cuota": 1, "monto": 59990, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 9, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": "SIM-8-576DAF35FAA5", "respuesta_pasarela": null, "codigo_autorizacion": null}', '{"id": 8, "cuota": 1, "monto": 59990, "estado": "pagado", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": "6623", "fecha_pago": "2026-11-03T18:09:48.767266-03:00", "contrato_id": 9, "documento_id": null, "total_cuotas": 1, "conciliado_en": "2026-11-03T18:09:48.767266-03:00", "id_transaccion": "SIM-8-576DAF35FAA5", "respuesta_pasarela": {"id": "SIM-8-576DAF35FAA5", "fecha": "2026-11-03T21:09:48.769Z", "estado": "AUTHORIZED", "simulador": true, "ultimos_4": "6623", "codigo_autorizacion": "479051"}, "codigo_autorizacion": "479051"}', NULL, NULL, '2026-11-03 18:09:48.767266-03'),
	(212, NULL, NULL, 'contratos', '9', 'UPDATE', NULL, '{"id": 9, "folio": "LF-0157-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-11-03T18:09:43.703419-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-anual", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 9, "folio": "LF-0157-2026", "estado": "activo", "origen": "web", "creado_en": "2026-11-03T18:09:43.703419-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-anual", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 18:09:48.767266-03'),
	(214, NULL, NULL, 'documentos', '5', 'UPDATE', NULL, '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": null, "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-11-03 18:09:48.775735-03'),
	(215, NULL, NULL, 'documento_versiones', '3', 'INSERT', NULL, NULL, '{"id": 3, "version": 1, "generado_en": "2026-11-03T18:09:48.775735-03:00", "hash_sha256": "ba9de79ab2728422adf82735a996f5689de5529f7464309b678a72072face261", "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "documento_id": 5, "generado_por": null}', NULL, NULL, '2026-11-03 18:09:48.775735-03'),
	(216, NULL, NULL, 'documentos', '5', 'UPDATE', NULL, '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-11-03 18:09:48.775735-03'),
	(217, NULL, NULL, 'contratos', '9', 'UPDATE', NULL, '{"id": 9, "folio": "LF-0157-2026", "estado": "activo", "origen": "web", "creado_en": "2026-11-03T18:09:43.703419-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-anual", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 9, "folio": "LF-0157-2026", "estado": "activo", "origen": "web", "creado_en": "2026-11-03T18:09:43.703419-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "dom-anual", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "entrega": {"cuenta": "con_clave", "documentos": [{"tipo": "CONTRATO DE SERVICIOS OFICINA", "publicado": false}]}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 18:09:49.474309-03'),
	(218, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:10:37.486124-03'),
	(219, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:10:47.952479-03'),
	(220, NULL, NULL, 'servicios', '20', 'INSERT', NULL, NULL, '{"id": 20, "tipo": "PRINCIPAL", "activo": true, "codigo": "fir-1", "nombre": "FIRMAS ELECTRÓNICAS · BOLSA · 1 FIRMA AVANZADA", "unidad": null, "incluye_iva": true, "precio_desde": false, "precio_lista": 3490, "descripcion_base": "1 firma electrónica avanzada\nValidez legal Ley 19.799\nFirma desde cualquier dispositivo\nSin ir a notaría", "firmas_incluidas": 0, "campos_formulario": null, "ciclo_pago_defecto": "UNICO"}', NULL, NULL, '2026-11-03 18:13:14.306928-03'),
	(221, NULL, NULL, 'contratos', '10', 'INSERT', NULL, NULL, '{"id": 10, "folio": "LF-0158-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-11-03T18:13:14.306928-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-1", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 18:13:14.306928-03'),
	(222, NULL, NULL, 'contrato_servicios', '15', 'INSERT', NULL, NULL, '{"id": 15, "orden": 1, "precio": 3490, "ciclo_pago": "UNICO", "contrato_id": 10, "descripcion": "1 firma electrónica avanzada\nValidez legal Ley 19.799\nFirma desde cualquier dispositivo\nSin ir a notaría", "servicio_id": 20}', NULL, NULL, '2026-11-03 18:13:14.306928-03'),
	(225, NULL, NULL, 'pagos', '9', 'UPDATE', NULL, '{"id": 9, "cuota": 1, "monto": 3490, "estado": "pendiente", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": null, "fecha_pago": null, "contrato_id": 10, "documento_id": null, "total_cuotas": 1, "conciliado_en": null, "id_transaccion": "SIM-9-F68AAFFE4603", "respuesta_pasarela": null, "codigo_autorizacion": null}', '{"id": 9, "cuota": 1, "monto": 3490, "estado": "pagado", "url_dte": null, "pasarela": "transbank", "tipo_dte": null, "folio_dte": null, "ultimos_4": "6623", "fecha_pago": "2026-11-03T18:13:16.595287-03:00", "contrato_id": 10, "documento_id": null, "total_cuotas": 1, "conciliado_en": "2026-11-03T18:13:16.595287-03:00", "id_transaccion": "SIM-9-F68AAFFE4603", "respuesta_pasarela": {"id": "SIM-9-F68AAFFE4603", "fecha": "2026-11-03T21:13:16.597Z", "estado": "AUTHORIZED", "simulador": true, "ultimos_4": "6623", "codigo_autorizacion": "891599"}, "codigo_autorizacion": "891599"}', NULL, NULL, '2026-11-03 18:13:16.595287-03'),
	(226, NULL, NULL, 'contratos', '10', 'UPDATE', NULL, '{"id": 10, "folio": "LF-0158-2026", "estado": "pendiente", "origen": "web", "creado_en": "2026-11-03T18:13:14.306928-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-1", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 10, "folio": "LF-0158-2026", "estado": "activo", "origen": "web", "creado_en": "2026-11-03T18:13:14.306928-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-1", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 18:13:16.595287-03'),
	(227, NULL, NULL, 'contratos', '10', 'UPDATE', NULL, '{"id": 10, "folio": "LF-0158-2026", "estado": "activo", "origen": "web", "creado_en": "2026-11-03T18:13:14.306928-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-1", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', '{"id": 10, "folio": "LF-0158-2026", "estado": "activo", "origen": "web", "creado_en": "2026-11-03T18:13:14.306928-03:00", "link_pago": null, "cliente_id": 6, "empresa_id": 1, "sucursal_id": 1, "ejecutivo_id": 3, "fecha_inicio": "2026-11-03", "observaciones": null, "duracion_meses": 12, "datos_formulario": {"tienda": {"pago": {"modo": "total", "medio": "tbk"}, "plan": "fir-1", "tipo": "persona", "region": "metropolitana", "empresa": null, "titular": {"rut": "21167684-1", "email": "roger.andres.r@gmail.com", "nombre": "Roger Rosas", "celular": "973421628"}, "nombre_empresa_nueva": null}, "entrega": {"cuenta": "con_clave", "documentos": []}, "respuestas": {}}, "fecha_celebracion": "2026-11-03", "fecha_vencimiento": "2027-11-02", "lugar_celebracion": "Santiago", "contrato_anterior_id": null, "cuenta_recaudacion_id": 1, "renovacion_automatica": true}', NULL, NULL, '2026-11-03 18:13:16.639052-03'),
	(228, 2, NULL, 'documentos', '5', 'UPDATE', NULL, '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "borrador", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": null, "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": null, "estado_cliente": null, "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": "2026-11-03T18:16:04.493632-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": 2, "estado_cliente": null, "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-11-03 18:16:04.493632-03'),
	(229, 2, NULL, 'documentos', '5', 'UPDATE', NULL, '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": "2026-11-03T18:16:04.493632-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": null, "revisado_por": 2, "estado_cliente": null, "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": "2026-11-03T18:16:04.493632-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-11-03T18:16:04.493632-03:00", "revisado_por": 2, "estado_cliente": "por_revisar", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-11-03 18:16:04.493632-03'),
	(230, NULL, NULL, 'documentos', '5', 'UPDATE', NULL, '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": null, "aceptado_ip": null, "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": "2026-11-03T18:16:04.493632-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": null, "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-11-03T18:16:04.493632-03:00", "revisado_por": 2, "estado_cliente": "por_revisar", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": null, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-11-03T18:16:24.506119-03:00", "aceptado_ip": "::1", "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": "2026-11-03T18:16:04.493632-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-11-03T18:16:04.493632-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-11-03 18:16:24.506119-03'),
	(231, NULL, 6, 'documentos', '5', 'UPDATE', 'Aceptado por el cliente (roger.andres.r@gmail.com), versión 1', NULL, NULL, '::1', NULL, '2026-11-03 18:16:24.506119-03'),
	(232, NULL, NULL, 'documentos', '5', 'UPDATE', NULL, '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "aprobado", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-11-03T18:16:24.506119-03:00", "aceptado_ip": "::1", "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": "2026-11-03T18:16:04.493632-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-11-03T18:16:04.493632-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": null, "enviado_firma_en": null, "firma_id_externo": null, "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', '{"id": 5, "tipo": "CONTRATO DE SERVICIOS OFICINA", "datos": {"origen": "word", "plantilla": "CONTRATO DE SERVICIOS OFICINA EASY OFFICE 2026 (1).docx", "respuestas": {}}, "lugar": "Santiago", "estado": "enviado_firma", "cliente_id": 6, "firmado_en": null, "aceptado_en": "2026-11-03T18:16:24.506119-03:00", "aceptado_ip": "::1", "contrato_id": 9, "generado_en": "2026-11-03T18:09:48.775735-03:00", "revisado_en": "2026-11-03T18:16:04.493632-03:00", "servicio_id": null, "url_archivo": "generados/2026/LF-0157-2026 CONTRATO DE SERVICIOS OFICINA_v1.docx", "aceptado_por": "roger.andres.r@gmail.com", "ejecutivo_id": 3, "hash_firmado": null, "plantilla_id": 1, "publicado_en": "2026-11-03T18:16:04.493632-03:00", "revisado_por": 2, "estado_cliente": "aceptado", "archivo_firmado": null, "fecha_documento": null, "firma_proveedor": "simulador", "enviado_firma_en": "2026-11-03T18:16:24.536671-03:00", "firma_id_externo": "SIM-5-155FB7", "version_aceptada": 1, "version_aprobada": null, "requiere_revision": false, "codigo_verificacion": null}', NULL, NULL, '2026-11-03 18:16:24.536671-03'),
	(233, NULL, NULL, 'documento_firmantes', '2', 'INSERT', NULL, NULL, '{"id": 2, "ip": null, "rut": "21167684-1", "email": "roger.andres.r@gmail.com", "orden": 1, "estado": "pendiente", "nombre": "Roger Rosas", "creado_en": "2026-11-03T18:16:24.536671-03:00", "firmado_en": null, "id_externo": "SIM-5-155FB7-F1", "documento_id": 5, "motivo_rechazo": null}', NULL, NULL, '2026-11-03 18:16:24.536671-03'),
	(234, 2, NULL, 'roles', '5', 'INSERT', NULL, NULL, '{"id": 5, "rol": "test"}', NULL, NULL, '2026-11-03 18:24:27.176918-03'),
	(235, 2, NULL, 'roles_permisos', NULL, 'INSERT', NULL, NULL, '{"rol_id": 5, "permisos_id": 5}', NULL, NULL, '2026-11-03 18:24:27.176918-03'),
	(236, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:24:50.04378-03'),
	(237, 2, NULL, 'usuarios', '2', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:25:10.394863-03'),
	(238, 2, NULL, 'usuarios', '2', 'LOGOUT', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:25:22.886696-03'),
	(239, 3, NULL, 'usuarios', '3', 'LOGIN', NULL, NULL, NULL, NULL, NULL, '2026-11-03 18:25:32.061358-03');


--
-- Data for Name: representantes_legales; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.representantes_legales OVERRIDING SYSTEM VALUE VALUES
	(1, '26204447-5', 'JESUS RAMÓN MARCANO JIMENEZ', NULL, NULL, NULL, 'jesus.marcano@ejemplo.test', 2, 1),
	(2, '15378280-6', 'JAVIER IGNACIO GONZALEZ SOISSA', NULL, NULL, NULL, 'javier.gonzalez@ejemplo.test', 3, 1),
	(3, '14144266-K', 'OSCAR CONTRERAS BENAVIDES', NULL, NULL, NULL, 'oscar.contreras@ejemplo.test', 4, 1),
	(4, '21456590-0', 'MATIAS JIMENEZ LEAL', NULL, NULL, NULL, 'matias.jimenez@ejemplo.test', 5, 1),
	(5, '10398885-3', 'MARCO ANTONIO ESCOBAR DONOSO', 'chileno', 'divorciado', 'ingeniero de ejecución', NULL, 6, 1);


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.roles OVERRIDING SYSTEM VALUE VALUES
	(1, 'dueno'),
	(2, 'admin'),
	(3, 'ejecutivo'),
	(4, 'recepcion'),
	(5, 'test');


--
-- Data for Name: roles_permisos; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.roles_permisos VALUES
	(1, 1),
	(2, 1),
	(1, 2),
	(2, 2),
	(1, 3),
	(2, 3),
	(1, 4),
	(2, 4),
	(1, 5),
	(2, 5),
	(1, 6),
	(2, 6),
	(1, 7),
	(2, 7),
	(1, 8),
	(2, 8),
	(1, 9),
	(2, 9),
	(3, 5),
	(3, 6),
	(3, 7),
	(3, 9),
	(4, 8),
	(5, 5);


--
-- Data for Name: servicios; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.servicios OVERRIDING SYSTEM VALUE VALUES
	(3, NULL, 'CREACION DE EMPRESAS', 'PRINCIPAL', 'Constitución empresa en un día, hasta 3 socios
Obtención de rut
Domicilio tributario x 3 meses
Inicio de actividad ante el SII
Inscripción factura electrónica
Gestión conjunta solicitud cuenta emprendedor BancoEstado', 49990, false, NULL, false, 'UNICO', 0, NULL, true),
	(4, NULL, 'WEB MAIL + DOMINIO', 'PRINCIPAL', 'Servicio web mail corporativo 1 GB + dominio x 1 año', 14990, false, NULL, false, 'ANUAL', 0, NULL, true),
	(5, NULL, 'CONTABILIDAD', 'PRINCIPAL', NULL, 15900, true, NULL, false, 'MENSUAL', 0, NULL, true),
	(6, NULL, 'FIRMA ELECTRÓNICA AVANZADA', 'COMPLEMENTARIO', 'Autentificado con Clave Única y Red de Notarios digitales. Trámite 100% online.', 5900, false, 'por firma', false, 'UNICO', 0, NULL, true),
	(7, NULL, 'BOLSA DE 10 FIRMAS ELECTRÓNICAS AVANZADAS', 'COMPLEMENTARIO', 'Autentificado con Clave Única y red de notarios digitales. Vigencia 6 meses, renovables.', 29990, false, 'por bolsa', false, 'UNICO', 0, NULL, true),
	(8, NULL, 'FIRMA ELECTRÓNICA AVANZADA PARA CONTRATOS', 'COMPLEMENTARIO', 'Hasta 3 firmantes. Contratos entre dos partes: laborales, servicios, compraventa, arriendo de vehículo y propiedades, entre otros. Trámite 100% online.', 14900, true, 'por contrato', false, 'UNICO', 0, NULL, true),
	(9, NULL, 'DECLARACIONES JURADAS DE UNA FIRMA', 'COMPLEMENTARIO', NULL, 9900, true, 'por documento', false, 'UNICO', 0, NULL, true),
	(10, NULL, 'DECLARACIONES JURADAS DE DOS FIRMAS', 'COMPLEMENTARIO', NULL, 14900, false, 'por documento', false, 'UNICO', 0, NULL, true),
	(11, NULL, 'PODERES Y AUTORIZACIONES', 'COMPLEMENTARIO', 'Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.', 9900, true, 'por documento', false, 'UNICO', 0, NULL, true),
	(12, NULL, 'CERTIFICACIÓN NOTARIAL', 'COMPLEMENTARIO', 'Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.', 14900, true, 'por documento', false, 'UNICO', 0, NULL, true),
	(13, NULL, 'PROTOCOLIZACIÓN NOTARIAL', 'COMPLEMENTARIO', 'Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.', 14900, true, 'por documento', false, 'UNICO', 0, NULL, true),
	(14, NULL, 'AUTENTIFICACIÓN NOTARIAL', 'COMPLEMENTARIO', 'Según tipo de instrumento. Plazo de 48 horas hábiles y disponibilidad según Red de Notarios Digitales.', 14900, true, 'por documento', false, 'UNICO', 0, NULL, true),
	(15, NULL, 'SERVICIO DE REMUNERACIONES', 'COMPLEMENTARIO', NULL, 14900, true, 'por persona', false, 'MENSUAL', 0, NULL, true),
	(16, NULL, 'IMPRESIÓN/DIGITALIZACIÓN DE DOCUMENTOS', 'COMPLEMENTARIO', NULL, 1900, false, 'por página', false, 'UNICO', 0, NULL, true),
	(1, 'dom-anual', 'DOMICILIO TRIBUTARIO', 'PRINCIPAL', 'Domicilio. Tributario, postal y comercial
Recepción de correspondencia fiscal
Escaneo de 1 página diaria de correspondencia fiscal no acumulable, sin costo
Uso 1 hora semanal de estación de trabajo
Inicio de actividades', 59990, false, NULL, false, 'ANUAL', 0, NULL, true),
	(2, 'dom-bod', 'BODEGA VIRTUAL', 'PRINCIPAL', 'Bodega: 1 Cubo rack para pañol, con acceso Lun a Vie de 10 a 16 horas. Es prohibido almacenar todo tipo de sustancias químicas y/o biológicas; explosivos; residuos contaminantes; combustibles líquidos; gases tóxicos.', 59990, false, NULL, false, 'ANUAL', 0, NULL, true),
	(18, 'dom-sem', 'DOMICILIO TRIBUTARIO · PLAN SEMESTRAL', 'PRINCIPAL', 'Domicilio tributario, postal y comercial x 6 meses
Recepción de correspondencia y oficina de partes
Digitalización y envío de correspondencia fiscal (SII, TGR, Judicial y Dirección del Trabajo)
Inicio de actividad ante el S.I.I.
Firma avanzada del contrato $5.000', 39990, false, NULL, true, 'SEMESTRAL', 0, NULL, true),
	(19, 'fir-50', 'FIRMAS ELECTRÓNICAS · PLAN · 50 FIRMAS AVANZADAS', 'PRINCIPAL', '50 firmas electrónicas avanzadas
Vigencia 12 meses
Recordatorio antes de vencer
Mejor precio por firma', 49990, false, NULL, true, 'ANUAL', 0, NULL, true),
	(20, 'fir-1', 'FIRMAS ELECTRÓNICAS · BOLSA · 1 FIRMA AVANZADA', 'PRINCIPAL', '1 firma electrónica avanzada
Validez legal Ley 19.799
Firma desde cualquier dispositivo
Sin ir a notaría', 3490, false, NULL, true, 'UNICO', 0, NULL, true);


--
-- Data for Name: solicitudes_titular; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: sucursales; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sucursales OVERRIDING SYSTEM VALUE VALUES
	(1, 1, 'La Florida', 1, '271-147', 'LF', 1, 'SAN ANTONIO LA FLORIDA', true),
	(2, 1, 'Valparaíso', 6, '15-12', 'VL', 1, NULL, true),
	(3, 1, 'San Antonio', 8, '267-56', 'SA', NULL, NULL, true);


--
-- Data for Name: ticket_mensajes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ticket_mensajes OVERRIDING SYSTEM VALUE VALUES
	(1, 1, 'cliente', NULL, 'roger.andres.r@gmail.com', 'Necesito ayuda para...', '2026-10-30 03:01:24.7284-03'),
	(2, 1, 'personal', 2, NULL, 'Claro usted tiene que....
..............
se realizaron los cambios que se necesitaban en el documento, cualquier duda puede abrir otro ticket', '2026-10-30 03:02:42.318987-03');


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tickets OVERRIDING SYSTEM VALUE VALUES
	(1, 6, NULL, 'roger.andres.r@gmail.com', 'otro', 'Necesito ayuda para...', 'cerrado', 'Claro usted tiene que....
..............
se realizaron los cambios que se necesitaban en el documento, cualquier duda puede abrir otro ticket', 2, '2026-10-30 03:01:24.7284-03', '2026-10-30 03:02:42.318987-03');


--
-- Data for Name: usuarios; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.usuarios OVERRIDING SYSTEM VALUE VALUES
	(1, 'Diego Muñoz', 'diego.munoz@easyoffice.cl', 2, '$2b$12$lZh8a1Doam2PJo2KNGKiKOMQvMxa5gsAEwA0FnvtcOMCtBiRvRFV6', true, NULL, false, 0, NULL, NULL, '2026-10-27 11:35:30.449926-03'),
	(2, 'Administrador de Prueba', 'admin.prueba@easyoffice.test', 2, '$2b$12$av59bL3V.LKLXRpzcmn1ROHu2pJq40tJZ21u6R876NVTCXtR1IV/G', true, NULL, false, 0, NULL, '2026-11-03 18:25:10.377215-03', '2026-10-27 11:44:17.462602-03'),
	(3, 'Anastacio', 'anastacio@easyoffice.cl', 3, '$2b$12$SHz9khyIH5YqBoTpnnQpAel25.eHoXCPKgM.P2BBcXs/a8RnzmIIK', true, NULL, false, 0, NULL, '2026-11-03 18:25:32.045063-03', '2026-10-30 17:47:03.19099-03');


--
-- Name: alertas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.alertas_id_seq', 40, true);


--
-- Name: carros_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.carros_id_seq', 1, false);


--
-- Name: clausulas_documento_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.clausulas_documento_id_seq', 6, true);


--
-- Name: clientes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.clientes_id_seq', 6, true);


--
-- Name: comunas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.comunas_id_seq', 90, true);


--
-- Name: contrato_servicios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.contrato_servicios_id_seq', 15, true);


--
-- Name: contratos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.contratos_id_seq', 10, true);


--
-- Name: correspondencia_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.correspondencia_id_seq', 1, false);


--
-- Name: cuentas_portal_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.cuentas_portal_id_seq', 1, true);


--
-- Name: cuentas_recaudacion_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.cuentas_recaudacion_id_seq', 2, true);


--
-- Name: direcciones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.direcciones_id_seq', 9, true);


--
-- Name: documento_clausulas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.documento_clausulas_id_seq', 1, false);


--
-- Name: documento_firmantes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.documento_firmantes_id_seq', 2, true);


--
-- Name: documento_partes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.documento_partes_id_seq', 1, false);


--
-- Name: documento_versiones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.documento_versiones_id_seq', 3, true);


--
-- Name: documentos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.documentos_id_seq', 5, true);


--
-- Name: ejecuciones_avisos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ejecuciones_avisos_id_seq', 2, true);


--
-- Name: empresas_emisoras_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.empresas_emisoras_id_seq', 2, true);


--
-- Name: gestiones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gestiones_id_seq', 1, false);


--
-- Name: movimientos_firmas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.movimientos_firmas_id_seq', 1, false);


--
-- Name: pagos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pagos_id_seq', 9, true);


--
-- Name: permisos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.permisos_id_seq', 9, true);


--
-- Name: plantillas_documento_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.plantillas_documento_id_seq', 6, true);


--
-- Name: propietarios_inmueble_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.propietarios_inmueble_id_seq', 1, true);


--
-- Name: prospectos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.prospectos_id_seq', 1, false);


--
-- Name: regiones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.regiones_id_seq', 16, true);


--
-- Name: registros_actividad_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.registros_actividad_id_seq', 239, true);


--
-- Name: representantes_legales_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.representantes_legales_id_seq', 5, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.roles_id_seq', 5, true);


--
-- Name: servicios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.servicios_id_seq', 20, true);


--
-- Name: solicitudes_titular_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.solicitudes_titular_id_seq', 1, false);


--
-- Name: sucursales_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sucursales_id_seq', 3, true);


--
-- Name: ticket_mensajes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ticket_mensajes_id_seq', 2, true);


--
-- Name: tickets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tickets_id_seq', 1, true);


--
-- Name: usuarios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.usuarios_id_seq', 3, true);


--
-- Name: alertas alertas_contrato_id_dias_anticipacion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas
    ADD CONSTRAINT alertas_contrato_id_dias_anticipacion_key UNIQUE (contrato_id, dias_anticipacion);


--
-- Name: alertas alertas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas
    ADD CONSTRAINT alertas_pkey PRIMARY KEY (id);


--
-- Name: carros carros_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carros
    ADD CONSTRAINT carros_pkey PRIMARY KEY (id);


--
-- Name: clausulas_documento clausulas_documento_familia_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clausulas_documento
    ADD CONSTRAINT clausulas_documento_familia_codigo_key UNIQUE (familia, codigo);


--
-- Name: clausulas_documento clausulas_documento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clausulas_documento
    ADD CONSTRAINT clausulas_documento_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_rut_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_rut_key UNIQUE (rut);


--
-- Name: comunas comunas_nombre_comuna_region_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunas
    ADD CONSTRAINT comunas_nombre_comuna_region_id_key UNIQUE (nombre_comuna, region_id);


--
-- Name: comunas comunas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunas
    ADD CONSTRAINT comunas_pkey PRIMARY KEY (id);


--
-- Name: config_alertas config_alertas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_alertas
    ADD CONSTRAINT config_alertas_pkey PRIMARY KEY (dias_anticipacion);


--
-- Name: contrato_servicios contrato_servicios_contrato_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_servicios
    ADD CONSTRAINT contrato_servicios_contrato_id_orden_key UNIQUE (contrato_id, orden);


--
-- Name: contrato_servicios contrato_servicios_contrato_id_servicio_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_servicios
    ADD CONSTRAINT contrato_servicios_contrato_id_servicio_id_key UNIQUE (contrato_id, servicio_id);


--
-- Name: contrato_servicios contrato_servicios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_servicios
    ADD CONSTRAINT contrato_servicios_pkey PRIMARY KEY (id);


--
-- Name: contratos contratos_contrato_anterior_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_contrato_anterior_id_key UNIQUE (contrato_anterior_id);


--
-- Name: contratos contratos_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_folio_key UNIQUE (folio);


--
-- Name: contratos contratos_id_cliente_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_id_cliente_id_key UNIQUE (id, cliente_id);


--
-- Name: contratos contratos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_pkey PRIMARY KEY (id);


--
-- Name: correspondencia correspondencia_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondencia
    ADD CONSTRAINT correspondencia_pkey PRIMARY KEY (id);


--
-- Name: cuentas_portal cuentas_portal_cliente_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_portal
    ADD CONSTRAINT cuentas_portal_cliente_id_email_key UNIQUE (cliente_id, email);


--
-- Name: cuentas_portal cuentas_portal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_portal
    ADD CONSTRAINT cuentas_portal_pkey PRIMARY KEY (id);


--
-- Name: cuentas_recaudacion cuentas_recaudacion_banco_numero_cuenta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_recaudacion
    ADD CONSTRAINT cuentas_recaudacion_banco_numero_cuenta_key UNIQUE (banco, numero_cuenta);


--
-- Name: cuentas_recaudacion cuentas_recaudacion_id_empresa_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_recaudacion
    ADD CONSTRAINT cuentas_recaudacion_id_empresa_id_key UNIQUE (id, empresa_id);


--
-- Name: cuentas_recaudacion cuentas_recaudacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_recaudacion
    ADD CONSTRAINT cuentas_recaudacion_pkey PRIMARY KEY (id);


--
-- Name: direcciones direcciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direcciones
    ADD CONSTRAINT direcciones_pkey PRIMARY KEY (id);


--
-- Name: documento_clausulas documento_clausulas_documento_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_clausulas
    ADD CONSTRAINT documento_clausulas_documento_id_orden_key UNIQUE (documento_id, orden);


--
-- Name: documento_clausulas documento_clausulas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_clausulas
    ADD CONSTRAINT documento_clausulas_pkey PRIMARY KEY (id);


--
-- Name: documento_firmantes documento_firmantes_documento_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_firmantes
    ADD CONSTRAINT documento_firmantes_documento_id_email_key UNIQUE (documento_id, email);


--
-- Name: documento_firmantes documento_firmantes_documento_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_firmantes
    ADD CONSTRAINT documento_firmantes_documento_id_orden_key UNIQUE (documento_id, orden);


--
-- Name: documento_firmantes documento_firmantes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_firmantes
    ADD CONSTRAINT documento_firmantes_pkey PRIMARY KEY (id);


--
-- Name: documento_partes documento_partes_documento_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_partes
    ADD CONSTRAINT documento_partes_documento_id_orden_key UNIQUE (documento_id, orden);


--
-- Name: documento_partes documento_partes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_partes
    ADD CONSTRAINT documento_partes_pkey PRIMARY KEY (id);


--
-- Name: documento_versiones documento_versiones_documento_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_versiones
    ADD CONSTRAINT documento_versiones_documento_id_version_key UNIQUE (documento_id, version);


--
-- Name: documento_versiones documento_versiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_versiones
    ADD CONSTRAINT documento_versiones_pkey PRIMARY KEY (id);


--
-- Name: documentos documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_pkey PRIMARY KEY (id);


--
-- Name: ejecuciones_avisos ejecuciones_avisos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ejecuciones_avisos
    ADD CONSTRAINT ejecuciones_avisos_pkey PRIMARY KEY (id);


--
-- Name: empresas_emisoras empresas_emisoras_nombre_comercial_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas_emisoras
    ADD CONSTRAINT empresas_emisoras_nombre_comercial_key UNIQUE (nombre_comercial);


--
-- Name: empresas_emisoras empresas_emisoras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas_emisoras
    ADD CONSTRAINT empresas_emisoras_pkey PRIMARY KEY (id);


--
-- Name: folios_correlativos folios_correlativos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folios_correlativos
    ADD CONSTRAINT folios_correlativos_pkey PRIMARY KEY (anio);


--
-- Name: gestiones gestiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestiones
    ADD CONSTRAINT gestiones_pkey PRIMARY KEY (id);


--
-- Name: movimientos_firmas movimientos_firmas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_firmas
    ADD CONSTRAINT movimientos_firmas_pkey PRIMARY KEY (id);


--
-- Name: pagos pagos_pasarela_id_transaccion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pasarela_id_transaccion_key UNIQUE (pasarela, id_transaccion);


--
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id);


--
-- Name: permisos permisos_permiso_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permisos
    ADD CONSTRAINT permisos_permiso_key UNIQUE (permiso);


--
-- Name: permisos permisos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permisos
    ADD CONSTRAINT permisos_pkey PRIMARY KEY (id);


--
-- Name: plantilla_planes plantilla_planes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plantilla_planes
    ADD CONSTRAINT plantilla_planes_pkey PRIMARY KEY (plantilla_id, plan_codigo);


--
-- Name: plantillas_documento plantillas_documento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plantillas_documento
    ADD CONSTRAINT plantillas_documento_pkey PRIMARY KEY (id);


--
-- Name: plantillas_documento plantillas_documento_tipo_documento_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plantillas_documento
    ADD CONSTRAINT plantillas_documento_tipo_documento_version_key UNIQUE (tipo_documento, version);


--
-- Name: propietarios_inmueble propietarios_inmueble_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propietarios_inmueble
    ADD CONSTRAINT propietarios_inmueble_pkey PRIMARY KEY (id);


--
-- Name: propietarios_inmueble propietarios_inmueble_rut_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propietarios_inmueble
    ADD CONSTRAINT propietarios_inmueble_rut_key UNIQUE (rut);


--
-- Name: prospectos prospectos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospectos
    ADD CONSTRAINT prospectos_pkey PRIMARY KEY (id);


--
-- Name: regiones regiones_nombre_region_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regiones
    ADD CONSTRAINT regiones_nombre_region_key UNIQUE (nombre_region);


--
-- Name: regiones regiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regiones
    ADD CONSTRAINT regiones_pkey PRIMARY KEY (id);


--
-- Name: registros_actividad registros_actividad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_actividad
    ADD CONSTRAINT registros_actividad_pkey PRIMARY KEY (id);


--
-- Name: representantes_legales representantes_legales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.representantes_legales
    ADD CONSTRAINT representantes_legales_pkey PRIMARY KEY (id);


--
-- Name: representantes_legales representantes_legales_rut_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.representantes_legales
    ADD CONSTRAINT representantes_legales_rut_key UNIQUE (rut);


--
-- Name: roles_permisos roles_permisos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles_permisos
    ADD CONSTRAINT roles_permisos_pkey PRIMARY KEY (rol_id, permisos_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_rol_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_rol_key UNIQUE (rol);


--
-- Name: servicios servicios_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_codigo_key UNIQUE (codigo);


--
-- Name: servicios servicios_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_nombre_key UNIQUE (nombre);


--
-- Name: servicios servicios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_pkey PRIMARY KEY (id);


--
-- Name: solicitudes_titular solicitudes_titular_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_titular
    ADD CONSTRAINT solicitudes_titular_pkey PRIMARY KEY (id);


--
-- Name: sucursales sucursales_empresa_id_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_empresa_id_nombre_key UNIQUE (empresa_id, nombre);


--
-- Name: sucursales sucursales_id_empresa_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_id_empresa_id_key UNIQUE (id, empresa_id);


--
-- Name: sucursales sucursales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_pkey PRIMARY KEY (id);


--
-- Name: sucursales sucursales_prefijo_folio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_prefijo_folio_key UNIQUE (prefijo_folio);


--
-- Name: ticket_mensajes ticket_mensajes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_mensajes
    ADD CONSTRAINT ticket_mensajes_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: ix_alertas_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_alertas_fecha ON public.alertas USING btree (fecha_alerta) WHERE (NOT notificado);


--
-- Name: ix_carros_pendientes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_carros_pendientes ON public.carros USING btree (creado_en) WHERE (convertido_contrato_id IS NULL);


--
-- Name: ix_clientes_direccion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_clientes_direccion ON public.clientes USING btree (direccion_id);


--
-- Name: ix_clientes_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_clientes_email ON public.clientes USING btree (email);


--
-- Name: ix_clientes_razon_social; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_clientes_razon_social ON public.clientes USING btree (lower(razon_social));


--
-- Name: ix_clientes_registrado_por; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_clientes_registrado_por ON public.clientes USING btree (registrado_por);


--
-- Name: ix_clientes_representante; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_clientes_representante ON public.clientes USING btree (representante_legal_id);


--
-- Name: ix_clientes_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_clientes_tipo ON public.clientes USING btree (tipo_persona);


--
-- Name: ix_comunas_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_comunas_region ON public.comunas USING btree (region_id);


--
-- Name: ix_contrato_servicios_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_contrato_servicios_servicio ON public.contrato_servicios USING btree (servicio_id);


--
-- Name: ix_contratos_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_contratos_cliente ON public.contratos USING btree (cliente_id);


--
-- Name: ix_contratos_ejecutivo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_contratos_ejecutivo ON public.contratos USING btree (ejecutivo_id);


--
-- Name: ix_contratos_sucursal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_contratos_sucursal ON public.contratos USING btree (sucursal_id);


--
-- Name: ix_contratos_vencimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_contratos_vencimiento ON public.contratos USING btree (fecha_vencimiento) WHERE (estado = 'activo'::text);


--
-- Name: ix_correspondencia_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_correspondencia_cliente ON public.correspondencia USING btree (cliente_id, recibida_en DESC);


--
-- Name: ix_correspondencia_pendiente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_correspondencia_pendiente ON public.correspondencia USING btree (plazo_en) WHERE (estado = 'recibida'::text);


--
-- Name: ix_cuentas_portal_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_cuentas_portal_email ON public.cuentas_portal USING btree (email);


--
-- Name: ix_direcciones_comuna; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_direcciones_comuna ON public.direcciones USING btree (comuna_id);


--
-- Name: ix_documento_firmantes_externo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_documento_firmantes_externo ON public.documento_firmantes USING btree (id_externo) WHERE (id_externo IS NOT NULL);


--
-- Name: ix_documentos_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_documentos_cliente ON public.documentos USING btree (cliente_id);


--
-- Name: ix_documentos_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_documentos_contrato ON public.documentos USING btree (contrato_id);


--
-- Name: ix_documentos_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_documentos_estado ON public.documentos USING btree (estado) WHERE (estado = ANY (ARRAY['en_revision'::text, 'enviado_firma'::text]));


--
-- Name: ix_ejecuciones_avisos_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ejecuciones_avisos_fecha ON public.ejecuciones_avisos USING btree (iniciado_en DESC);


--
-- Name: ix_gestiones_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gestiones_cliente ON public.gestiones USING btree (cliente_id, creado_en DESC);


--
-- Name: ix_gestiones_proxima; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_gestiones_proxima ON public.gestiones USING btree (usuario_id, proxima_accion_en) WHERE (proxima_accion_en IS NOT NULL);


--
-- Name: ix_movimientos_firmas_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_movimientos_firmas_cliente ON public.movimientos_firmas USING btree (cliente_id, creado_en);


--
-- Name: ix_pagos_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pagos_contrato ON public.pagos USING btree (contrato_id);


--
-- Name: ix_pagos_documento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_pagos_documento ON public.pagos USING btree (documento_id);


--
-- Name: ix_plantilla_planes_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_plantilla_planes_plan ON public.plantilla_planes USING btree (plan_codigo);


--
-- Name: ix_prospectos_asignado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_prospectos_asignado ON public.prospectos USING btree (asignado_a);


--
-- Name: ix_prospectos_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_prospectos_estado ON public.prospectos USING btree (estado, creado_en DESC);


--
-- Name: ix_registros_actividad_accion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_registros_actividad_accion ON public.registros_actividad USING btree (accion, fecha DESC);


--
-- Name: ix_registros_actividad_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_registros_actividad_cliente ON public.registros_actividad USING btree (cliente_id, fecha DESC) WHERE (cliente_id IS NOT NULL);


--
-- Name: ix_registros_actividad_tabla; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_registros_actividad_tabla ON public.registros_actividad USING btree (tabla_afectada, registro_id, fecha DESC);


--
-- Name: ix_registros_actividad_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_registros_actividad_usuario ON public.registros_actividad USING btree (usuario_id, fecha DESC);


--
-- Name: ix_representantes_direccion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_representantes_direccion ON public.representantes_legales USING btree (direccion_id);


--
-- Name: ix_representantes_registrado_por; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_representantes_registrado_por ON public.representantes_legales USING btree (registrado_por);


--
-- Name: ix_roles_permisos_permiso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_roles_permisos_permiso ON public.roles_permisos USING btree (permisos_id);


--
-- Name: ix_solicitudes_titular_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_solicitudes_titular_estado ON public.solicitudes_titular USING btree (estado, plazo_en);


--
-- Name: ix_ticket_mensajes_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ticket_mensajes_ticket ON public.ticket_mensajes USING btree (ticket_id, id);


--
-- Name: ix_tickets_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tickets_cliente ON public.tickets USING btree (cliente_id);


--
-- Name: ix_tickets_documento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tickets_documento ON public.tickets USING btree (documento_id);


--
-- Name: ix_tickets_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_tickets_estado ON public.tickets USING btree (estado, creado_en DESC);


--
-- Name: ix_usuarios_rol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_usuarios_rol ON public.usuarios USING btree (rol_id);


--
-- Name: ux_direcciones_completa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_direcciones_completa ON public.direcciones USING btree (lower(calle), numero, COALESCE(lower(complemento), ''::text), comuna_id);


--
-- Name: ux_documentos_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_documentos_codigo ON public.documentos USING btree (codigo_verificacion) WHERE (codigo_verificacion IS NOT NULL);


--
-- Name: ux_movimientos_firmas_consumo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_movimientos_firmas_consumo ON public.movimientos_firmas USING btree (documento_id) WHERE (motivo = 'consumo'::text);


--
-- Name: ux_pagos_cuota_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_pagos_cuota_contrato ON public.pagos USING btree (contrato_id, cuota) WHERE ((contrato_id IS NOT NULL) AND (estado = ANY (ARRAY['pendiente'::text, 'pagado'::text])));


--
-- Name: ux_pagos_cuota_documento; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_pagos_cuota_documento ON public.pagos USING btree (documento_id, cuota) WHERE ((documento_id IS NOT NULL) AND (estado = ANY (ARRAY['pendiente'::text, 'pagado'::text])));


--
-- Name: alertas trg_alerta_enviada; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_alerta_enviada BEFORE INSERT OR UPDATE ON public.alertas FOR EACH ROW EXECUTE FUNCTION public.fn_alerta_enviada();


--
-- Name: contratos trg_asignar_folio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_asignar_folio BEFORE INSERT ON public.contratos FOR EACH ROW EXECUTE FUNCTION public.fn_asignar_folio();


--
-- Name: carros trg_auditoria_carros; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_carros AFTER INSERT OR DELETE OR UPDATE ON public.carros FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: clausulas_documento trg_auditoria_clausulas_documento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_clausulas_documento AFTER INSERT OR DELETE OR UPDATE ON public.clausulas_documento FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: clientes trg_auditoria_clientes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_clientes AFTER INSERT OR DELETE OR UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: config_alertas trg_auditoria_config_alertas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_config_alertas AFTER INSERT OR DELETE OR UPDATE ON public.config_alertas FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: contrato_servicios trg_auditoria_contrato_servicios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_contrato_servicios AFTER INSERT OR DELETE OR UPDATE ON public.contrato_servicios FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: contratos trg_auditoria_contratos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_contratos AFTER INSERT OR DELETE OR UPDATE ON public.contratos FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: correspondencia trg_auditoria_correspondencia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_correspondencia AFTER INSERT OR DELETE OR UPDATE ON public.correspondencia FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: cuentas_recaudacion trg_auditoria_cuentas_recaudacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_cuentas_recaudacion AFTER INSERT OR DELETE OR UPDATE ON public.cuentas_recaudacion FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: direcciones trg_auditoria_direcciones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_direcciones AFTER INSERT OR DELETE OR UPDATE ON public.direcciones FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: documento_clausulas trg_auditoria_documento_clausulas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_documento_clausulas AFTER INSERT OR DELETE OR UPDATE ON public.documento_clausulas FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: documento_firmantes trg_auditoria_documento_firmantes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_documento_firmantes AFTER INSERT OR DELETE OR UPDATE ON public.documento_firmantes FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: documento_partes trg_auditoria_documento_partes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_documento_partes AFTER INSERT OR DELETE OR UPDATE ON public.documento_partes FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: documento_versiones trg_auditoria_documento_versiones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_documento_versiones AFTER INSERT OR DELETE OR UPDATE ON public.documento_versiones FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: documentos trg_auditoria_documentos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_documentos AFTER INSERT OR DELETE OR UPDATE ON public.documentos FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: empresas_emisoras trg_auditoria_empresas_emisoras; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_empresas_emisoras AFTER INSERT OR DELETE OR UPDATE ON public.empresas_emisoras FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: gestiones trg_auditoria_gestiones; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_gestiones AFTER INSERT OR DELETE OR UPDATE ON public.gestiones FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: registros_actividad trg_auditoria_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_inmutable BEFORE DELETE OR UPDATE ON public.registros_actividad FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria_inmutable();


--
-- Name: movimientos_firmas trg_auditoria_movimientos_firmas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_movimientos_firmas AFTER INSERT OR DELETE OR UPDATE ON public.movimientos_firmas FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: registros_actividad trg_auditoria_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_no_truncate BEFORE TRUNCATE ON public.registros_actividad FOR EACH STATEMENT EXECUTE FUNCTION public.fn_auditoria_inmutable();


--
-- Name: pagos trg_auditoria_pagos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_pagos AFTER INSERT OR DELETE OR UPDATE ON public.pagos FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: permisos trg_auditoria_permisos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_permisos AFTER INSERT OR DELETE OR UPDATE ON public.permisos FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: plantilla_planes trg_auditoria_plantilla_planes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_plantilla_planes AFTER INSERT OR DELETE OR UPDATE ON public.plantilla_planes FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: plantillas_documento trg_auditoria_plantillas_documento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_plantillas_documento AFTER INSERT OR DELETE OR UPDATE ON public.plantillas_documento FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: propietarios_inmueble trg_auditoria_propietarios_inmueble; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_propietarios_inmueble AFTER INSERT OR DELETE OR UPDATE ON public.propietarios_inmueble FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: prospectos trg_auditoria_prospectos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_prospectos AFTER INSERT OR DELETE OR UPDATE ON public.prospectos FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: representantes_legales trg_auditoria_representantes_legales; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_representantes_legales AFTER INSERT OR DELETE OR UPDATE ON public.representantes_legales FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: roles trg_auditoria_roles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_roles AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: roles_permisos trg_auditoria_roles_permisos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_roles_permisos AFTER INSERT OR DELETE OR UPDATE ON public.roles_permisos FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: servicios trg_auditoria_servicios; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_servicios AFTER INSERT OR DELETE OR UPDATE ON public.servicios FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: solicitudes_titular trg_auditoria_solicitudes_titular; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_solicitudes_titular AFTER INSERT OR DELETE OR UPDATE ON public.solicitudes_titular FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: sucursales trg_auditoria_sucursales; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_sucursales AFTER INSERT OR DELETE OR UPDATE ON public.sucursales FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: ticket_mensajes trg_auditoria_ticket_mensajes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_ticket_mensajes AFTER INSERT OR DELETE OR UPDATE ON public.ticket_mensajes FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: tickets trg_auditoria_tickets; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tickets AFTER INSERT OR DELETE OR UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.fn_registrar_actividad();


--
-- Name: clientes trg_defaults_cliente; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defaults_cliente BEFORE INSERT OR UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.fn_defaults_cliente();


--
-- Name: contratos trg_defaults_contrato; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defaults_contrato BEFORE INSERT ON public.contratos FOR EACH ROW EXECUTE FUNCTION public.fn_defaults_contrato();


--
-- Name: contrato_servicios trg_defaults_contrato_servicio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defaults_contrato_servicio BEFORE INSERT ON public.contrato_servicios FOR EACH ROW EXECUTE FUNCTION public.fn_defaults_contrato_servicio();


--
-- Name: correspondencia trg_defaults_correspondencia; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defaults_correspondencia BEFORE INSERT OR UPDATE ON public.correspondencia FOR EACH ROW EXECUTE FUNCTION public.fn_defaults_correspondencia();


--
-- Name: documentos trg_defaults_documento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_defaults_documento BEFORE INSERT ON public.documentos FOR EACH ROW EXECUTE FUNCTION public.fn_defaults_documento();


--
-- Name: documentos trg_firmas_por_documento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_firmas_por_documento AFTER UPDATE OF estado ON public.documentos FOR EACH ROW EXECUTE FUNCTION public.fn_firmas_por_documento();


--
-- Name: contrato_servicios trg_firmas_por_servicio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_firmas_por_servicio AFTER INSERT ON public.contrato_servicios FOR EACH ROW EXECUTE FUNCTION public.fn_firmas_por_servicio();


--
-- Name: contratos trg_generar_alertas; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_generar_alertas AFTER INSERT OR UPDATE OF fecha_vencimiento ON public.contratos FOR EACH ROW EXECUTE FUNCTION public.fn_generar_alertas();


--
-- Name: alertas alertas_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas
    ADD CONSTRAINT alertas_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: carros carros_convertido_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carros
    ADD CONSTRAINT carros_convertido_contrato_id_fkey FOREIGN KEY (convertido_contrato_id) REFERENCES public.contratos(id);


--
-- Name: carros carros_servicio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carros
    ADD CONSTRAINT carros_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES public.servicios(id);


--
-- Name: clientes clientes_direccion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_direccion_id_fkey FOREIGN KEY (direccion_id) REFERENCES public.direcciones(id);


--
-- Name: clientes clientes_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: clientes clientes_representante_legal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_representante_legal_id_fkey FOREIGN KEY (representante_legal_id) REFERENCES public.representantes_legales(id);


--
-- Name: comunas comunas_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunas
    ADD CONSTRAINT comunas_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.regiones(id);


--
-- Name: contrato_servicios contrato_servicios_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_servicios
    ADD CONSTRAINT contrato_servicios_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: contrato_servicios contrato_servicios_servicio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_servicios
    ADD CONSTRAINT contrato_servicios_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES public.servicios(id);


--
-- Name: contratos contratos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: contratos contratos_contrato_anterior_id_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_contrato_anterior_id_cliente_id_fkey FOREIGN KEY (contrato_anterior_id, cliente_id) REFERENCES public.contratos(id, cliente_id);


--
-- Name: contratos contratos_cuenta_recaudacion_id_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_cuenta_recaudacion_id_empresa_id_fkey FOREIGN KEY (cuenta_recaudacion_id, empresa_id) REFERENCES public.cuentas_recaudacion(id, empresa_id);


--
-- Name: contratos contratos_ejecutivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_ejecutivo_id_fkey FOREIGN KEY (ejecutivo_id) REFERENCES public.usuarios(id);


--
-- Name: contratos contratos_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas_emisoras(id);


--
-- Name: contratos contratos_sucursal_id_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_sucursal_id_empresa_id_fkey FOREIGN KEY (sucursal_id, empresa_id) REFERENCES public.sucursales(id, empresa_id);


--
-- Name: correspondencia correspondencia_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondencia
    ADD CONSTRAINT correspondencia_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: correspondencia correspondencia_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondencia
    ADD CONSTRAINT correspondencia_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: correspondencia correspondencia_sucursal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correspondencia
    ADD CONSTRAINT correspondencia_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES public.sucursales(id);


--
-- Name: cuentas_portal cuentas_portal_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_portal
    ADD CONSTRAINT cuentas_portal_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: cuentas_portal cuentas_portal_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_portal
    ADD CONSTRAINT cuentas_portal_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: cuentas_recaudacion cuentas_recaudacion_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas_recaudacion
    ADD CONSTRAINT cuentas_recaudacion_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas_emisoras(id);


--
-- Name: direcciones direcciones_comuna_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direcciones
    ADD CONSTRAINT direcciones_comuna_id_fkey FOREIGN KEY (comuna_id) REFERENCES public.comunas(id);


--
-- Name: documento_clausulas documento_clausulas_clausula_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_clausulas
    ADD CONSTRAINT documento_clausulas_clausula_id_fkey FOREIGN KEY (clausula_id) REFERENCES public.clausulas_documento(id);


--
-- Name: documento_clausulas documento_clausulas_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_clausulas
    ADD CONSTRAINT documento_clausulas_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: documento_firmantes documento_firmantes_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_firmantes
    ADD CONSTRAINT documento_firmantes_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: documento_partes documento_partes_direccion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_partes
    ADD CONSTRAINT documento_partes_direccion_id_fkey FOREIGN KEY (direccion_id) REFERENCES public.direcciones(id);


--
-- Name: documento_partes documento_partes_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_partes
    ADD CONSTRAINT documento_partes_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: documento_versiones documento_versiones_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_versiones
    ADD CONSTRAINT documento_versiones_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: documento_versiones documento_versiones_generado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_versiones
    ADD CONSTRAINT documento_versiones_generado_por_fkey FOREIGN KEY (generado_por) REFERENCES public.usuarios(id);


--
-- Name: documentos documentos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: documentos documentos_contrato_id_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_contrato_id_cliente_id_fkey FOREIGN KEY (contrato_id, cliente_id) REFERENCES public.contratos(id, cliente_id) ON DELETE CASCADE;


--
-- Name: documentos documentos_ejecutivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_ejecutivo_id_fkey FOREIGN KEY (ejecutivo_id) REFERENCES public.usuarios(id);


--
-- Name: documentos documentos_plantilla_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_plantilla_id_fkey FOREIGN KEY (plantilla_id) REFERENCES public.plantillas_documento(id);


--
-- Name: documentos documentos_revisado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES public.usuarios(id);


--
-- Name: documentos documentos_servicio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT documentos_servicio_id_fkey FOREIGN KEY (servicio_id) REFERENCES public.servicios(id);


--
-- Name: ejecuciones_avisos ejecuciones_avisos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ejecuciones_avisos
    ADD CONSTRAINT ejecuciones_avisos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: empresas_emisoras empresas_emisoras_representante_legal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empresas_emisoras
    ADD CONSTRAINT empresas_emisoras_representante_legal_id_fkey FOREIGN KEY (representante_legal_id) REFERENCES public.representantes_legales(id);


--
-- Name: gestiones gestiones_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestiones
    ADD CONSTRAINT gestiones_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: gestiones gestiones_contrato_id_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestiones
    ADD CONSTRAINT gestiones_contrato_id_cliente_id_fkey FOREIGN KEY (contrato_id, cliente_id) REFERENCES public.contratos(id, cliente_id) ON DELETE CASCADE;


--
-- Name: gestiones gestiones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestiones
    ADD CONSTRAINT gestiones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: movimientos_firmas movimientos_firmas_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_firmas
    ADD CONSTRAINT movimientos_firmas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: movimientos_firmas movimientos_firmas_contrato_id_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_firmas
    ADD CONSTRAINT movimientos_firmas_contrato_id_cliente_id_fkey FOREIGN KEY (contrato_id, cliente_id) REFERENCES public.contratos(id, cliente_id);


--
-- Name: movimientos_firmas movimientos_firmas_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_firmas
    ADD CONSTRAINT movimientos_firmas_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id);


--
-- Name: movimientos_firmas movimientos_firmas_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.movimientos_firmas
    ADD CONSTRAINT movimientos_firmas_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: pagos pagos_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id);


--
-- Name: pagos pagos_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id);


--
-- Name: plantilla_planes plantilla_planes_plantilla_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plantilla_planes
    ADD CONSTRAINT plantilla_planes_plantilla_id_fkey FOREIGN KEY (plantilla_id) REFERENCES public.plantillas_documento(id) ON DELETE CASCADE;


--
-- Name: propietarios_inmueble propietarios_inmueble_direccion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propietarios_inmueble
    ADD CONSTRAINT propietarios_inmueble_direccion_id_fkey FOREIGN KEY (direccion_id) REFERENCES public.direcciones(id);


--
-- Name: propietarios_inmueble propietarios_inmueble_representante_legal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.propietarios_inmueble
    ADD CONSTRAINT propietarios_inmueble_representante_legal_id_fkey FOREIGN KEY (representante_legal_id) REFERENCES public.representantes_legales(id);


--
-- Name: prospectos prospectos_asignado_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospectos
    ADD CONSTRAINT prospectos_asignado_a_fkey FOREIGN KEY (asignado_a) REFERENCES public.usuarios(id);


--
-- Name: prospectos prospectos_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospectos
    ADD CONSTRAINT prospectos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: registros_actividad registros_actividad_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_actividad
    ADD CONSTRAINT registros_actividad_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: representantes_legales representantes_legales_direccion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.representantes_legales
    ADD CONSTRAINT representantes_legales_direccion_id_fkey FOREIGN KEY (direccion_id) REFERENCES public.direcciones(id);


--
-- Name: representantes_legales representantes_legales_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.representantes_legales
    ADD CONSTRAINT representantes_legales_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id);


--
-- Name: roles_permisos roles_permisos_permisos_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles_permisos
    ADD CONSTRAINT roles_permisos_permisos_id_fkey FOREIGN KEY (permisos_id) REFERENCES public.permisos(id) ON DELETE CASCADE;


--
-- Name: roles_permisos roles_permisos_rol_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles_permisos
    ADD CONSTRAINT roles_permisos_rol_id_fkey FOREIGN KEY (rol_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: solicitudes_titular solicitudes_titular_atendida_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_titular
    ADD CONSTRAINT solicitudes_titular_atendida_por_fkey FOREIGN KEY (atendida_por) REFERENCES public.usuarios(id);


--
-- Name: solicitudes_titular solicitudes_titular_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_titular
    ADD CONSTRAINT solicitudes_titular_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id);


--
-- Name: sucursales sucursales_direccion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_direccion_id_fkey FOREIGN KEY (direccion_id) REFERENCES public.direcciones(id);


--
-- Name: sucursales sucursales_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.empresas_emisoras(id);


--
-- Name: sucursales sucursales_propietario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_propietario_id_fkey FOREIGN KEY (propietario_id) REFERENCES public.propietarios_inmueble(id);


--
-- Name: ticket_mensajes ticket_mensajes_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_mensajes
    ADD CONSTRAINT ticket_mensajes_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_mensajes ticket_mensajes_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_mensajes
    ADD CONSTRAINT ticket_mensajes_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: tickets tickets_atendido_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_atendido_por_fkey FOREIGN KEY (atendido_por) REFERENCES public.usuarios(id);


--
-- Name: tickets tickets_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE SET NULL;


--
-- Name: usuarios usuarios_rol_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_rol_id_fkey FOREIGN KEY (rol_id) REFERENCES public.roles(id);


--
-- Name: alertas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;

--
-- Name: clientes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

--
-- Name: contrato_servicios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contrato_servicios ENABLE ROW LEVEL SECURITY;

--
-- Name: contratos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;

--
-- Name: correspondencia; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.correspondencia ENABLE ROW LEVEL SECURITY;

--
-- Name: cuentas_portal; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cuentas_portal ENABLE ROW LEVEL SECURITY;

--
-- Name: documento_clausulas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documento_clausulas ENABLE ROW LEVEL SECURITY;

--
-- Name: documento_firmantes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documento_firmantes ENABLE ROW LEVEL SECURITY;

--
-- Name: documento_partes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documento_partes ENABLE ROW LEVEL SECURITY;

--
-- Name: documento_versiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documento_versiones ENABLE ROW LEVEL SECURITY;

--
-- Name: documentos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;

--
-- Name: gestiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gestiones ENABLE ROW LEVEL SECURITY;

--
-- Name: movimientos_firmas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.movimientos_firmas ENABLE ROW LEVEL SECURITY;

--
-- Name: alertas p_alertas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_alertas ON public.alertas USING ((EXISTS ( SELECT 1
   FROM public.contratos c
  WHERE (c.id = alertas.contrato_id))));


--
-- Name: clientes p_clientes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_clientes ON public.clientes USING (((registrado_por = public.app_usuario()) OR public.app_es_admin() OR (EXISTS ( SELECT 1
   FROM public.contratos c
  WHERE (c.cliente_id = clientes.id))) OR (EXISTS ( SELECT 1
   FROM public.documentos d
  WHERE (d.cliente_id = clientes.id)))));


--
-- Name: clientes p_clientes_recepcion; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_clientes_recepcion ON public.clientes FOR SELECT USING (public.app_es_recepcion());


--
-- Name: contrato_servicios p_contrato_servicios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_contrato_servicios ON public.contrato_servicios USING ((EXISTS ( SELECT 1
   FROM public.contratos c
  WHERE (c.id = contrato_servicios.contrato_id))));


--
-- Name: contratos p_contratos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_contratos ON public.contratos USING (((ejecutivo_id = public.app_usuario()) OR public.app_es_admin()));


--
-- Name: correspondencia p_correspondencia; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_correspondencia ON public.correspondencia USING ((public.app_es_admin() OR public.app_es_recepcion() OR (EXISTS ( SELECT 1
   FROM public.clientes c
  WHERE (c.id = correspondencia.cliente_id)))));


--
-- Name: cuentas_portal p_cuentas_portal; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_cuentas_portal ON public.cuentas_portal USING ((public.app_es_admin() OR (EXISTS ( SELECT 1
   FROM public.clientes c
  WHERE (c.id = cuentas_portal.cliente_id)))));


--
-- Name: documento_clausulas p_documento_clausulas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_documento_clausulas ON public.documento_clausulas USING ((EXISTS ( SELECT 1
   FROM public.documentos d
  WHERE (d.id = documento_clausulas.documento_id))));


--
-- Name: documento_firmantes p_documento_firmantes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_documento_firmantes ON public.documento_firmantes USING ((EXISTS ( SELECT 1
   FROM public.documentos d
  WHERE (d.id = documento_firmantes.documento_id))));


--
-- Name: documento_partes p_documento_partes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_documento_partes ON public.documento_partes USING ((EXISTS ( SELECT 1
   FROM public.documentos d
  WHERE (d.id = documento_partes.documento_id))));


--
-- Name: documento_versiones p_documento_versiones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_documento_versiones ON public.documento_versiones USING ((EXISTS ( SELECT 1
   FROM public.documentos d
  WHERE (d.id = documento_versiones.documento_id))));


--
-- Name: documentos p_documentos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_documentos ON public.documentos USING (((ejecutivo_id = public.app_usuario()) OR public.app_es_admin() OR ((contrato_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.contratos c
  WHERE (c.id = documentos.contrato_id))))));


--
-- Name: gestiones p_gestiones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_gestiones ON public.gestiones USING ((public.app_es_admin() OR (usuario_id = public.app_usuario()) OR (EXISTS ( SELECT 1
   FROM public.clientes c
  WHERE (c.id = gestiones.cliente_id)))));


--
-- Name: movimientos_firmas p_movimientos_firmas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_movimientos_firmas ON public.movimientos_firmas USING ((public.app_es_admin() OR (EXISTS ( SELECT 1
   FROM public.clientes c
  WHERE (c.id = movimientos_firmas.cliente_id)))));


--
-- Name: pagos p_pagos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_pagos ON public.pagos USING (((EXISTS ( SELECT 1
   FROM public.contratos c
  WHERE (c.id = pagos.contrato_id))) OR (EXISTS ( SELECT 1
   FROM public.documentos d
  WHERE (d.id = pagos.documento_id)))));


--
-- Name: clientes p_portal_clientes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_clientes ON public.clientes FOR SELECT TO rol_portal USING ((id = public.app_cliente()));


--
-- Name: contratos p_portal_contratos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_contratos ON public.contratos FOR SELECT TO rol_portal USING ((cliente_id = public.app_cliente()));


--
-- Name: correspondencia p_portal_correspondencia_leer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_correspondencia_leer ON public.correspondencia FOR UPDATE TO rol_portal USING ((cliente_id = public.app_cliente())) WITH CHECK ((cliente_id = public.app_cliente()));


--
-- Name: correspondencia p_portal_correspondencia_ver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_correspondencia_ver ON public.correspondencia FOR SELECT TO rol_portal USING ((cliente_id = public.app_cliente()));


--
-- Name: documentos p_portal_documentos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_documentos ON public.documentos FOR SELECT TO rol_portal USING ((cliente_id = public.app_cliente()));


--
-- Name: documento_firmantes p_portal_firmantes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_firmantes ON public.documento_firmantes FOR SELECT TO rol_portal USING ((EXISTS ( SELECT 1
   FROM public.documentos d
  WHERE ((d.id = documento_firmantes.documento_id) AND (d.cliente_id = public.app_cliente())))));


--
-- Name: movimientos_firmas p_portal_firmas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_firmas ON public.movimientos_firmas FOR SELECT TO rol_portal USING ((cliente_id = public.app_cliente()));


--
-- Name: solicitudes_titular p_portal_solicitudes_crear; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_solicitudes_crear ON public.solicitudes_titular FOR INSERT TO rol_portal WITH CHECK (((cliente_id = public.app_cliente()) AND (estado = 'recibida'::text)));


--
-- Name: solicitudes_titular p_portal_solicitudes_ver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_solicitudes_ver ON public.solicitudes_titular FOR SELECT TO rol_portal USING ((cliente_id = public.app_cliente()));


--
-- Name: ticket_mensajes p_portal_ticket_mensajes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_ticket_mensajes ON public.ticket_mensajes FOR SELECT TO rol_portal USING ((EXISTS ( SELECT 1
   FROM public.tickets t
  WHERE ((t.id = ticket_mensajes.ticket_id) AND (t.cliente_id = public.app_cliente())))));


--
-- Name: tickets p_portal_tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_portal_tickets ON public.tickets FOR SELECT TO rol_portal USING ((cliente_id = public.app_cliente()));


--
-- Name: prospectos p_prospectos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_prospectos ON public.prospectos USING ((public.app_es_admin() OR (asignado_a = public.app_usuario()) OR (asignado_a IS NULL)));


--
-- Name: representantes_legales p_representantes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_representantes ON public.representantes_legales USING (((registrado_por = public.app_usuario()) OR public.app_es_admin() OR (EXISTS ( SELECT 1
   FROM public.clientes c
  WHERE (c.representante_legal_id = representantes_legales.id))) OR (EXISTS ( SELECT 1
   FROM public.empresas_emisoras e
  WHERE (e.representante_legal_id = representantes_legales.id))) OR (EXISTS ( SELECT 1
   FROM public.propietarios_inmueble p
  WHERE (p.representante_legal_id = representantes_legales.id)))));


--
-- Name: solicitudes_titular p_solicitudes_titular; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_solicitudes_titular ON public.solicitudes_titular USING ((public.app_es_admin() OR (EXISTS ( SELECT 1
   FROM public.clientes c
  WHERE (c.id = solicitudes_titular.cliente_id)))));


--
-- Name: ticket_mensajes p_ticket_mensajes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_ticket_mensajes ON public.ticket_mensajes USING ((EXISTS ( SELECT 1
   FROM public.tickets t
  WHERE (t.id = ticket_mensajes.ticket_id))));


--
-- Name: tickets p_tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY p_tickets ON public.tickets USING ((public.app_es_admin() OR (EXISTS ( SELECT 1
   FROM public.clientes c
  WHERE (c.id = tickets.cliente_id)))));


--
-- Name: pagos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

--
-- Name: prospectos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospectos ENABLE ROW LEVEL SECURITY;

--
-- Name: representantes_legales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.representantes_legales ENABLE ROW LEVEL SECURITY;

--
-- Name: solicitudes_titular; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.solicitudes_titular ENABLE ROW LEVEL SECURITY;

--
-- Name: ticket_mensajes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ticket_mensajes ENABLE ROW LEVEL SECURITY;

--
-- Name: tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE alertas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,UPDATE ON TABLE public.alertas TO rol_ejecutivo;
GRANT ALL ON TABLE public.alertas TO rol_admin;
GRANT SELECT ON TABLE public.alertas TO rol_portal;


--
-- Name: SEQUENCE alertas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.alertas_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.alertas_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.alertas_id_seq TO rol_portal;


--
-- Name: TABLE carros; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,UPDATE ON TABLE public.carros TO rol_ejecutivo;
GRANT ALL ON TABLE public.carros TO rol_admin;


--
-- Name: SEQUENCE carros_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.carros_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.carros_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.carros_id_seq TO rol_portal;


--
-- Name: TABLE clausulas_documento; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.clausulas_documento TO rol_ejecutivo;
GRANT ALL ON TABLE public.clausulas_documento TO rol_admin;
GRANT SELECT ON TABLE public.clausulas_documento TO rol_portal;


--
-- Name: SEQUENCE clausulas_documento_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.clausulas_documento_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.clausulas_documento_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.clausulas_documento_id_seq TO rol_portal;


--
-- Name: TABLE clientes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.clientes TO rol_ejecutivo;
GRANT ALL ON TABLE public.clientes TO rol_admin;
GRANT SELECT ON TABLE public.clientes TO rol_portal;


--
-- Name: SEQUENCE clientes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.clientes_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.clientes_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.clientes_id_seq TO rol_portal;


--
-- Name: TABLE comunas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.comunas TO rol_ejecutivo;
GRANT ALL ON TABLE public.comunas TO rol_admin;
GRANT SELECT ON TABLE public.comunas TO rol_portal;


--
-- Name: SEQUENCE comunas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.comunas_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.comunas_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.comunas_id_seq TO rol_portal;


--
-- Name: TABLE config_alertas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.config_alertas TO rol_ejecutivo;
GRANT ALL ON TABLE public.config_alertas TO rol_admin;


--
-- Name: TABLE contrato_servicios; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.contrato_servicios TO rol_ejecutivo;
GRANT ALL ON TABLE public.contrato_servicios TO rol_admin;
GRANT SELECT ON TABLE public.contrato_servicios TO rol_portal;


--
-- Name: SEQUENCE contrato_servicios_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.contrato_servicios_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.contrato_servicios_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.contrato_servicios_id_seq TO rol_portal;


--
-- Name: TABLE contratos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.contratos TO rol_ejecutivo;
GRANT ALL ON TABLE public.contratos TO rol_admin;
GRANT SELECT ON TABLE public.contratos TO rol_portal;


--
-- Name: SEQUENCE contratos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.contratos_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.contratos_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.contratos_id_seq TO rol_portal;


--
-- Name: TABLE correspondencia; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.correspondencia TO rol_ejecutivo;
GRANT ALL ON TABLE public.correspondencia TO rol_admin;
GRANT SELECT ON TABLE public.correspondencia TO rol_portal;


--
-- Name: COLUMN correspondencia.leida_en; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(leida_en) ON TABLE public.correspondencia TO rol_portal;


--
-- Name: SEQUENCE correspondencia_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.correspondencia_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.correspondencia_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.correspondencia_id_seq TO rol_portal;


--
-- Name: TABLE cuentas_portal; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cuentas_portal TO rol_admin;


--
-- Name: COLUMN cuentas_portal.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.cliente_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(cliente_id),INSERT(cliente_id) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(email),INSERT(email) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.nombre; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(nombre),INSERT(nombre),UPDATE(nombre) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.autorizado; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(autorizado),INSERT(autorizado),UPDATE(autorizado) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.activo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(activo),INSERT(activo),UPDATE(activo) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.clave_definida_en; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(clave_definida_en) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.ultimo_ingreso; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(ultimo_ingreso) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.registrado_por; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(registrado_por) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: COLUMN cuentas_portal.creado_en; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(creado_en) ON TABLE public.cuentas_portal TO rol_ejecutivo;


--
-- Name: SEQUENCE cuentas_portal_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.cuentas_portal_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.cuentas_portal_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.cuentas_portal_id_seq TO rol_portal;


--
-- Name: TABLE cuentas_recaudacion; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.cuentas_recaudacion TO rol_ejecutivo;
GRANT ALL ON TABLE public.cuentas_recaudacion TO rol_admin;
GRANT SELECT ON TABLE public.cuentas_recaudacion TO rol_portal;


--
-- Name: SEQUENCE cuentas_recaudacion_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.cuentas_recaudacion_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.cuentas_recaudacion_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.cuentas_recaudacion_id_seq TO rol_portal;


--
-- Name: TABLE direcciones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.direcciones TO rol_ejecutivo;
GRANT ALL ON TABLE public.direcciones TO rol_admin;
GRANT SELECT ON TABLE public.direcciones TO rol_portal;


--
-- Name: SEQUENCE direcciones_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.direcciones_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.direcciones_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.direcciones_id_seq TO rol_portal;


--
-- Name: TABLE documento_clausulas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documento_clausulas TO rol_ejecutivo;
GRANT ALL ON TABLE public.documento_clausulas TO rol_admin;
GRANT SELECT ON TABLE public.documento_clausulas TO rol_portal;


--
-- Name: SEQUENCE documento_clausulas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.documento_clausulas_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.documento_clausulas_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.documento_clausulas_id_seq TO rol_portal;


--
-- Name: TABLE documento_firmantes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documento_firmantes TO rol_ejecutivo;
GRANT ALL ON TABLE public.documento_firmantes TO rol_admin;
GRANT SELECT ON TABLE public.documento_firmantes TO rol_portal;


--
-- Name: SEQUENCE documento_firmantes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.documento_firmantes_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.documento_firmantes_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.documento_firmantes_id_seq TO rol_portal;


--
-- Name: TABLE documento_partes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documento_partes TO rol_ejecutivo;
GRANT ALL ON TABLE public.documento_partes TO rol_admin;
GRANT SELECT ON TABLE public.documento_partes TO rol_portal;


--
-- Name: SEQUENCE documento_partes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.documento_partes_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.documento_partes_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.documento_partes_id_seq TO rol_portal;


--
-- Name: TABLE documento_versiones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documento_versiones TO rol_ejecutivo;
GRANT ALL ON TABLE public.documento_versiones TO rol_admin;
GRANT SELECT ON TABLE public.documento_versiones TO rol_portal;


--
-- Name: SEQUENCE documento_versiones_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.documento_versiones_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.documento_versiones_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.documento_versiones_id_seq TO rol_portal;


--
-- Name: TABLE documentos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documentos TO rol_ejecutivo;
GRANT ALL ON TABLE public.documentos TO rol_admin;
GRANT SELECT ON TABLE public.documentos TO rol_portal;


--
-- Name: SEQUENCE documentos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.documentos_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.documentos_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.documentos_id_seq TO rol_portal;


--
-- Name: TABLE ejecuciones_avisos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ejecuciones_avisos TO rol_admin;


--
-- Name: SEQUENCE ejecuciones_avisos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.ejecuciones_avisos_id_seq TO rol_admin;


--
-- Name: TABLE empresas_emisoras; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.empresas_emisoras TO rol_ejecutivo;
GRANT ALL ON TABLE public.empresas_emisoras TO rol_admin;
GRANT SELECT ON TABLE public.empresas_emisoras TO rol_portal;


--
-- Name: SEQUENCE empresas_emisoras_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.empresas_emisoras_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.empresas_emisoras_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.empresas_emisoras_id_seq TO rol_portal;


--
-- Name: TABLE folios_correlativos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.folios_correlativos TO rol_admin;


--
-- Name: TABLE gestiones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.gestiones TO rol_ejecutivo;
GRANT ALL ON TABLE public.gestiones TO rol_admin;


--
-- Name: SEQUENCE gestiones_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.gestiones_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.gestiones_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.gestiones_id_seq TO rol_portal;


--
-- Name: TABLE movimientos_firmas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.movimientos_firmas TO rol_ejecutivo;
GRANT ALL ON TABLE public.movimientos_firmas TO rol_admin;
GRANT SELECT ON TABLE public.movimientos_firmas TO rol_portal;


--
-- Name: SEQUENCE movimientos_firmas_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.movimientos_firmas_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.movimientos_firmas_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.movimientos_firmas_id_seq TO rol_portal;


--
-- Name: TABLE pagos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.pagos TO rol_ejecutivo;
GRANT ALL ON TABLE public.pagos TO rol_admin;
GRANT SELECT ON TABLE public.pagos TO rol_portal;


--
-- Name: SEQUENCE pagos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.pagos_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.pagos_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.pagos_id_seq TO rol_portal;


--
-- Name: TABLE permisos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.permisos TO rol_ejecutivo;
GRANT ALL ON TABLE public.permisos TO rol_admin;


--
-- Name: SEQUENCE permisos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.permisos_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.permisos_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.permisos_id_seq TO rol_portal;


--
-- Name: TABLE plantilla_planes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.plantilla_planes TO rol_ejecutivo;
GRANT ALL ON TABLE public.plantilla_planes TO rol_admin;


--
-- Name: TABLE plantillas_documento; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.plantillas_documento TO rol_ejecutivo;
GRANT ALL ON TABLE public.plantillas_documento TO rol_admin;
GRANT SELECT ON TABLE public.plantillas_documento TO rol_portal;


--
-- Name: SEQUENCE plantillas_documento_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.plantillas_documento_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.plantillas_documento_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.plantillas_documento_id_seq TO rol_portal;


--
-- Name: TABLE propietarios_inmueble; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.propietarios_inmueble TO rol_ejecutivo;
GRANT ALL ON TABLE public.propietarios_inmueble TO rol_admin;
GRANT SELECT ON TABLE public.propietarios_inmueble TO rol_portal;


--
-- Name: SEQUENCE propietarios_inmueble_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.propietarios_inmueble_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.propietarios_inmueble_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.propietarios_inmueble_id_seq TO rol_portal;


--
-- Name: TABLE prospectos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.prospectos TO rol_ejecutivo;
GRANT ALL ON TABLE public.prospectos TO rol_admin;


--
-- Name: SEQUENCE prospectos_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.prospectos_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.prospectos_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.prospectos_id_seq TO rol_portal;


--
-- Name: TABLE regiones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.regiones TO rol_ejecutivo;
GRANT ALL ON TABLE public.regiones TO rol_admin;
GRANT SELECT ON TABLE public.regiones TO rol_portal;


--
-- Name: SEQUENCE regiones_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.regiones_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.regiones_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.regiones_id_seq TO rol_portal;


--
-- Name: TABLE registros_actividad; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.registros_actividad TO rol_admin;


--
-- Name: SEQUENCE registros_actividad_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.registros_actividad_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.registros_actividad_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.registros_actividad_id_seq TO rol_portal;


--
-- Name: TABLE representantes_legales; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.representantes_legales TO rol_ejecutivo;
GRANT ALL ON TABLE public.representantes_legales TO rol_admin;
GRANT SELECT ON TABLE public.representantes_legales TO rol_portal;


--
-- Name: SEQUENCE representantes_legales_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.representantes_legales_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.representantes_legales_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.representantes_legales_id_seq TO rol_portal;


--
-- Name: TABLE roles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.roles TO rol_ejecutivo;
GRANT ALL ON TABLE public.roles TO rol_admin;


--
-- Name: SEQUENCE roles_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.roles_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.roles_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.roles_id_seq TO rol_portal;


--
-- Name: TABLE roles_permisos; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.roles_permisos TO rol_ejecutivo;
GRANT ALL ON TABLE public.roles_permisos TO rol_admin;


--
-- Name: TABLE servicios; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.servicios TO rol_ejecutivo;
GRANT ALL ON TABLE public.servicios TO rol_admin;
GRANT SELECT ON TABLE public.servicios TO rol_portal;


--
-- Name: SEQUENCE servicios_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.servicios_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.servicios_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.servicios_id_seq TO rol_portal;


--
-- Name: TABLE solicitudes_titular; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.solicitudes_titular TO rol_ejecutivo;
GRANT ALL ON TABLE public.solicitudes_titular TO rol_admin;
GRANT SELECT ON TABLE public.solicitudes_titular TO rol_portal;


--
-- Name: COLUMN solicitudes_titular.cliente_id; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(cliente_id) ON TABLE public.solicitudes_titular TO rol_portal;


--
-- Name: COLUMN solicitudes_titular.email; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(email) ON TABLE public.solicitudes_titular TO rol_portal;


--
-- Name: COLUMN solicitudes_titular.tipo; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(tipo) ON TABLE public.solicitudes_titular TO rol_portal;


--
-- Name: COLUMN solicitudes_titular.detalle; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT(detalle) ON TABLE public.solicitudes_titular TO rol_portal;


--
-- Name: SEQUENCE solicitudes_titular_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.solicitudes_titular_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.solicitudes_titular_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.solicitudes_titular_id_seq TO rol_portal;


--
-- Name: TABLE sucursales; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.sucursales TO rol_ejecutivo;
GRANT ALL ON TABLE public.sucursales TO rol_admin;
GRANT SELECT ON TABLE public.sucursales TO rol_portal;


--
-- Name: SEQUENCE sucursales_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.sucursales_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.sucursales_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.sucursales_id_seq TO rol_portal;


--
-- Name: TABLE ticket_mensajes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.ticket_mensajes TO rol_ejecutivo;
GRANT ALL ON TABLE public.ticket_mensajes TO rol_admin;
GRANT SELECT ON TABLE public.ticket_mensajes TO rol_portal;


--
-- Name: SEQUENCE ticket_mensajes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.ticket_mensajes_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.ticket_mensajes_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.ticket_mensajes_id_seq TO rol_portal;


--
-- Name: TABLE tickets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.tickets TO rol_ejecutivo;
GRANT ALL ON TABLE public.tickets TO rol_admin;
GRANT SELECT ON TABLE public.tickets TO rol_portal;


--
-- Name: COLUMN tickets.estado; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(estado) ON TABLE public.tickets TO rol_ejecutivo;


--
-- Name: COLUMN tickets.respuesta; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(respuesta) ON TABLE public.tickets TO rol_ejecutivo;


--
-- Name: COLUMN tickets.atendido_por; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(atendido_por) ON TABLE public.tickets TO rol_ejecutivo;


--
-- Name: COLUMN tickets.actualizado_en; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(actualizado_en) ON TABLE public.tickets TO rol_ejecutivo;


--
-- Name: SEQUENCE tickets_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.tickets_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.tickets_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.tickets_id_seq TO rol_portal;


--
-- Name: TABLE usuarios; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usuarios TO rol_admin;


--
-- Name: COLUMN usuarios.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.usuarios TO rol_ejecutivo;


--
-- Name: COLUMN usuarios.nombre; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(nombre) ON TABLE public.usuarios TO rol_ejecutivo;


--
-- Name: COLUMN usuarios.email; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(email) ON TABLE public.usuarios TO rol_ejecutivo;


--
-- Name: COLUMN usuarios.rol_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(rol_id) ON TABLE public.usuarios TO rol_ejecutivo;


--
-- Name: COLUMN usuarios.activo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(activo) ON TABLE public.usuarios TO rol_ejecutivo;


--
-- Name: SEQUENCE usuarios_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.usuarios_id_seq TO rol_ejecutivo;
GRANT SELECT,USAGE ON SEQUENCE public.usuarios_id_seq TO rol_admin;
GRANT SELECT,USAGE ON SEQUENCE public.usuarios_id_seq TO rol_portal;


--
-- Name: TABLE v_datos_contrato; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_datos_contrato TO rol_ejecutivo;
GRANT ALL ON TABLE public.v_datos_contrato TO rol_admin;
GRANT SELECT ON TABLE public.v_datos_contrato TO rol_portal;


--
-- Name: TABLE v_datos_contrato_servicios; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_datos_contrato_servicios TO rol_ejecutivo;
GRANT ALL ON TABLE public.v_datos_contrato_servicios TO rol_admin;
GRANT SELECT ON TABLE public.v_datos_contrato_servicios TO rol_portal;


--
-- Name: TABLE v_estado_renovacion; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_estado_renovacion TO rol_ejecutivo;
GRANT ALL ON TABLE public.v_estado_renovacion TO rol_admin;
GRANT SELECT ON TABLE public.v_estado_renovacion TO rol_portal;


--
-- Name: TABLE v_saldo_contrato; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_saldo_contrato TO rol_ejecutivo;
GRANT ALL ON TABLE public.v_saldo_contrato TO rol_admin;
GRANT SELECT ON TABLE public.v_saldo_contrato TO rol_portal;


--
-- Name: TABLE v_saldo_firmas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_saldo_firmas TO rol_ejecutivo;
GRANT ALL ON TABLE public.v_saldo_firmas TO rol_admin;
GRANT SELECT ON TABLE public.v_saldo_firmas TO rol_portal;


--
-- PostgreSQL database dump complete
--

COMMIT;

-- El volcado deja search_path vacío en esta sesión: se vuelve al normal
SET search_path TO "$user", public;
