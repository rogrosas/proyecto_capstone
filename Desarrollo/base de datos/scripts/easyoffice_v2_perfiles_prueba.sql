-- =====================================================================
-- EASY OFFICE · Perfiles de prueba: dueño, ejecutivo y persona natural
-- Para pegar y ejecutar completo en el SQL Editor de Neon (o con psql)
-- sobre una base creada con easyoffice_v2.sql.
--
--   Dueño           → /crm        usuario con rol "dueno" (todos los permisos)
--   Ejecutivo       → /crm        usuario con rol "ejecutivo"
--   Persona natural → /mi-cuenta  (elegir "Persona") cliente natural con contraseña,
--                                  a cargo del ejecutivo
--
-- Las contraseñas se generan al azar y se guardan solo como hash bcrypt
-- (pgcrypto, compatible con bcryptjs de la aplicación). Se muestran UNA vez
-- en la tabla de resultado del final: cópielas en credenciales-demo.txt.
--
-- Se puede ejecutar varias veces: un perfil que ya existe no se toca.
-- Para generar contraseñas nuevas cambie  restablecer := true  más abajo.
-- Para cambiar nombres, correos o el RUT edite las variables del bloque DO.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS pg_temp.perfiles_creados;
CREATE TEMP TABLE perfiles_creados (
    orden int, perfil text, ingreso text, correo text, contrasena text, estado text
);

DO $$
DECLARE
    -- ---------- Datos de los perfiles (editables) ----------
    restablecer    boolean := false;   -- true: contraseña nueva para los perfiles que ya existen

    dueno_nombre   text := 'Perfil Dueño';
    dueno_email    text := 'perfil.dueno@easyoffice.test';
    ejec_nombre    text := 'Perfil Ejecutivo';
    ejec_email     text := 'perfil.ejecutivo@easyoffice.test';
    pers_rut       text := '17345678-6';                 -- debe tener dígito verificador válido
    pers_nombre    text := 'PERFIL PERSONA NATURAL';     -- nombre completo (razon_social)
    pers_email     text := 'perfil.persona@easyoffice.test';
    pers_celular   text := '912345678';                  -- 9 dígitos, empieza en 9
    pers_giro      text := 'SERVICIOS PROFESIONALES';
    -- --------------------------------------------------------

    v_rol_dueno int; v_rol_ejec int;
    v_dueno int; v_ejec int; v_cliente int; v_tipo text;
    v_clave text; v_estado text; v_con_clave boolean; v_email text;
BEGIN
    SELECT id INTO v_rol_dueno FROM roles WHERE rol = 'dueno';
    SELECT id INTO v_rol_ejec  FROM roles WHERE rol = 'ejecutivo';
    IF v_rol_dueno IS NULL OR v_rol_ejec IS NULL THEN
        RAISE EXCEPTION 'Faltan los roles "dueno" o "ejecutivo" en la tabla roles. Cargue primero easyoffice_v2.sql.';
    END IF;
    IF NOT fn_rut_valido(pers_rut) THEN
        RAISE EXCEPTION 'El RUT % no es válido (revise el dígito verificador).', pers_rut;
    END IF;

    -- ===== 1. Dueño =====
    SELECT id INTO v_dueno FROM usuarios WHERE email = dueno_email;
    v_clave := NULL; v_estado := 'ya existía (sin cambios)';
    IF v_dueno IS NULL THEN
        v_clave := translate(encode(gen_random_bytes(11), 'base64'), '+/=0O1lI', 'xyzabcde');
        INSERT INTO usuarios (nombre, email, rol_id, password_hash)
        VALUES (dueno_nombre, dueno_email, v_rol_dueno, crypt(v_clave, gen_salt('bf', 12)))
        RETURNING id INTO v_dueno;
        v_estado := 'creado';
    ELSIF restablecer THEN
        v_clave := translate(encode(gen_random_bytes(11), 'base64'), '+/=0O1lI', 'xyzabcde');
        UPDATE usuarios SET password_hash = crypt(v_clave, gen_salt('bf', 12)), rol_id = v_rol_dueno,
               activo = true, intentos_fallidos = 0, bloqueado_hasta = NULL
         WHERE id = v_dueno;
        v_estado := 'contraseña restablecida';
    END IF;
    INSERT INTO perfiles_creados VALUES (1, 'Dueño (rol dueno)', '/crm', dueno_email, v_clave, v_estado);

    -- La auditoría y registrado_por quedan a nombre del dueño
    PERFORM set_config('app.usuario_actual', v_dueno::text, true),
            set_config('app.rol_actual', 'dueno', true);

    -- ===== 2. Ejecutivo =====
    SELECT id INTO v_ejec FROM usuarios WHERE email = ejec_email;
    v_clave := NULL; v_estado := 'ya existía (sin cambios)';
    IF v_ejec IS NULL THEN
        v_clave := translate(encode(gen_random_bytes(11), 'base64'), '+/=0O1lI', 'xyzabcde');
        INSERT INTO usuarios (nombre, email, rol_id, password_hash)
        VALUES (ejec_nombre, ejec_email, v_rol_ejec, crypt(v_clave, gen_salt('bf', 12)))
        RETURNING id INTO v_ejec;
        v_estado := 'creado';
    ELSIF restablecer THEN
        v_clave := translate(encode(gen_random_bytes(11), 'base64'), '+/=0O1lI', 'xyzabcde');
        UPDATE usuarios SET password_hash = crypt(v_clave, gen_salt('bf', 12)), rol_id = v_rol_ejec,
               activo = true, intentos_fallidos = 0, bloqueado_hasta = NULL
         WHERE id = v_ejec;
        v_estado := 'contraseña restablecida';
    END IF;
    INSERT INTO perfiles_creados VALUES (2, 'Ejecutivo (rol ejecutivo)', '/crm', ejec_email, v_clave, v_estado);

    -- ===== 3. Persona natural (cliente + acceso a /mi-cuenta) =====
    SELECT id, tipo_persona, email INTO v_cliente, v_tipo, v_email FROM clientes WHERE rut = pers_rut;
    IF v_cliente IS NOT NULL AND v_tipo <> 'natural' THEN
        RAISE EXCEPTION 'El RUT % ya es de un cliente persona jurídica. Use otro RUT.', pers_rut;
    END IF;
    v_estado := 'ya existía (sin cambios)';
    IF v_cliente IS NULL THEN
        INSERT INTO clientes (rut, tipo_persona, razon_social, giro_principal, email, celular,
                              origen, registrado_por)
        VALUES (pers_rut, 'natural', pers_nombre, pers_giro, pers_email, pers_celular,
                'crm', v_dueno)
        RETURNING id, email INTO v_cliente, v_email;
        v_estado := 'creado';
        -- Ejecutivo a cargo: la columna existe desde easyoffice_v2_cartera.sql
        IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = 'clientes'
                      AND column_name = 'ejecutivo_id') THEN
            EXECUTE 'UPDATE clientes SET ejecutivo_id = $1 WHERE id = $2' USING v_ejec, v_cliente;
        ELSE
            RAISE NOTICE 'Sin clientes.ejecutivo_id (falta easyoffice_v2_cartera.sql): el cliente no queda a cargo del ejecutivo.';
        END IF;
    END IF;
    IF v_email IS NULL THEN
        RAISE EXCEPTION 'El cliente % no tiene correo: la persona natural ingresa con clientes.email.', pers_rut;
    END IF;

    -- La persona natural entra con el correo del cliente; su contraseña va en cuentas_portal
    SELECT password_hash IS NOT NULL INTO v_con_clave
      FROM cuentas_portal WHERE cliente_id = v_cliente AND email = v_email;
    v_clave := NULL;
    IF v_con_clave IS DISTINCT FROM true OR restablecer THEN
        v_clave := translate(encode(gen_random_bytes(11), 'base64'), '+/=0O1lI', 'xyzabcde');
        INSERT INTO cuentas_portal (cliente_id, email, password_hash, clave_definida_en, activo, registrado_por)
        VALUES (v_cliente, v_email, crypt(v_clave, gen_salt('bf', 12)), now(), true, v_dueno)
        ON CONFLICT (cliente_id, email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash, clave_definida_en = now(), activo = true;
        IF v_estado <> 'creado' THEN v_estado := 'contraseña restablecida'; END IF;
    END IF;
    INSERT INTO perfiles_creados VALUES (3, 'Persona natural (RUT ' || pers_rut || ')',
        '/mi-cuenta (elegir "Persona")', v_email, v_clave, v_estado);
END $$;

-- Resultado: copie las contraseñas ahora, no se vuelven a mostrar.
-- (contrasena vacía = el perfil ya existía y no se cambió)
SELECT perfil, ingreso, correo, contrasena, estado FROM perfiles_creados ORDER BY orden;
