CREATE TABLE staff_professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  display_name text NOT NULL,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  base_role text NOT NULL CHECK (base_role IN ('admin','trainer','reception-management','accountant')),
  operational_start_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Atlantic/Canary')::date),
  internal_notes text,
  calendar_color text,
  auth_actor_id text UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 80),
  CHECK (char_length(btrim(last_name)) BETWEEN 1 AND 100),
  CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  CHECK (email IS NULL OR (email=lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254)),
  CHECK (phone IS NULL OR char_length(btrim(phone)) BETWEEN 3 AND 40),
  CHECK (internal_notes IS NULL OR char_length(internal_notes) <= 2000),
  CHECK (calendar_color IS NULL OR calendar_color ~ '^#[0-9A-Fa-f]{6}$')
);
CREATE UNIQUE INDEX staff_professionals_active_email_unique ON staff_professionals(email) WHERE status='active' AND email IS NOT NULL;
CREATE INDEX staff_professionals_status_name_idx ON staff_professionals(status,lower(display_name),id);

CREATE TABLE staff_schedule_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX staff_schedule_slots_professional_validity_idx ON staff_schedule_slots(professional_id,weekday,valid_from,valid_until) WHERE status='active';

CREATE TABLE staff_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('vacation','leave','operational_absence','training','personal_block','extra_availability','other')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  local_start_date date NOT NULL,
  local_end_date date NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at), CHECK (local_start_date <= local_end_date),
  CHECK (note IS NULL OR char_length(note) <= 1000)
);
CREATE INDEX staff_exceptions_professional_time_idx ON staff_exceptions(professional_id,starts_at,ends_at) WHERE status='active';

CREATE TABLE staff_substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  substitute_professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_professional_id <> substitute_professional_id), CHECK (starts_at < ends_at),
  CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500)
);
CREATE INDEX staff_substitutions_source_time_idx ON staff_substitutions(source_professional_id,starts_at,ends_at) WHERE status='active';

CREATE TABLE staff_timeclock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('clock_in','clock_out')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  local_timezone text NOT NULL DEFAULT 'Atlantic/Canary' CHECK (local_timezone='Atlantic/Canary'),
  local_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Atlantic/Canary')::date),
  local_time time NOT NULL DEFAULT ((now() AT TIME ZONE 'Atlantic/Canary')::time),
  actor_id text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('web','staff_app','manual_admin')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (note IS NULL OR char_length(note) <= 500)
);
CREATE INDEX staff_timeclock_events_history_idx ON staff_timeclock_events(professional_id,occurred_at DESC,id DESC);

CREATE TABLE staff_timeclock_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES staff_timeclock_events(id) ON DELETE RESTRICT,
  professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  previous_occurred_at timestamptz NOT NULL,
  corrected_occurred_at timestamptz NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_occurred_at <> corrected_occurred_at),
  CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500)
);
CREATE INDEX staff_timeclock_corrections_professional_idx ON staff_timeclock_corrections(professional_id,created_at DESC,id DESC);

CREATE TABLE staff_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  professional_id uuid REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_audit_professional_timeline_idx ON staff_audit_events(professional_id,occurred_at DESC,id DESC);

ALTER TABLE calendar_sessions ADD COLUMN professional_id uuid REFERENCES staff_professionals(id) ON DELETE RESTRICT;
ALTER TABLE recurring_session_templates ADD COLUMN professional_id uuid REFERENCES staff_professionals(id) ON DELETE RESTRICT;
CREATE INDEX calendar_sessions_professional_time_idx ON calendar_sessions(professional_id,starts_at) WHERE professional_id IS NOT NULL AND status='scheduled';
ALTER TABLE calendar_audit_events DROP CONSTRAINT calendar_audit_action;
ALTER TABLE calendar_audit_events ADD CONSTRAINT calendar_audit_action CHECK (action IN ('session.created','session.generated','session.cancelled','session.reassigned','session.availability_override','template.archived','reservation.created','reservation.cancelled','reservation.overbooked','reservation.attendance_changed','reservation.cancelled_by_center','reservation.debt_override','waitlist.entered','waitlist.cancelled','waitlist.cancelled_by_center'));

CREATE FUNCTION staff_block_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'staff history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER staff_timeclock_events_immutable BEFORE UPDATE OR DELETE ON staff_timeclock_events FOR EACH ROW EXECUTE FUNCTION staff_block_append_only_mutation();
CREATE TRIGGER staff_timeclock_events_no_truncate BEFORE TRUNCATE ON staff_timeclock_events FOR EACH STATEMENT EXECUTE FUNCTION staff_block_append_only_mutation();
CREATE TRIGGER staff_timeclock_corrections_immutable BEFORE UPDATE OR DELETE ON staff_timeclock_corrections FOR EACH ROW EXECUTE FUNCTION staff_block_append_only_mutation();
CREATE TRIGGER staff_timeclock_corrections_no_truncate BEFORE TRUNCATE ON staff_timeclock_corrections FOR EACH STATEMENT EXECUTE FUNCTION staff_block_append_only_mutation();
CREATE TRIGGER staff_audit_events_immutable BEFORE UPDATE OR DELETE ON staff_audit_events FOR EACH ROW EXECUTE FUNCTION staff_block_append_only_mutation();
CREATE TRIGGER staff_audit_events_no_truncate BEFORE TRUNCATE ON staff_audit_events FOR EACH STATEMENT EXECUTE FUNCTION staff_block_append_only_mutation();
