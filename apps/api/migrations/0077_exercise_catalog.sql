-- A81 / A88: catálogo de ejercicios de Búnker copiado tal cual a Platform.
-- Los identificadores de origen (texto con ceros: '0001') se conservan para que rutinas e historial migrados
-- apunten al mismo ejercicio. Los datos se cargan con scripts/import-exercise-catalog.ts (idempotente).
-- Lectura libre para cualquier socio (A86): no depende de derechos.

CREATE TABLE exercise_catalog (
  id text PRIMARY KEY,
  name text NOT NULL,
  body_part text NOT NULL,
  equipment text NOT NULL,
  target text NOT NULL,
  muscle_group text NOT NULL,
  secondary_muscles text[] NOT NULL DEFAULT '{}',
  steps text[] NOT NULL DEFAULT '{}',
  image_file text,
  gif_file text,
  content_sha256 char(64) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exercise_catalog_id_format CHECK (id ~ '^[0-9]{4}$'),
  CONSTRAINT exercise_catalog_name_present CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT exercise_catalog_muscle_group_present CHECK (char_length(btrim(muscle_group)) > 0)
);
CREATE INDEX exercise_catalog_muscle_group_idx ON exercise_catalog(muscle_group, name, id);
CREATE INDEX exercise_catalog_name_idx ON exercise_catalog(lower(name), id);
