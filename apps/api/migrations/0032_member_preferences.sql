CREATE TABLE platform_member_preferences (
  person_id uuid PRIMARY KEY REFERENCES platform_persons(id) ON DELETE RESTRICT,
  appearance text NOT NULL DEFAULT 'system' CHECK (appearance IN ('system','light','dark')),
  language text NOT NULL DEFAULT 'es' CHECK (language IN ('es')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
