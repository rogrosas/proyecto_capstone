-- =====================================================================
-- EASY OFFICE · Migración v2 → clientes visibles para todo el personal y ejecutivo a cargo
-- Ejecutar sobre una base ya cargada (EO_ER, easyoffice_completo.sql o Neon), DESPUÉS de
-- easyoffice_v2_comunas_permisos.sql:
--   pgAdmin: Query Tool sobre la base → abrir este archivo → F5
--   o desde Desarrollo/EasyOfficeWIP:  npm run db:migrar -- easyoffice_v2_cartera.sql
-- Se puede ejecutar más de una vez: no duplica nada. easyoffice_v2.sql ya lo incluye.
--
--   EJECUTIVO A CARGO  clientes.ejecutivo_id: quién del personal atiende al cliente. Al crearlo
--                      desde el CRM es quien lo registra; en la tienda, el ejecutivo de la venta.
--                      Los clientes que ya existen toman el ejecutivo de su contrato más reciente
--                      (o quien los registró).
--   PERMISOS           ver_todos_los_clientes: ve y opera todos los clientes con sus contratos,
--                      documentos y pagos (sin él, solo los de su cartera). Lo tienen dueno,
--                      admin y ejecutivo.
--                      asignar_clientes: cambia el ejecutivo a cargo (de uno o varios clientes).
--                      Lo tienen dueno y admin.
--                      Se cambian en CRM → Administración → Roles y permisos.
-- =====================================================================
BEGIN;

-- ¿El rol de la sesión tiene este permiso? (también la crea easyoffice_v2_comunas_permisos.sql)
CREATE OR REPLACE FUNCTION app_tiene_permiso(p_permiso text) RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT app_es_admin() OR EXISTS (
     SELECT 1 FROM roles r JOIN roles_permisos rp ON rp.rol_id = r.id JOIN permisos p ON p.id = rp.permisos_id
      WHERE r.rol = current_setting('app.rol_actual', true) AND p.permiso = p_permiso) $$;

-- ---------- Ejecutivo a cargo de cada cliente ----------
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ejecutivo_id int REFERENCES usuarios (id);
ALTER TABLE clientes ALTER COLUMN ejecutivo_id SET DEFAULT app_usuario();
CREATE INDEX IF NOT EXISTS ix_clientes_ejecutivo ON clientes (ejecutivo_id);

UPDATE clientes cl SET ejecutivo_id = COALESCE(
    (SELECT k.ejecutivo_id FROM contratos k JOIN usuarios u ON u.id = k.ejecutivo_id AND u.activo
      WHERE k.cliente_id = cl.id AND k.estado <> 'cancelado' ORDER BY k.creado_en DESC LIMIT 1),
    (SELECT u.id FROM usuarios u WHERE u.id = cl.registrado_por AND u.activo))
 WHERE cl.ejecutivo_id IS NULL;

-- ---------- Permisos ----------
INSERT INTO permisos (permiso) VALUES ('ver_todos_los_clientes'), ('asignar_clientes')
ON CONFLICT (permiso) DO NOTHING;
INSERT INTO roles_permisos (rol_id, permisos_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.permiso = 'ver_todos_los_clientes'
 WHERE r.rol IN ('dueno', 'admin', 'ejecutivo')
ON CONFLICT DO NOTHING;
INSERT INTO roles_permisos (rol_id, permisos_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.permiso = 'asignar_clientes'
 WHERE r.rol IN ('dueno', 'admin')
ON CONFLICT DO NOTHING;

-- ¿El cliente está a cargo del usuario de la sesión? SECURITY DEFINER: lo usan las políticas de
-- contratos y documentos, y la de clientes mira contratos; sin esto habría recursión entre políticas.
CREATE OR REPLACE FUNCTION fn_cliente_a_cargo(p_cliente int) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente AND ejecutivo_id = app_usuario()) $$;

-- ---------- Seguridad por fila: todo el cliente para quien tiene el permiso; si no, su cartera ----------
DROP POLICY IF EXISTS p_clientes ON clientes;
CREATE POLICY p_clientes ON clientes
    USING (
        app_es_admin()
        OR app_tiene_permiso('ver_todos_los_clientes')
        OR registrado_por = app_usuario()
        OR ejecutivo_id = app_usuario()
        OR EXISTS (SELECT 1 FROM contratos  c WHERE c.cliente_id = clientes.id)
        OR EXISTS (SELECT 1 FROM documentos d WHERE d.cliente_id = clientes.id)
    );

DROP POLICY IF EXISTS p_contratos ON contratos;
CREATE POLICY p_contratos ON contratos
    USING (ejecutivo_id = app_usuario() OR app_es_admin() OR app_tiene_permiso('ver_todos_los_clientes')
           OR fn_cliente_a_cargo(cliente_id));

DROP POLICY IF EXISTS p_documentos ON documentos;
CREATE POLICY p_documentos ON documentos
    USING (
        ejecutivo_id = app_usuario()
        OR app_es_admin()
        OR app_tiene_permiso('ver_todos_los_clientes')
        OR fn_cliente_a_cargo(cliente_id)
        OR (contrato_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = documentos.contrato_id))
    );

COMMIT;
