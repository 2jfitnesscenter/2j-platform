-- A71: commercial monthly renewal is distinct from the legacy 098E bag recurrence.
CREATE TABLE assignment_auto_renewal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES client_plan_assignments(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  actor_id text NOT NULL CONSTRAINT assignment_auto_renewal_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  effective_on date NOT NULL,
  reason text NOT NULL CONSTRAINT assignment_auto_renewal_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL CONSTRAINT assignment_auto_renewal_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignment_auto_renewal_current_idx
  ON assignment_auto_renewal_events(assignment_id,effective_on DESC,created_at DESC,id DESC);
CREATE FUNCTION assignment_auto_renewal_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'automatic renewal history is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER assignment_auto_renewal_events_immutable
  BEFORE UPDATE OR DELETE ON assignment_auto_renewal_events
  FOR EACH ROW EXECUTE FUNCTION assignment_auto_renewal_events_append_only();
