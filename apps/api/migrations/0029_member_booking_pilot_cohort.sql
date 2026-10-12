CREATE TABLE platform_member_booking_pilot_cohort (
  person_id uuid PRIMARY KEY REFERENCES platform_persons(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active','revoked')),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  enabled_by text NOT NULL CHECK (char_length(enabled_by) BETWEEN 1 AND 120),
  disabled_at timestamptz,
  disabled_by text,
  CONSTRAINT platform_member_booking_pilot_cohort_state CHECK (
    (status='active' AND disabled_at IS NULL AND disabled_by IS NULL) OR
    (status='revoked' AND disabled_at IS NOT NULL AND disabled_by IS NOT NULL AND char_length(disabled_by) BETWEEN 1 AND 120)
  )
);
CREATE INDEX platform_member_booking_pilot_cohort_active_idx ON platform_member_booking_pilot_cohort(person_id) WHERE status='active';

CREATE TABLE platform_member_booking_pilot_cohort_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('booking_cohort.enabled','booking_cohort.revoked')),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 240),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_member_booking_pilot_cohort_events_person_idx ON platform_member_booking_pilot_cohort_events(person_id,occurred_at DESC,id DESC);
CREATE FUNCTION platform_member_booking_pilot_cohort_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'member booking cohort events are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER platform_member_booking_pilot_cohort_events_immutable BEFORE UPDATE OR DELETE ON platform_member_booking_pilot_cohort_events
  FOR EACH ROW EXECUTE FUNCTION platform_member_booking_pilot_cohort_events_immutable();
CREATE TRIGGER platform_member_booking_pilot_cohort_events_no_truncate BEFORE TRUNCATE ON platform_member_booking_pilot_cohort_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_member_booking_pilot_cohort_events_immutable();
