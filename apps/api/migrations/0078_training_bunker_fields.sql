-- A81 slice 2: campos de Búnker en el modelo de entrenamiento de Platform. Aditiva: las filas y las rutas de la slice 1 siguen válidas.
-- Búnker usa tres modos (repeticiones, tiempo, cardio), series de calentamiento, caída y fallo, superseries, medios puntos de RIR/RPE y una
-- política de progresión por ejercicio. legacy_bunker_id guarda el id de origen para migrar db.json sin duplicar nada (idempotente).

ALTER TABLE training_routines
  ADD COLUMN legacy_bunker_id text,
  ADD CONSTRAINT training_routines_legacy_bunker_id_unique UNIQUE (legacy_bunker_id);

ALTER TABLE training_routine_exercises
  ADD COLUMN exercise_id text,
  ADD COLUMN mode text NOT NULL DEFAULT 'reps',
  ADD COLUMN superset_group text,
  ADD COLUMN target jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN progression_policy text,
  ADD CONSTRAINT training_routine_exercises_mode_allowed CHECK (mode IN ('reps','time','cardio')),
  ADD CONSTRAINT training_routine_exercises_policy_allowed CHECK (progression_policy IS NULL OR progression_policy IN ('off','linear','greyskull','double','pct1rm','time','cardio')),
  ADD CONSTRAINT training_routine_exercises_superset_length CHECK (superset_group IS NULL OR char_length(superset_group) BETWEEN 1 AND 40);

ALTER TABLE training_sessions
  ADD COLUMN legacy_bunker_id text,
  ADD COLUMN exclude_from_progression boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT training_sessions_legacy_bunker_id_unique UNIQUE (legacy_bunker_id);

-- Series: reps y peso dejan de ser obligatorios porque tiempo y cardio no los tienen. Se añaden los campos de cada modo.
ALTER TABLE training_session_sets
  ALTER COLUMN reps DROP NOT NULL,
  ALTER COLUMN weight_kg DROP NOT NULL,
  ALTER COLUMN rir TYPE numeric(3,1),
  ADD COLUMN set_type text NOT NULL DEFAULT 'work',
  ADD COLUMN done boolean NOT NULL DEFAULT true,
  ADD COLUMN seconds integer,
  ADD COLUMN minutes numeric(6,2),
  ADD COLUMN speed_kmh numeric(4,1),
  ADD COLUMN rpe numeric(3,1),
  ADD COLUMN feel text,
  ADD CONSTRAINT training_session_sets_type_allowed CHECK (set_type IN ('work','warmup','drop','failure')),
  ADD CONSTRAINT training_session_sets_feel_allowed CHECK (feel IS NULL OR feel IN ('easy','good','hard','fail')),
  ADD CONSTRAINT training_session_sets_seconds_range CHECK (seconds IS NULL OR seconds BETWEEN 0 AND 86400),
  ADD CONSTRAINT training_session_sets_minutes_range CHECK (minutes IS NULL OR minutes BETWEEN 0 AND 1440),
  ADD CONSTRAINT training_session_sets_speed_range CHECK (speed_kmh IS NULL OR speed_kmh BETWEEN 0 AND 60),
  ADD CONSTRAINT training_session_sets_rpe_range CHECK (rpe IS NULL OR rpe BETWEEN 0 AND 10);
