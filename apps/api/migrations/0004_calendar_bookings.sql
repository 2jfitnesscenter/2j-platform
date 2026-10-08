CREATE TABLE recurring_session_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL CONSTRAINT recurring_session_templates_service_id_services_id_fk REFERENCES services(id) ON DELETE RESTRICT,
  area_id uuid NOT NULL CONSTRAINT recurring_session_templates_area_id_areas_id_fk REFERENCES areas(id) ON DELETE RESTRICT,
  weekday smallint NOT NULL,
  local_start_time time NOT NULL,
  duration_minutes integer NOT NULL,
  capacity integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_session_templates_weekday CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT recurring_session_templates_duration CHECK (duration_minutes BETWEEN 5 AND 480),
  CONSTRAINT recurring_session_templates_capacity CHECK (capacity BETWEEN 1 AND 500),
  CONSTRAINT recurring_session_templates_date_range CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT recurring_session_templates_status CHECK (status IN ('active','archived')),
  CONSTRAINT recurring_session_templates_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
CREATE INDEX recurring_session_templates_schedule_idx ON recurring_session_templates(status,weekday,local_start_time);

CREATE TABLE calendar_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL CONSTRAINT calendar_sessions_service_id_services_id_fk REFERENCES services(id) ON DELETE RESTRICT,
  area_id uuid NOT NULL CONSTRAINT calendar_sessions_area_id_areas_id_fk REFERENCES areas(id) ON DELETE RESTRICT,
  template_id uuid CONSTRAINT calendar_sessions_template_id_recurring_session_templates_id_fk REFERENCES recurring_session_templates(id) ON DELETE RESTRICT,
  source text NOT NULL DEFAULT 'manual',
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  capacity integer NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  individual_client_id uuid CONSTRAINT calendar_sessions_individual_client_id_clients_id_fk REFERENCES clients(id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_sessions_source CHECK (source IN ('manual','template')),
  CONSTRAINT calendar_sessions_source_template CHECK ((source='manual' AND template_id IS NULL) OR (source='template' AND template_id IS NOT NULL)),
  CONSTRAINT calendar_sessions_duration CHECK (duration_minutes BETWEEN 5 AND 480),
  CONSTRAINT calendar_sessions_capacity CHECK (capacity BETWEEN 1 AND 500),
  CONSTRAINT calendar_sessions_status CHECK (status IN ('scheduled','cancelled')),
  CONSTRAINT calendar_sessions_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX calendar_sessions_template_occurrence_unique ON calendar_sessions(template_id,starts_at) WHERE template_id IS NOT NULL;
CREATE INDEX calendar_sessions_week_idx ON calendar_sessions(starts_at,area_id,status);

CREATE TABLE calendar_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL CONSTRAINT calendar_reservations_session_id_calendar_sessions_id_fk REFERENCES calendar_sessions(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL CONSTRAINT calendar_reservations_client_id_clients_id_fk REFERENCES clients(id) ON DELETE RESTRICT,
  entitlement_reference text NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_reservations_status CHECK (status IN ('reserved','attended','no_show','cancelled')),
  CONSTRAINT calendar_reservations_entitlement_reference CHECK (char_length(entitlement_reference) BETWEEN 1 AND 160),
  CONSTRAINT calendar_reservations_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX calendar_reservations_client_active_unique ON calendar_reservations(session_id,client_id) WHERE status IN ('reserved','attended','no_show');
CREATE INDEX calendar_reservations_session_status_idx ON calendar_reservations(session_id,status);

CREATE TABLE calendar_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL CONSTRAINT calendar_waitlist_entries_session_id_calendar_sessions_id_fk REFERENCES calendar_sessions(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL CONSTRAINT calendar_waitlist_entries_client_id_clients_id_fk REFERENCES clients(id) ON DELETE RESTRICT,
  entitlement_reference text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT calendar_waitlist_status CHECK (status IN ('waiting','cancelled')),
  CONSTRAINT calendar_waitlist_entitlement_reference CHECK (char_length(entitlement_reference) BETWEEN 1 AND 160),
  CONSTRAINT calendar_waitlist_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX calendar_waitlist_client_waiting_unique ON calendar_waitlist_entries(session_id,client_id) WHERE status='waiting';
CREATE INDEX calendar_waitlist_order_idx ON calendar_waitlist_entries(session_id,created_at,id) WHERE status='waiting';

CREATE TABLE calendar_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  session_id uuid,
  client_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT calendar_audit_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  CONSTRAINT calendar_audit_action CHECK (action IN ('session.created','session.generated','session.cancelled','reservation.created','reservation.cancelled','reservation.overbooked','reservation.attendance_changed','waitlist.entered','waitlist.cancelled')),
  CONSTRAINT calendar_audit_details_object CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX calendar_audit_session_timeline_idx ON calendar_audit_events(session_id,occurred_at DESC,id DESC);
CREATE FUNCTION calendar_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'calendar audit is append only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER calendar_audit_no_change BEFORE UPDATE OR DELETE ON calendar_audit_events FOR EACH ROW EXECUTE FUNCTION calendar_audit_immutable();
CREATE TRIGGER calendar_audit_no_truncate BEFORE TRUNCATE ON calendar_audit_events FOR EACH STATEMENT EXECUTE FUNCTION calendar_audit_immutable();
