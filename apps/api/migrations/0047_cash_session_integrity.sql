-- Collections/refunds and store annulments must be attributed to today's open shift.
-- A validated bank transfer is the sole intentional NULL-shift payment (D102).
CREATE FUNCTION economic_require_current_open_cash_session(target_session uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target_date date; target_status text;
BEGIN
  SELECT local_date,status INTO target_date,target_status
    FROM economic_cash_sessions WHERE id=target_session FOR UPDATE;
  IF NOT FOUND OR target_status<>'open' OR target_date<>(now() AT TIME ZONE 'Atlantic/Canary')::date THEN
    RAISE EXCEPTION 'cash movement requires current-day open session' USING ERRCODE='23514', CONSTRAINT='economic_current_cash_session_required';
  END IF;
END $$;

CREATE FUNCTION economic_transaction_cash_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cash_session_id IS NOT NULL THEN
    PERFORM economic_require_current_open_cash_session(NEW.cash_session_id);
  ELSIF NEW.kind='payment' AND EXISTS (
    SELECT 1 FROM economic_transfer_proofs p
    JOIN economic_payment_splits s ON s.transaction_id=p.transaction_id
    WHERE p.transaction_id=NEW.id AND p.status='validated'
      AND s.method='transfer' AND s.amount_cents=NEW.amount_cents
      AND NOT EXISTS (SELECT 1 FROM economic_payment_splits other WHERE other.transaction_id=NEW.id AND other.method<>'transfer')
  ) THEN
    -- D102: a bank transfer is already settled in the bank and is not a drawer movement.
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'payment or refund requires a cash shift unless validated bank transfer' USING ERRCODE='23514', CONSTRAINT='economic_current_cash_session_required';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER economic_transactions_cash_session_guard
  AFTER INSERT ON economic_transactions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION economic_transaction_cash_session_guard();

CREATE OR REPLACE FUNCTION store_sale_payment_requires_cash_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_state='paid' THEN
    IF NEW.cash_session_id IS NULL THEN
      RAISE EXCEPTION 'paid store sale requires an open cash session' USING ERRCODE='23514', CONSTRAINT='store_sale_cash_session_required';
    END IF;
    PERFORM economic_require_current_open_cash_session(NEW.cash_session_id);
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE store_sale_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES store_sales(id) ON DELETE RESTRICT UNIQUE,
  cash_session_id uuid NOT NULL REFERENCES economic_cash_sessions(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type='annulment'),
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('cash','card','transfer','other')),
  amount_cents bigint NOT NULL CHECK (amount_cents>=0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240),
  actor_id text NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 120),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((amount_cents=0)=(payment_method IS NULL))
);
CREATE INDEX store_sale_cash_movements_session_idx ON store_sale_cash_movements(cash_session_id,occurred_at,id);

CREATE FUNCTION store_sale_cash_movement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM economic_require_current_open_cash_session(NEW.cash_session_id);
  RETURN NEW;
END $$;
CREATE TRIGGER store_sale_cash_movement_current_session
  BEFORE INSERT ON store_sale_cash_movements FOR EACH ROW EXECUTE FUNCTION store_sale_cash_movement_guard();
CREATE TRIGGER store_sale_cash_movements_immutable
  BEFORE UPDATE OR DELETE ON store_sale_cash_movements FOR EACH ROW EXECUTE FUNCTION store_reject_history_mutation();
CREATE TRIGGER store_sale_cash_movements_no_truncate
  BEFORE TRUNCATE ON store_sale_cash_movements FOR EACH STATEMENT EXECUTE FUNCTION store_reject_history_mutation();

CREATE FUNCTION store_sale_void_requires_cash_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='completed' AND NEW.status='voided' AND NOT EXISTS (
    SELECT 1 FROM store_sale_cash_movements m WHERE m.sale_id=OLD.id
  ) THEN
    RAISE EXCEPTION 'store sale annulment requires shift-linked movement' USING ERRCODE='23514', CONSTRAINT='store_sale_void_cash_movement_required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER store_sale_void_cash_movement_guard
  BEFORE UPDATE ON store_sales FOR EACH ROW EXECUTE FUNCTION store_sale_void_requires_cash_movement();
