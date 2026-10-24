-- Delivery bookkeeping for signed Platform -> Training suspension signals (2J-CAPABILITY-SIGNAL-V1). Proof of concept: nothing writes here unless
-- TRAINING_SIGNALS_ENABLED=true, and nothing in the existing suspension/link code changes (the dispatcher only READS platform_training_access_events).
-- Additive: two new tables. A delivery row is created per suspension/lift event seen after the dispatcher was first enabled; it records attempts, never content
-- beyond ids (the reason text of a suspension is never sent to, or stored for, Training).
CREATE TABLE platform_training_signal_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled_since timestamptz NOT NULL
);

CREATE TABLE platform_training_signal_deliveries (
  seq bigserial PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES platform_training_access_events(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  signal_id uuid NOT NULL DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  CONSTRAINT platform_training_signal_kind_check CHECK (kind IN ('suspended','lifted')),
  CONSTRAINT platform_training_signal_state_check CHECK (state IN ('pending','delivered','superseded','abandoned')),
  CONSTRAINT platform_training_signal_attempts_check CHECK (attempts >= 0),
  CONSTRAINT platform_training_signal_error_check CHECK (last_error IS NULL OR char_length(last_error) <= 80),
  CONSTRAINT platform_training_signal_delivered_check CHECK ((state='delivered') = (delivered_at IS NOT NULL))
);
CREATE INDEX platform_training_signal_due_idx ON platform_training_signal_deliveries(next_attempt_at, seq) WHERE state='pending';
CREATE INDEX platform_training_signal_person_idx ON platform_training_signal_deliveries(person_id, seq);
