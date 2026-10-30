CREATE TABLE staff_appearance_preferences (
  actor_id text PRIMARY KEY,
  theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark','system')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_appearance_preferences_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120)
);
