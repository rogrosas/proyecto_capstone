-- =====================================================================
-- EASY OFFICE · Migración v2 → tickets como conversación
-- Ejecutar UNA vez sobre EO_ER (en pgAdmin: Query Tool → abrir este archivo → F5),
-- después de easyoffice_v2_trl4.sql. easyoffice_v2.sql ya lo incluye.
--
--   TICKETS  ticket_mensajes: cada ticket es una conversación entre el cliente y
--            el personal, con el autor y la hora de cada mensaje; los cambios de
--            estado quedan como mensajes del sistema. Los tickets que ya existen
--            pasan su mensaje inicial y su respuesta a la conversación.
-- =====================================================================
BEGIN;

CREATE TABLE ticket_mensajes (
    id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id   int    NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
    autor_tipo  text   NOT NULL CHECK (autor_tipo IN ('cliente', 'personal', 'sistema')),
    usuario_id  int    REFERENCES usuarios (id),            -- quién del personal escribió (o cambió el estado)
    email       citext,                                  -- quién del cliente escribió
    texto       text   NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
    creado_en   timestamptz NOT NULL DEFAULT now(),
    CHECK (autor_tipo <> 'personal' OR usuario_id IS NOT NULL),
    CHECK (autor_tipo <> 'cliente' OR email IS NOT NULL)
);
CREATE INDEX ix_ticket_mensajes_ticket ON ticket_mensajes (ticket_id, id);

-- Tickets existentes: el mensaje del cliente y la respuesta que ya tenían
INSERT INTO ticket_mensajes (ticket_id, autor_tipo, email, texto, creado_en)
SELECT t.id, 'cliente', COALESCE(t.email, 'cliente@sin-correo'), t.detalle, t.creado_en FROM tickets t ORDER BY t.id;
INSERT INTO ticket_mensajes (ticket_id, autor_tipo, usuario_id, texto, creado_en)
SELECT t.id, 'personal', t.atendido_por, t.respuesta, COALESCE(t.actualizado_en, now())
  FROM tickets t WHERE t.respuesta IS NOT NULL AND t.atendido_por IS NOT NULL ORDER BY t.id;

ALTER TABLE ticket_mensajes ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_ticket_mensajes ON ticket_mensajes
    USING (EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_mensajes.ticket_id));
CREATE POLICY p_portal_ticket_mensajes ON ticket_mensajes FOR SELECT TO rol_portal
    USING (EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_mensajes.ticket_id AND t.cliente_id = app_cliente()));
CREATE TRIGGER trg_auditoria_ticket_mensajes
    AFTER INSERT OR UPDATE OR DELETE ON ticket_mensajes
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_actividad();

GRANT SELECT, INSERT ON ticket_mensajes TO rol_ejecutivo;
GRANT ALL PRIVILEGES ON ticket_mensajes TO rol_admin;
GRANT SELECT ON ticket_mensajes TO rol_portal;
GRANT USAGE, SELECT ON SEQUENCE ticket_mensajes_id_seq TO rol_ejecutivo, rol_admin, rol_portal;

COMMIT;
