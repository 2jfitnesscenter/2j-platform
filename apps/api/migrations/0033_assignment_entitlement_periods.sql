-- 2J-098E: additive period-scoped bags and audited recurrence state.
-- Existing assignments, period_quota rules and ledger rows remain unchanged.

ALTER TABLE plan_rights ADD COLUMN weekly_frequency smallint;
ALTER TABLE plan_rights ADD CONSTRAINT plan_rights_weekly_frequency_allowed CHECK (
  weekly_frequency IS NULL OR (right_type='sessions_quota' AND weekly_frequency BETWEEN 1 AND 5)
);

CREATE TABLE assignment_recurrence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  enabled boolean NOT NULL,
  actor_id text NOT NULL CONSTRAINT assignment_recurrence_events_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  effective_on date NOT NULL,
  reason text NOT NULL CONSTRAINT assignment_recurrence_events_reason CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL CONSTRAINT assignment_recurrence_events_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_recurrence_events_assignment_fk FOREIGN KEY (assignment_id) REFERENCES client_plan_assignments(id) ON DELETE RESTRICT
);
CREATE INDEX assignment_recurrence_events_current_idx
  ON assignment_recurrence_events(assignment_id, effective_on DESC, created_at DESC, id DESC);
CREATE FUNCTION assignment_recurrence_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'assignment recurrence events are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER assignment_recurrence_events_immutable BEFORE UPDATE OR DELETE ON assignment_recurrence_events
  FOR EACH ROW EXECUTE FUNCTION assignment_recurrence_events_append_only();

CREATE FUNCTION entitlement_weekdays(starts_on date, ends_on date) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT count(*)::integer FROM generate_series(starts_on, ends_on, interval '1 day') AS g(day)
  WHERE extract(isodow FROM g.day) BETWEEN 1 AND 5
$$;
CREATE FUNCTION entitlement_sessions_v1(weekday_count integer, weekly_frequency integer) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT floor((2::numeric * weekday_count * weekly_frequency + 5) / 10)::integer
$$;

CREATE TABLE assignment_entitlement_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  client_id uuid NOT NULL,
  right_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  weekly_frequency smallint NOT NULL CONSTRAINT assignment_entitlement_periods_frequency CHECK (weekly_frequency BETWEEN 1 AND 5),
  sessions_snapshot integer NOT NULL CONSTRAINT assignment_entitlement_periods_sessions CHECK (sessions_snapshot BETWEEN 0 AND 100000),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT assignment_entitlement_periods_snapshot_object CHECK (jsonb_typeof(snapshot)='object'),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL CONSTRAINT assignment_entitlement_periods_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_entitlement_periods_assignment_client_fk
    FOREIGN KEY (assignment_id, client_id) REFERENCES client_plan_assignments(id, client_id) ON DELETE RESTRICT,
  CONSTRAINT assignment_entitlement_periods_right_fk FOREIGN KEY (right_id) REFERENCES plan_rights(id) ON DELETE RESTRICT,
  CONSTRAINT assignment_entitlement_periods_dates CHECK (period_end >= period_start),
  CONSTRAINT assignment_entitlement_periods_bag_formula CHECK (sessions_snapshot=entitlement_sessions_v1(entitlement_weekdays(period_start,period_end),weekly_frequency)),
  CONSTRAINT assignment_entitlement_periods_id_assignment_right_unique UNIQUE (id, assignment_id, client_id, right_id),
  CONSTRAINT assignment_entitlement_periods_id_assignment_client_unique UNIQUE (id, assignment_id, client_id),
  CONSTRAINT assignment_entitlement_periods_assignment_right_start_unique UNIQUE (assignment_id, right_id, period_start)
);
CREATE INDEX assignment_entitlement_periods_lookup_idx
  ON assignment_entitlement_periods(assignment_id, right_id, period_start, period_end);
CREATE FUNCTION assignment_entitlement_periods_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'entitlement period facts are immutable' USING ERRCODE='55000';
  END IF;
  PERFORM 1 FROM client_plan_assignments WHERE id=NEW.assignment_id AND client_id=NEW.client_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM assignment_entitlement_periods p
    WHERE p.assignment_id=NEW.assignment_id AND p.right_id=NEW.right_id
      AND daterange(p.period_start,p.period_end,'[]') && daterange(NEW.period_start,NEW.period_end,'[]')
  ) THEN
    RAISE EXCEPTION 'entitlement periods cannot overlap' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_no_overlap';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_entitlement_periods_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON assignment_entitlement_periods
  FOR EACH ROW EXECUTE FUNCTION assignment_entitlement_periods_guard();

CREATE TABLE assignment_entitlement_period_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  client_id uuid NOT NULL,
  right_id uuid NOT NULL,
  event_type text NOT NULL CONSTRAINT assignment_entitlement_period_events_type CHECK (event_type IN ('charge_linked','payment_validated','closed')),
  charge_id uuid,
  effective_activation_on date,
  sessions_granted integer,
  actor_id text NOT NULL CONSTRAINT assignment_entitlement_period_events_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  reason text NOT NULL CONSTRAINT assignment_entitlement_period_events_reason CHECK (char_length(btrim(reason)) BETWEEN 2 AND 240),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL CONSTRAINT assignment_entitlement_period_events_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_entitlement_period_events_period_fk
    FOREIGN KEY (period_id, assignment_id, client_id, right_id)
    REFERENCES assignment_entitlement_periods(id, assignment_id, client_id, right_id) ON DELETE RESTRICT,
  CONSTRAINT assignment_entitlement_period_events_charge_fk FOREIGN KEY (charge_id) REFERENCES economic_charges(id) ON DELETE RESTRICT,
  CONSTRAINT assignment_entitlement_period_events_payload CHECK (
    (event_type='charge_linked' AND charge_id IS NOT NULL AND effective_activation_on IS NULL AND sessions_granted IS NULL)
    OR (event_type='payment_validated' AND charge_id IS NOT NULL AND effective_activation_on IS NOT NULL AND sessions_granted IS NOT NULL AND sessions_granted BETWEEN 0 AND 100000)
    OR (event_type='closed' AND charge_id IS NULL AND effective_activation_on IS NULL AND sessions_granted IS NULL)
  )
);
CREATE INDEX assignment_entitlement_period_events_timeline_idx
  ON assignment_entitlement_period_events(period_id, created_at, id);
CREATE UNIQUE INDEX assignment_entitlement_period_events_period_charge_unique
  ON assignment_entitlement_period_events(period_id,charge_id) WHERE event_type='charge_linked';
CREATE UNIQUE INDEX assignment_entitlement_period_events_payment_unique
  ON assignment_entitlement_period_events(period_id) WHERE event_type='payment_validated';
CREATE FUNCTION assignment_entitlement_period_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'entitlement period events are append-only' USING ERRCODE='55000'; END IF;
  IF NEW.event_type='charge_linked' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.charge_id::text,0));
    IF NOT EXISTS (SELECT 1 FROM economic_charges c WHERE c.id=NEW.charge_id AND c.client_id=NEW.client_id) THEN
      RAISE EXCEPTION 'period charge must belong to its client' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM assignment_entitlement_period_events e
      JOIN assignment_entitlement_periods prior ON prior.id=e.period_id
      JOIN assignment_entitlement_periods current ON current.id=NEW.period_id
      WHERE e.event_type='charge_linked' AND e.charge_id=NEW.charge_id
        AND (e.assignment_id<>NEW.assignment_id OR prior.period_start<>current.period_start OR prior.period_end<>current.period_end)
    ) THEN RAISE EXCEPTION 'charge cannot pay different assignments or period windows' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.event_type='payment_validated' AND NOT EXISTS (
    SELECT 1 FROM assignment_entitlement_period_events e
    WHERE e.period_id=NEW.period_id AND e.event_type='charge_linked' AND e.charge_id=NEW.charge_id
  ) THEN RAISE EXCEPTION 'period payment requires a linked charge' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_entitlement_period_events_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON assignment_entitlement_period_events
  FOR EACH ROW EXECUTE FUNCTION assignment_entitlement_period_events_guard();

ALTER TABLE client_entitlement_ledger ADD COLUMN entitlement_period_id uuid;
ALTER TABLE client_entitlement_ledger ADD CONSTRAINT client_entitlement_ledger_period_fk
  FOREIGN KEY (entitlement_period_id, assignment_id, client_id)
  REFERENCES assignment_entitlement_periods(id, assignment_id, client_id)
  ON DELETE RESTRICT;
CREATE INDEX client_entitlement_ledger_period_balance_idx
  ON client_entitlement_ledger(entitlement_period_id, right_key, occurred_at, id)
  WHERE entitlement_period_id IS NOT NULL;

CREATE OR REPLACE FUNCTION client_entitlement_balance_nonnegative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE existing_balance integer;
DECLARE selected_right_id uuid;
BEGIN
  IF NEW.entitlement_period_id IS NULL THEN
    -- Legacy grants remain assignment-scoped exactly as before.
    PERFORM 1 FROM client_plan_assignments WHERE id=NEW.assignment_id FOR UPDATE;
    SELECT COALESCE(sum(quantity),0)::int INTO existing_balance
    FROM client_entitlement_ledger WHERE assignment_id=NEW.assignment_id AND right_key=NEW.right_key AND entitlement_period_id IS NULL;
  ELSE
    SELECT right_id INTO selected_right_id FROM assignment_entitlement_periods WHERE id=NEW.entitlement_period_id FOR UPDATE;
    IF selected_right_id IS NULL OR NEW.right_key<>selected_right_id::text THEN
      RAISE EXCEPTION 'ledger right does not match entitlement period' USING ERRCODE='23514',CONSTRAINT='client_entitlement_ledger_period_right_match';
    END IF;
    SELECT COALESCE(sum(quantity),0)::int INTO existing_balance
    FROM client_entitlement_ledger WHERE entitlement_period_id=NEW.entitlement_period_id AND right_key=NEW.right_key;
    IF existing_balance+NEW.quantity<0 AND NEW.entry_type='consume' AND EXISTS (
      SELECT 1 FROM assignment_entitlement_periods p
      WHERE p.id=NEW.entitlement_period_id
        AND (now() AT TIME ZONE 'Atlantic/Canary')::date BETWEEN p.period_start AND LEAST(p.period_end,date_trunc('month',p.period_start)::date+9)
        AND NOT EXISTS (SELECT 1 FROM assignment_entitlement_period_events e WHERE e.period_id=p.id AND e.event_type='payment_validated')
        AND (SELECT e.enabled FROM assignment_recurrence_events e WHERE e.assignment_id=p.assignment_id AND e.effective_on<=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1) IS TRUE
    ) THEN
      -- Provisional reservations are ledgered before payment. Late settlement
      -- grants the prorated quota; prior consumption remains visible and may
      -- leave a non-positive balance without revoking existing reservations.
      RETURN NEW;
    END IF;
    IF existing_balance+NEW.quantity<0 AND NEW.entry_type='grant' AND existing_balance<0 THEN
      RETURN NEW;
    END IF;
  END IF;
  IF existing_balance+NEW.quantity<0 THEN
    RAISE EXCEPTION 'entitlement balance cannot be negative' USING ERRCODE='23514',CONSTRAINT='client_entitlement_balance_nonnegative';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE calendar_reservation_rights ADD COLUMN entitlement_period_id uuid;
ALTER TABLE calendar_reservation_rights ADD CONSTRAINT calendar_reservation_rights_period_fk
  FOREIGN KEY (entitlement_period_id, assignment_id, client_id, right_id)
  REFERENCES assignment_entitlement_periods(id, assignment_id, client_id, right_id)
  ON DELETE RESTRICT;
CREATE INDEX calendar_reservation_rights_period_bag_idx
  ON calendar_reservation_rights(entitlement_period_id, reservation_id)
  WHERE entitlement_period_id IS NOT NULL;
