-- A81 slice 1: entrenamiento dentro de Platform para un socio.
-- Platform es la autoridad de identidad y de derechos: el acceso lo decide la lectura de asignaciones efectivas
-- (training_access), no estas tablas. Búnker no se lee ni se escribe desde aquí.

CREATE TABLE training_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name text NOT NULL,
  -- ISO weekdays (1 = lunes ... 7 = domingo) en los que toca esta rutina.
  scheduled_weekdays smallint[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_routines_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT training_routines_status_allowed CHECK (status IN ('active','archived')),
  CONSTRAINT training_routines_weekdays_valid CHECK (scheduled_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
);
CREATE INDEX training_routines_client_listing_idx ON training_routines(client_id, status, id);

CREATE TABLE training_routine_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid NOT NULL REFERENCES training_routines(id) ON DELETE CASCADE,
  position integer NOT NULL,
  exercise_name text NOT NULL,
  target_sets integer NOT NULL DEFAULT 3,
  UNIQUE (routine_id, position),
  CONSTRAINT training_routine_exercises_position CHECK (position >= 1),
  CONSTRAINT training_routine_exercises_name_length CHECK (char_length(btrim(exercise_name)) BETWEEN 1 AND 80),
  CONSTRAINT training_routine_exercises_target_sets CHECK (target_sets BETWEEN 1 AND 20)
);

CREATE TABLE training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  routine_id uuid REFERENCES training_routines(id) ON DELETE RESTRICT,
  status text NOT NULL,
  business_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT training_sessions_status_allowed CHECK (status IN ('in_progress','finished')),
  CONSTRAINT training_sessions_finished_consistent CHECK ((status = 'finished') = (finished_at IS NOT NULL))
);
-- Como mucho una sesión abierta por socio: "Entrenar" reanuda la que ya está en curso.
CREATE UNIQUE INDEX training_sessions_one_open_per_client ON training_sessions(client_id) WHERE status = 'in_progress';
CREATE INDEX training_sessions_history_idx ON training_sessions(client_id, started_at DESC, id DESC);

CREATE TABLE training_session_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  exercise_name text NOT NULL,
  set_index integer NOT NULL,
  reps integer NOT NULL,
  weight_kg numeric(6,2) NOT NULL,
  rir integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, exercise_name, set_index),
  CONSTRAINT training_session_sets_exercise_length CHECK (char_length(btrim(exercise_name)) BETWEEN 1 AND 80),
  CONSTRAINT training_session_sets_set_index CHECK (set_index BETWEEN 1 AND 50),
  CONSTRAINT training_session_sets_reps CHECK (reps BETWEEN 0 AND 100),
  CONSTRAINT training_session_sets_weight CHECK (weight_kg >= 0 AND weight_kg <= 1000),
  CONSTRAINT training_session_sets_rir CHECK (rir IS NULL OR rir BETWEEN 0 AND 10)
);
