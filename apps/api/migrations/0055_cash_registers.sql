-- A58: two physical registers with independent sessions and custody.
-- Existing sessions stay unassigned (register_id NULL); never infer their register.
CREATE TABLE economic_cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code IN ('bunker','sala')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO economic_cash_registers(code,name) VALUES
  ('bunker','Búnker'),
  ('sala','Sala')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE economic_cash_sessions
  ADD COLUMN register_id uuid REFERENCES economic_cash_registers(id) ON DELETE RESTRICT;

DROP INDEX economic_cash_one_open_session;
CREATE UNIQUE INDEX economic_cash_one_open_session_per_register
  ON economic_cash_sessions(register_id) WHERE status='open' AND register_id IS NOT NULL;
CREATE UNIQUE INDEX economic_cash_one_session_per_register_day
  ON economic_cash_sessions(register_id,local_date) WHERE register_id IS NOT NULL;
CREATE INDEX economic_cash_register_history_idx
  ON economic_cash_sessions(register_id,local_date DESC,opened_at DESC);

-- A validated transfer is bound to its proof before the deferred payment guard
-- evaluates the completed transaction at commit (D102; no drawer movement).
ALTER TABLE economic_transfer_proofs
  DROP CONSTRAINT economic_transfer_proofs_transaction_id_fkey;
ALTER TABLE economic_transfer_proofs
  ADD CONSTRAINT economic_transfer_proofs_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES economic_transactions(id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE economic_cash_custodies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL REFERENCES economic_cash_sessions(id) ON DELETE RESTRICT,
  professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  actor_id text NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 120),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_reason text CHECK (ended_reason IS NULL OR ended_reason IN ('closed','handover','owner_resolution')),
  ended_by text,
  CHECK ((ended_at IS NULL) = (ended_reason IS NULL)),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CREATE UNIQUE INDEX economic_cash_one_custodian_per_session
  ON economic_cash_custodies(cash_session_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX economic_cash_one_register_per_actor
  ON economic_cash_custodies(actor_id) WHERE ended_at IS NULL;
CREATE INDEX economic_cash_custody_actor_history_idx
  ON economic_cash_custodies(actor_id,started_at DESC,id DESC);

CREATE TABLE economic_cash_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL REFERENCES economic_cash_sessions(id) ON DELETE RESTRICT,
  outgoing_custody_id uuid NOT NULL REFERENCES economic_cash_custodies(id) ON DELETE RESTRICT,
  outgoing_actor_id text NOT NULL CHECK (char_length(btrim(outgoing_actor_id)) BETWEEN 1 AND 120),
  incoming_professional_id uuid NOT NULL REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  incoming_actor_id text NOT NULL CHECK (char_length(btrim(incoming_actor_id)) BETWEEN 1 AND 120),
  outgoing_denominations jsonb,
  incoming_denominations jsonb,
  outgoing_confirmed_at timestamptz,
  incoming_confirmed_at timestamptz,
  completed_at timestamptz,
  mismatch boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (incoming_actor_id <> outgoing_actor_id),
  CHECK ((outgoing_denominations IS NULL) = (outgoing_confirmed_at IS NULL)),
  CHECK ((incoming_denominations IS NULL) = (incoming_confirmed_at IS NULL)),
  CHECK ((completed_at IS NULL AND mismatch IS NULL) OR (completed_at IS NOT NULL AND mismatch IS NOT NULL
    AND outgoing_denominations IS NOT NULL AND incoming_denominations IS NOT NULL
    AND outgoing_confirmed_at IS NOT NULL AND incoming_confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX economic_cash_one_pending_handover_per_session
  ON economic_cash_handovers(cash_session_id) WHERE completed_at IS NULL;
CREATE INDEX economic_cash_handover_session_history_idx
  ON economic_cash_handovers(cash_session_id,created_at,id);

CREATE TABLE economic_cash_outflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_session_id uuid NOT NULL REFERENCES economic_cash_sessions(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('withdrawal','expense')),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000000),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240),
  receipt_content_type text CHECK (receipt_content_type IS NULL OR receipt_content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  receipt_file_name text,
  receipt_bytes bytea,
  actor_id text NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending_owner_approval','approved','rejected')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((receipt_content_type IS NULL AND receipt_file_name IS NULL AND receipt_bytes IS NULL)
    OR (receipt_content_type IS NOT NULL AND receipt_file_name IS NOT NULL AND char_length(receipt_file_name) BETWEEN 1 AND 180
      AND receipt_bytes IS NOT NULL AND octet_length(receipt_bytes) BETWEEN 1 AND 2097152)),
  CHECK ((status='pending_owner_approval' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (status='rejected' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX economic_cash_outflows_session_idx ON economic_cash_outflows(cash_session_id,created_at,id);
CREATE INDEX economic_cash_outflows_pending_idx ON economic_cash_outflows(created_at,id) WHERE status='pending_owner_approval';

CREATE TABLE economic_cash_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  outflow_limit_cents bigint CHECK (outflow_limit_cents IS NULL OR outflow_limit_cents BETWEEN 1 AND 100000000000),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO economic_cash_settings(singleton,outflow_limit_cents) VALUES (true,NULL);

CREATE FUNCTION economic_cash_denomination_total(value jsonb) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(sum((entry.value::text)::bigint * CASE entry.key
    WHEN 'coin_0_01' THEN 1 WHEN 'coin_0_02' THEN 2 WHEN 'coin_0_05' THEN 5
    WHEN 'coin_0_10' THEN 10 WHEN 'coin_0_20' THEN 20 WHEN 'coin_0_50' THEN 50
    WHEN 'coin_1' THEN 100 WHEN 'coin_2' THEN 200 WHEN 'bill_5' THEN 500
    WHEN 'bill_10' THEN 1000 WHEN 'bill_20' THEN 2000 WHEN 'bill_50' THEN 5000
    WHEN 'bill_100' THEN 10000 WHEN 'bill_200' THEN 20000 WHEN 'bill_500' THEN 50000 END),0)::bigint
  FROM jsonb_each(value) entry(key,value)
  WHERE entry.key IN ('coin_0_01','coin_0_02','coin_0_05','coin_0_10','coin_0_20','coin_0_50','coin_1','coin_2','bill_5','bill_10','bill_20','bill_50','bill_100','bill_200','bill_500')
$$;
ALTER TABLE economic_cash_handovers ADD CONSTRAINT economic_cash_handover_mismatch_matches_counts CHECK (
  completed_at IS NULL OR mismatch=(economic_cash_denomination_total(outgoing_denominations) <> economic_cash_denomination_total(incoming_denominations))
);

ALTER TABLE economic_cash_handovers
  ADD CONSTRAINT economic_cash_handover_denominations_valid CHECK (
    (outgoing_denominations IS NULL OR economic_cash_denominations_valid(outgoing_denominations)) AND
    (incoming_denominations IS NULL OR economic_cash_denominations_valid(incoming_denominations))
  );

CREATE OR REPLACE FUNCTION economic_require_current_open_cash_session(target_session uuid, target_actor text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target_date date; target_status text; target_register uuid; custodian_actor text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('2j-economic-register-operations'));
  IF EXISTS (SELECT 1 FROM economic_cash_sessions WHERE status='open' AND register_id IS NULL) THEN
    RAISE EXCEPTION 'unassigned legacy cash session requires owner resolution' USING ERRCODE='23514', CONSTRAINT='economic_legacy_cash_session_requires_resolution';
  END IF;
  SELECT local_date,status,register_id INTO target_date,target_status,target_register
    FROM economic_cash_sessions WHERE id=target_session FOR UPDATE;
  IF NOT FOUND OR target_status<>'open' OR target_date<>(now() AT TIME ZONE 'Atlantic/Canary')::date OR target_register IS NULL THEN
    RAISE EXCEPTION 'cash movement requires current-day open register session' USING ERRCODE='23514', CONSTRAINT='economic_current_cash_session_required';
  END IF;
  IF target_actor IS NOT NULL THEN
    SELECT actor_id INTO custodian_actor FROM economic_cash_custodies
      WHERE cash_session_id=target_session AND ended_at IS NULL FOR UPDATE;
    IF custodian_actor IS DISTINCT FROM target_actor THEN
      RAISE EXCEPTION 'cash movement actor is not current register custodian' USING ERRCODE='23514', CONSTRAINT='economic_cash_custodian_required';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM economic_cash_sessions WHERE status='open' AND local_date<(now() AT TIME ZONE 'Atlantic/Canary')::date) THEN
    RAISE EXCEPTION 'previous-day cash session requires owner resolution' USING ERRCODE='23514', CONSTRAINT='economic_previous_day_cash_session_requires_resolution';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION economic_cash_session_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('2j-economic-register-operations'));
  IF NEW.register_id IS NULL OR NEW.status<>'open' OR NOT economic_cash_denominations_valid(NEW.opening_denominations) THEN
    RAISE EXCEPTION 'new cash session requires a physical register and open state' USING ERRCODE='23514', CONSTRAINT='economic_cash_register_required';
  END IF;
  IF EXISTS (SELECT 1 FROM economic_cash_sessions WHERE status='open' AND register_id IS NULL) THEN
    RAISE EXCEPTION 'unassigned legacy cash session requires owner resolution' USING ERRCODE='23514', CONSTRAINT='economic_legacy_cash_session_requires_resolution';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER economic_cash_session_register_insert_guard
  BEFORE INSERT ON economic_cash_sessions FOR EACH ROW EXECUTE FUNCTION economic_cash_session_insert_guard();

CREATE OR REPLACE FUNCTION economic_transaction_cash_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cash_session_id IS NOT NULL THEN
    PERFORM economic_require_current_open_cash_session(NEW.cash_session_id,NEW.actor_id);
  ELSIF NEW.kind='payment' AND EXISTS (
    SELECT 1 FROM economic_transfer_proofs p
    JOIN economic_payment_splits s ON s.transaction_id=p.transaction_id
    WHERE p.transaction_id=NEW.id AND p.status='validated'
      AND s.method='transfer' AND s.amount_cents=NEW.amount_cents
      AND NOT EXISTS (SELECT 1 FROM economic_payment_splits other WHERE other.transaction_id=NEW.id AND other.method<>'transfer')
  ) THEN RETURN NEW;
  ELSE
    RAISE EXCEPTION 'payment or refund requires an open register unless validated bank transfer' USING ERRCODE='23514', CONSTRAINT='economic_current_cash_session_required';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION store_sale_payment_requires_cash_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_state='paid' THEN
    IF NEW.cash_session_id IS NULL THEN
      RAISE EXCEPTION 'paid store sale requires an open register' USING ERRCODE='23514', CONSTRAINT='store_sale_cash_session_required';
    END IF;
    PERFORM economic_require_current_open_cash_session(NEW.cash_session_id,NEW.created_by);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION store_sale_cash_movement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM economic_require_current_open_cash_session(NEW.cash_session_id,NEW.actor_id);
  RETURN NEW;
END $$;

-- Reattach the D113 guards to the replacement functions defined in this migration.
DROP TRIGGER IF EXISTS economic_transactions_cash_session_guard ON economic_transactions;
CREATE CONSTRAINT TRIGGER economic_transactions_cash_session_guard
  AFTER INSERT ON economic_transactions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION economic_transaction_cash_session_guard();

DROP TRIGGER IF EXISTS store_sale_payment_cash_session_guard ON store_sales;
CREATE TRIGGER store_sale_payment_cash_session_guard
  BEFORE INSERT ON store_sales
  FOR EACH ROW EXECUTE FUNCTION store_sale_payment_requires_cash_session();
DROP TRIGGER IF EXISTS store_sale_payment_cash_session_update_guard ON store_sales;
CREATE TRIGGER store_sale_payment_cash_session_update_guard
  BEFORE UPDATE OF payment_state,cash_session_id,created_by ON store_sales
  FOR EACH ROW EXECUTE FUNCTION store_sale_payment_requires_cash_session();

DROP TRIGGER IF EXISTS store_sale_cash_movement_current_session ON store_sale_cash_movements;
CREATE TRIGGER store_sale_cash_movement_current_session
  BEFORE INSERT ON store_sale_cash_movements FOR EACH ROW EXECUTE FUNCTION store_sale_cash_movement_guard();

CREATE OR REPLACE FUNCTION economic_cash_adjustment_register_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM economic_require_current_open_cash_session(NEW.cash_session_id,NEW.actor_id);
  RETURN NEW;
END $$;
CREATE TRIGGER economic_cash_adjustment_register_guard
  BEFORE INSERT ON economic_cash_adjustments FOR EACH ROW EXECUTE FUNCTION economic_cash_adjustment_register_guard();

CREATE FUNCTION economic_cash_custody_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.id IS DISTINCT FROM NEW.id OR OLD.cash_session_id IS DISTINCT FROM NEW.cash_session_id
    OR OLD.professional_id IS DISTINCT FROM NEW.professional_id OR OLD.actor_id IS DISTINCT FROM NEW.actor_id
    OR OLD.started_at IS DISTINCT FROM NEW.started_at OR OLD.ended_at IS NOT NULL
    OR NEW.ended_at IS NULL OR NEW.ended_by IS NULL OR NEW.ended_reason IS NULL THEN
    RAISE EXCEPTION 'cash custody history is append-only except for one release transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER economic_cash_custody_protect BEFORE UPDATE OR DELETE ON economic_cash_custodies FOR EACH ROW EXECUTE FUNCTION economic_cash_custody_immutable();
CREATE TRIGGER economic_cash_custody_no_truncate BEFORE TRUNCATE ON economic_cash_custodies FOR EACH STATEMENT EXECUTE FUNCTION store_reject_history_mutation();

CREATE FUNCTION economic_cash_handover_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.completed_at IS NOT NULL OR OLD.id IS DISTINCT FROM NEW.id
    OR OLD.cash_session_id IS DISTINCT FROM NEW.cash_session_id OR OLD.outgoing_custody_id IS DISTINCT FROM NEW.outgoing_custody_id
    OR OLD.outgoing_actor_id IS DISTINCT FROM NEW.outgoing_actor_id OR OLD.incoming_professional_id IS DISTINCT FROM NEW.incoming_professional_id
    OR OLD.incoming_actor_id IS DISTINCT FROM NEW.incoming_actor_id OR OLD.outgoing_denominations IS DISTINCT FROM NEW.outgoing_denominations
    OR OLD.outgoing_confirmed_at IS DISTINCT FROM NEW.outgoing_confirmed_at OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.incoming_denominations IS NOT NULL OR NEW.incoming_denominations IS NULL OR NEW.incoming_confirmed_at IS NULL OR NEW.completed_at IS NULL OR NEW.mismatch IS NULL THEN
    RAISE EXCEPTION 'cash handover history is append-only except for its single receiver confirmation' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER economic_cash_handovers_protect BEFORE UPDATE OR DELETE ON economic_cash_handovers FOR EACH ROW EXECUTE FUNCTION economic_cash_handover_immutable();
CREATE FUNCTION economic_cash_handover_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'cash handover history is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER economic_cash_handovers_no_truncate BEFORE TRUNCATE ON economic_cash_handovers FOR EACH STATEMENT EXECUTE FUNCTION economic_cash_handover_no_truncate();

CREATE FUNCTION economic_cash_outflow_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.id IS DISTINCT FROM NEW.id OR OLD.cash_session_id IS DISTINCT FROM NEW.cash_session_id
    OR OLD.movement_type IS DISTINCT FROM NEW.movement_type OR OLD.amount_cents IS DISTINCT FROM NEW.amount_cents
    OR OLD.reason IS DISTINCT FROM NEW.reason OR OLD.receipt_content_type IS DISTINCT FROM NEW.receipt_content_type
    OR OLD.receipt_file_name IS DISTINCT FROM NEW.receipt_file_name OR OLD.receipt_bytes IS DISTINCT FROM NEW.receipt_bytes
    OR OLD.actor_id IS DISTINCT FROM NEW.actor_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.status<>'pending_owner_approval' OR NEW.status NOT IN ('approved','rejected')
    OR NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'cash outflow history is append-only except owner decision' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER economic_cash_outflow_protect BEFORE UPDATE OR DELETE ON economic_cash_outflows FOR EACH ROW EXECUTE FUNCTION economic_cash_outflow_protect();
CREATE FUNCTION economic_cash_outflow_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'cash outflow history is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER economic_cash_outflows_no_truncate BEFORE TRUNCATE ON economic_cash_outflows FOR EACH STATEMENT EXECUTE FUNCTION economic_cash_outflow_no_truncate();

CREATE FUNCTION economic_cash_outflow_register_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configured_limit bigint;
BEGIN
  SELECT outflow_limit_cents INTO configured_limit FROM economic_cash_settings WHERE singleton=true;
  IF configured_limit IS NOT NULL AND NEW.amount_cents>configured_limit AND NEW.status<>'pending_owner_approval' THEN
    RAISE EXCEPTION 'cash outflow exceeds owner approval limit' USING ERRCODE='23514', CONSTRAINT='economic_cash_outflow_owner_approval_required';
  END IF;
  PERFORM economic_require_current_open_cash_session(NEW.cash_session_id,NEW.actor_id);
  RETURN NEW;
END $$;
CREATE TRIGGER economic_cash_outflow_current_session
  BEFORE INSERT ON economic_cash_outflows FOR EACH ROW EXECUTE FUNCTION economic_cash_outflow_register_guard();

CREATE OR REPLACE FUNCTION economic_cash_session_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reopen_audit boolean; reopen_actor text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'cash sessions cannot be deleted' USING ERRCODE='55000'; END IF;
  IF OLD.status IN ('closed','late_close') AND NEW.status='open' AND NEW.id=OLD.id
    AND NEW.local_date=OLD.local_date AND NEW.register_id=OLD.register_id
    AND NEW.opening_cents=OLD.opening_cents AND NEW.opening_denominations=OLD.opening_denominations
    AND NEW.opened_by=OLD.opened_by AND NEW.opened_at=OLD.opened_at
    AND NEW.closed_at IS NULL AND NEW.closed_by IS NULL AND NEW.expected_cents IS NULL
    AND NEW.counted_cents IS NULL AND NEW.counted_denominations IS NULL
    AND NEW.difference_cents IS NULL AND NEW.close_kind IS NULL THEN
    reopen_actor := NULLIF(current_setting('twoj.cash_reopen_actor',true),'');
    SELECT EXISTS(SELECT 1 FROM economic_audit_events e WHERE e.resource_type='cash_session'
      AND e.resource_id=OLD.id AND e.action='cash.reopened'
      AND e.actor_id=reopen_actor AND reopen_actor IS NOT NULL
      AND e.occurred_at >= clock_timestamp()-interval '5 minutes'
      AND e.xmin::text=pg_current_xact_id()::text
      AND e.details->>'registerId'=OLD.register_id::text
      AND e.details->>'localDate'=OLD.local_date::text
      AND e.details ? 'openingDenominations' AND e.details ? 'custodianActorId') INTO reopen_audit;
    IF reopen_audit THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'owner audit required to reopen cash session' USING ERRCODE='55000';
  END IF;
  IF OLD.status<>'open' OR NEW.status NOT IN ('closed','late_close') OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.local_date IS DISTINCT FROM OLD.local_date OR NEW.register_id IS DISTINCT FROM OLD.register_id
    OR NEW.opening_cents IS DISTINCT FROM OLD.opening_cents OR NEW.opening_denominations IS DISTINCT FROM OLD.opening_denominations
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.closed_at IS NULL OR NEW.closed_by IS NULL OR NEW.counted_cents IS NULL OR NEW.counted_denominations IS NULL
    OR NEW.expected_cents IS NULL OR NEW.difference_cents IS DISTINCT FROM NEW.counted_cents-NEW.expected_cents
    OR NEW.close_kind IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'invalid cash session transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION staff_timeclock_cash_custody_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type='clock_out' THEN
    PERFORM pg_advisory_xact_lock(hashtext('2j-economic-register-operations'));
    IF EXISTS (SELECT 1 FROM economic_cash_custodies WHERE professional_id=NEW.professional_id AND ended_at IS NULL) THEN
      RAISE EXCEPTION 'cash register must be closed or handed over before clock-out' USING ERRCODE='23514', CONSTRAINT='staff_clock_out_requires_cash_release';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_timeclock_cash_custody_guard
  BEFORE INSERT ON staff_timeclock_events FOR EACH ROW EXECUTE FUNCTION staff_timeclock_cash_custody_guard();

-- Owner-configurable limit has no implicit/default cap. Permission is separate from cash management.
ALTER TABLE domain_events_outbox DROP CONSTRAINT domain_events_outbox_event_type_check;
ALTER TABLE domain_events_outbox ADD CONSTRAINT domain_events_outbox_event_type_check CHECK (event_type IN (
  'booking.confirmed','booking.cancelled','waitlist.joined','waitlist.promoted','message.created','reminder.booking',
  'entitlement.expiring','entitlement.low_balance','document.pending','staff.substitution','staff.transfer_pending',
  'staff.timeclock_update','staff.cash_legacy_resolved'
));
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'booking_confirmed','booking_cancelled','waitlist_joined','waitlist_promoted','message_received','booking_reminder',
  'entitlement_expiring','entitlement_low_balance','document_pending','staff_substitution','staff_transfer_pending',
  'staff_timeclock_update','staff_cash_legacy_resolved'
));
