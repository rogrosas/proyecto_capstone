-- =====================================================================
-- EASY OFFICE · Migración v2 → archivos guardados en la base
-- Ejecutar UNA vez sobre la base que usa la aplicación (Neon: SQL Editor
-- o pgAdmin → Query Tool → abrir este archivo → F5), con el mismo usuario
-- con que se conecta la aplicación. easyoffice_v2.sql ya lo incluye.
--
--   Las plantillas Word, los contratos generados y firmados y los escaneos
--   de correspondencia dejan de depender del disco del servidor (en Render
--   se borra en cada reinicio): se guardan en la tabla archivos, con la
--   misma ruta relativa que ya guardan las demás tablas. No cambia ninguna
--   tabla existente.
--
--   Los archivos que ya están en la carpeta de contratos (los de git) se
--   copian solos a la tabla la primera vez que se abren.
--   Mientras no se ejecute, la aplicación sigue usando solo la carpeta.
-- =====================================================================
BEGIN;

CREATE TABLE archivos (
    ruta            text PRIMARY KEY CHECK (ruta <> '' AND ruta !~ '^/' AND strpos(ruta, chr(92)) = 0 AND ruta !~ '(^|/)\.\.(/|$)'),  -- relativa, sin \ ni ..
    contenido       bytea NOT NULL,
    bytes           int  NOT NULL CHECK (bytes >= 0),
    sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- Igual que el resto de las tablas en easyoffice_v2.sql
GRANT ALL PRIVILEGES ON archivos TO rol_admin;

COMMIT;
