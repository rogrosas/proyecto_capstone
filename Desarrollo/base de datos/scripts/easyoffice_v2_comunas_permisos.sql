-- =====================================================================
-- EASY OFFICE · Migración v2 → todas las comunas y permisos de tickets
-- Ejecutar sobre una base ya cargada (EO_ER, easyoffice_completo.sql o Neon):
--   pgAdmin: Query Tool sobre la base → abrir este archivo → F5
--   o desde Desarrollo/EasyOfficeWIP:  npm run db:migrar -- easyoffice_v2_comunas_permisos.sql
-- Se puede ejecutar más de una vez: no duplica nada. easyoffice_v2.sql ya lo incluye.
--
--   COMUNAS   las 346 comunas de Chile (antes solo Metropolitana y Valparaíso),
--             para el domicilio en la tienda y en el CRM.
--   PERMISOS  ver_todos_los_tickets: ve los tickets de todos los clientes, no solo
--             los de su cartera (y el cliente y el documento de cada ticket).
--             responder_tickets: responde y cambia el estado de un ticket.
--             Se asignan a dueno, admin y ejecutivo; se cambian en
--             CRM → Administración → Roles y permisos.
-- =====================================================================
BEGIN;

-- ---------- Comunas ----------
INSERT INTO comunas (nombre_comuna, region_id)
SELECT x.comuna, r.id
  FROM (VALUES
    ('Región de Arica y Parinacota', ARRAY['Arica', 'Camarones', 'General Lagos', 'Putre']),
    ('Región de Tarapacá', ARRAY['Alto Hospicio', 'Camiña', 'Colchane', 'Huara', 'Iquique', 'Pica', 'Pozo Almonte']),
    ('Región de Antofagasta', ARRAY['Antofagasta', 'Calama', 'María Elena', 'Mejillones', 'Ollagüe', 'San Pedro de Atacama',
      'Sierra Gorda', 'Taltal', 'Tocopilla']),
    ('Región de Atacama', ARRAY['Alto del Carmen', 'Caldera', 'Chañaral', 'Copiapó', 'Diego de Almagro', 'Freirina', 'Huasco',
      'Tierra Amarilla', 'Vallenar']),
    ('Región de Coquimbo', ARRAY['Andacollo', 'Canela', 'Combarbalá', 'Coquimbo', 'Illapel', 'La Higuera', 'La Serena', 'Los Vilos',
      'Monte Patria', 'Ovalle', 'Paihuano', 'Punitaqui', 'Río Hurtado', 'Salamanca', 'Vicuña']),
    ('Región de Valparaíso', ARRAY['Algarrobo', 'Cabildo', 'Calle Larga', 'Cartagena', 'Casablanca', 'Catemu', 'Concón', 'El Quisco',
      'El Tabo', 'Hijuelas', 'Isla de Pascua', 'Juan Fernández', 'La Calera', 'La Cruz', 'La Ligua', 'Limache', 'Llaillay', 'Los Andes',
      'Nogales', 'Olmué', 'Panquehue', 'Papudo', 'Petorca', 'Puchuncaví', 'Putaendo', 'Quillota', 'Quilpué', 'Quintero', 'Rinconada',
      'San Antonio', 'San Esteban', 'San Felipe', 'Santa María', 'Santo Domingo', 'Valparaíso', 'Villa Alemana', 'Viña del Mar',
      'Zapallar']),
    ('Región Metropolitana', ARRAY['Alhué', 'Buin', 'Calera de Tango', 'Cerrillos', 'Cerro Navia', 'Colina', 'Conchalí', 'Curacaví',
      'El Bosque', 'El Monte', 'Estación Central', 'Huechuraba', 'Independencia', 'Isla de Maipo', 'La Cisterna', 'La Florida',
      'La Granja', 'La Pintana', 'La Reina', 'Lampa', 'Las Condes', 'Lo Barnechea', 'Lo Espejo', 'Lo Prado', 'Macul', 'Maipú',
      'María Pinto', 'Melipilla', 'Ñuñoa', 'Padre Hurtado', 'Paine', 'Pedro Aguirre Cerda', 'Peñaflor', 'Peñalolén', 'Pirque',
      'Providencia', 'Pudahuel', 'Puente Alto', 'Quilicura', 'Quinta Normal', 'Recoleta', 'Renca', 'San Bernardo', 'San Joaquín',
      'San José de Maipo', 'San Miguel', 'San Pedro', 'San Ramón', 'Santiago', 'Talagante', 'Tiltil', 'Vitacura']),
    ('Región del Libertador General Bernardo O''Higgins', ARRAY['Chépica', 'Chimbarongo', 'Codegua', 'Coinco', 'Coltauco', 'Doñihue',
      'Graneros', 'La Estrella', 'Las Cabras', 'Litueche', 'Lolol', 'Machalí', 'Malloa', 'Marchihue', 'Mostazal', 'Nancagua', 'Navidad',
      'Olivar', 'Palmilla', 'Paredones', 'Peralillo', 'Peumo', 'Pichidegua', 'Pichilemu', 'Placilla', 'Pumanque', 'Quinta de Tilcoco',
      'Rancagua', 'Rengo', 'Requínoa', 'San Fernando', 'San Vicente', 'Santa Cruz']),
    ('Región del Maule', ARRAY['Cauquenes', 'Chanco', 'Colbún', 'Constitución', 'Curepto', 'Curicó', 'Empedrado', 'Hualañé', 'Licantén',
      'Linares', 'Longaví', 'Maule', 'Molina', 'Parral', 'Pelarco', 'Pelluhue', 'Pencahue', 'Rauco', 'Retiro', 'Río Claro', 'Romeral',
      'Sagrada Familia', 'San Clemente', 'San Javier', 'San Rafael', 'Talca', 'Teno', 'Vichuquén', 'Villa Alegre', 'Yerbas Buenas']),
    ('Región de Ñuble', ARRAY['Bulnes', 'Chillán', 'Chillán Viejo', 'Cobquecura', 'Coelemu', 'Coihueco', 'El Carmen', 'Ninhue', 'Ñiquén',
      'Pemuco', 'Pinto', 'Portezuelo', 'Quillón', 'Quirihue', 'Ránquil', 'San Carlos', 'San Fabián', 'San Ignacio', 'San Nicolás',
      'Treguaco', 'Yungay']),
    ('Región del Biobío', ARRAY['Alto Biobío', 'Antuco', 'Arauco', 'Cabrero', 'Cañete', 'Chiguayante', 'Concepción', 'Contulmo', 'Coronel',
      'Curanilahue', 'Florida', 'Hualpén', 'Hualqui', 'Laja', 'Lebu', 'Los Álamos', 'Los Ángeles', 'Lota', 'Mulchén', 'Nacimiento',
      'Negrete', 'Penco', 'Quilaco', 'Quilleco', 'San Pedro de la Paz', 'San Rosendo', 'Santa Bárbara', 'Santa Juana', 'Talcahuano',
      'Tirúa', 'Tomé', 'Tucapel', 'Yumbel']),
    ('Región de La Araucanía', ARRAY['Angol', 'Carahue', 'Cholchol', 'Collipulli', 'Cunco', 'Curacautín', 'Curarrehue', 'Ercilla', 'Freire',
      'Galvarino', 'Gorbea', 'Lautaro', 'Loncoche', 'Lonquimay', 'Los Sauces', 'Lumaco', 'Melipeuco', 'Nueva Imperial', 'Padre Las Casas',
      'Perquenco', 'Pitrufquén', 'Pucón', 'Purén', 'Renaico', 'Saavedra', 'Temuco', 'Teodoro Schmidt', 'Toltén', 'Traiguén', 'Victoria',
      'Vilcún', 'Villarrica']),
    ('Región de Los Ríos', ARRAY['Corral', 'Futrono', 'La Unión', 'Lago Ranco', 'Lanco', 'Los Lagos', 'Máfil', 'Mariquina', 'Paillaco',
      'Panguipulli', 'Río Bueno', 'Valdivia']),
    ('Región de Los Lagos', ARRAY['Ancud', 'Calbuco', 'Castro', 'Chaitén', 'Chonchi', 'Cochamó', 'Curaco de Vélez', 'Dalcahue', 'Fresia',
      'Frutillar', 'Futaleufú', 'Hualaihué', 'Llanquihue', 'Los Muermos', 'Maullín', 'Osorno', 'Palena', 'Puerto Montt', 'Puerto Octay',
      'Puerto Varas', 'Puqueldón', 'Purranque', 'Puyehue', 'Queilén', 'Quellón', 'Quemchi', 'Quinchao', 'Río Negro', 'San Juan de la Costa',
      'San Pablo']),
    ('Región de Aysén del General Carlos Ibáñez del Campo', ARRAY['Aysén', 'Chile Chico', 'Cisnes', 'Cochrane', 'Coyhaique', 'Guaitecas',
      'Lago Verde', 'O''Higgins', 'Río Ibáñez', 'Tortel']),
    ('Región de Magallanes y de la Antártica Chilena', ARRAY['Antártica', 'Cabo de Hornos', 'Laguna Blanca', 'Natales', 'Porvenir',
      'Primavera', 'Punta Arenas', 'Río Verde', 'San Gregorio', 'Timaukel', 'Torres del Paine'])
  ) AS t(region, comunas)
  CROSS JOIN LATERAL unnest(t.comunas) AS x(comuna)
  JOIN regiones r ON r.nombre_region = t.region
ON CONFLICT (nombre_comuna, region_id) DO NOTHING;

-- ---------- Permisos de tickets ----------
INSERT INTO permisos (permiso) VALUES ('ver_todos_los_tickets'), ('responder_tickets')
ON CONFLICT (permiso) DO NOTHING;

INSERT INTO roles_permisos (rol_id, permisos_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.permiso IN ('ver_todos_los_tickets', 'responder_tickets')
 WHERE r.rol IN ('dueno', 'admin', 'ejecutivo')
ON CONFLICT DO NOTHING;

-- ¿El rol de la sesión (app.rol_actual) tiene este permiso? Los administradores siempre.
CREATE OR REPLACE FUNCTION app_tiene_permiso(p_permiso text) RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT app_es_admin() OR EXISTS (
     SELECT 1 FROM roles r JOIN roles_permisos rp ON rp.rol_id = r.id JOIN permisos p ON p.id = rp.permisos_id
      WHERE r.rol = current_setting('app.rol_actual', true) AND p.permiso = p_permiso) $$;

-- Si el cliente o el documento tienen tickets. SECURITY DEFINER: lo usan las políticas de clientes y
-- documentos, y la de tickets mira clientes; sin esto PostgreSQL vería una recursión entre políticas.
CREATE OR REPLACE FUNCTION fn_cliente_con_ticket(p_cliente int) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM tickets WHERE cliente_id = p_cliente) $$;

CREATE OR REPLACE FUNCTION fn_documento_con_ticket(p_documento int) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM tickets WHERE documento_id = p_documento) $$;

-- Tickets: además de la cartera, quien tiene ver_todos_los_tickets
DROP POLICY IF EXISTS p_tickets ON tickets;
CREATE POLICY p_tickets ON tickets
    USING (app_es_admin() OR app_tiene_permiso('ver_todos_los_tickets')
           OR EXISTS (SELECT 1 FROM clientes c WHERE c.id = tickets.cliente_id));

-- ...y ve (solo lectura) el cliente y el documento de esos tickets, para entender el reclamo
DROP POLICY IF EXISTS p_clientes_tickets ON clientes;
CREATE POLICY p_clientes_tickets ON clientes FOR SELECT
    USING (app_tiene_permiso('ver_todos_los_tickets') AND fn_cliente_con_ticket(id));
DROP POLICY IF EXISTS p_documentos_tickets ON documentos;
CREATE POLICY p_documentos_tickets ON documentos FOR SELECT
    USING (app_tiene_permiso('ver_todos_los_tickets') AND fn_documento_con_ticket(id));

COMMIT;
