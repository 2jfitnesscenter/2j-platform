-- Operational center hours and owner-assigned dated shifts (A45).
-- Planned shifts are separate from staff_schedule_slots (calendar availability)
-- and never create or correct timeclock events.
CREATE TABLE center_opening_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  valid_from date NOT NULL,
  valid_until date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at < closes_at),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX center_opening_hours_effective_idx
  ON center_opening_hours(weekday,valid_from,valid_until)
  WHERE status='active';

CREATE TABLE staff_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  local_date date NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  CHECK ((starts_at AT TIME ZONE 'Atlantic/Canary')::date = local_date),
  CHECK (((ends_at - interval '1 microsecond') AT TIME ZONE 'Atlantic/Canary')::date = local_date)
);
CREATE INDEX staff_shift_assignments_day_idx
  ON staff_shift_assignments(local_date,starts_at,id)
  WHERE status='scheduled';
CREATE INDEX staff_shift_assignments_professional_day_idx
  ON staff_shift_assignments(professional_id,local_date,starts_at)
  WHERE status='scheduled';
