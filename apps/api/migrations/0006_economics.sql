CREATE TABLE economic_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  due_day smallint NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  timezone text NOT NULL DEFAULT 'Atlantic/Canary' CHECK (timezone = 'Atlantic/Canary'),
  debt_blocks_new_reservations boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text
);
INSERT INTO economic_settings(singleton) VALUES (true);

CREATE TABLE economic_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  plan_id uuid REFERENCES plans(id) ON DELETE RESTRICT, concept text NOT NULL CHECK (char_length(btrim(concept)) BETWEEN 1 AND 160),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000000), due_on date NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','exempt')),
  exempt_reason text, created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 120), created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key uuid NOT NULL UNIQUE, request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((state='exempt') = (exempt_reason IS NOT NULL)), UNIQUE(id,client_id)
);
CREATE INDEX economic_charges_client_due_idx ON economic_charges(client_id,due_on DESC,id DESC);
CREATE INDEX economic_charges_debt_idx ON economic_charges(due_on,id) WHERE state='pending';

CREATE TABLE economic_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), charge_id uuid NOT NULL, client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('payment','refund')), amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000000),
  refund_of uuid REFERENCES economic_transactions(id) ON DELETE RESTRICT,
  note text, actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 120), created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key uuid NOT NULL UNIQUE, request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  FOREIGN KEY(charge_id,client_id) REFERENCES economic_charges(id,client_id) ON DELETE RESTRICT,
  CHECK ((kind='refund') = (refund_of IS NOT NULL)), UNIQUE(id,charge_id)
);
CREATE INDEX economic_transactions_charge_idx ON economic_transactions(charge_id,created_at,id);

CREATE TABLE economic_payment_splits (
  transaction_id uuid NOT NULL REFERENCES economic_transactions(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('cash','card','transfer','direct_debit','other')),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000000),
  PRIMARY KEY(transaction_id,method)
);

CREATE FUNCTION economic_assert_split_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE txn uuid; expected bigint; actual bigint;
BEGIN
  txn := COALESCE((to_jsonb(NEW)->>'transaction_id')::uuid,(to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'transaction_id')::uuid,(to_jsonb(OLD)->>'id')::uuid);
  SELECT amount_cents INTO expected FROM economic_transactions WHERE id=txn;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(amount_cents),0) INTO actual FROM economic_payment_splits WHERE transaction_id=txn;
  IF actual <> expected THEN RAISE EXCEPTION 'payment splits must equal transaction amount' USING ERRCODE='23514', CONSTRAINT='economic_split_total'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER economic_split_total_from_txn AFTER INSERT ON economic_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION economic_assert_split_total();
CREATE CONSTRAINT TRIGGER economic_split_total_from_split AFTER INSERT OR UPDATE OR DELETE ON economic_payment_splits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION economic_assert_split_total();

CREATE TABLE economic_cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), local_date date NOT NULL UNIQUE,
  opening_cents bigint NOT NULL CHECK (opening_cents BETWEEN 0 AND 100000000000),
  counted_cents bigint CHECK (counted_cents BETWEEN 0 AND 100000000000), status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  opened_by text NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(), closed_by text, closed_at timestamptz,
  CHECK ((status='open' AND closed_at IS NULL AND counted_cents IS NULL) OR (status='closed' AND closed_at IS NOT NULL AND counted_cents IS NOT NULL))
);
CREATE TABLE economic_cash_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cash_session_id uuid NOT NULL REFERENCES economic_cash_sessions(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN -100000000000 AND 100000000000 AND amount_cents<>0),
  reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 3 AND 240), actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE economic_transfer_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), charge_id uuid NOT NULL REFERENCES economic_charges(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000000), content_type text NOT NULL CHECK(content_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
  file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 180), file_bytes bytea NOT NULL CHECK(octet_length(file_bytes) BETWEEN 1 AND 2097152),
  sha256 char(64) NOT NULL, status text NOT NULL DEFAULT 'pending_validation' CHECK(status IN ('pending_validation','validated','rejected')),
  submitted_by text NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(), reviewed_by text, reviewed_at timestamptz,
  decision_note text, transaction_id uuid REFERENCES economic_transactions(id) ON DELETE RESTRICT,
  UNIQUE(charge_id,sha256), CHECK ((status='pending_validation' AND reviewed_at IS NULL AND transaction_id IS NULL) OR (status<>'pending_validation' AND reviewed_at IS NOT NULL)),
  CHECK ((status='validated') = (transaction_id IS NOT NULL))
);

CREATE TABLE client_fiscal_profiles (
  client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE RESTRICT, legal_name text NOT NULL CHECK(char_length(btrim(legal_name)) BETWEEN 1 AND 160),
  tax_id text, billing_address text, postal_code text, locality text, country_code char(2) NOT NULL DEFAULT 'ES', updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE economic_invoice_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE CHECK(char_length(btrim(name)) BETWEEN 1 AND 80), prefix text NOT NULL CHECK(char_length(prefix) BETWEEN 1 AND 20),
  next_number bigint NOT NULL DEFAULT 1 CHECK(next_number > 0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE economic_invoice_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  series_id uuid NOT NULL REFERENCES economic_invoice_series(id) ON DELETE RESTRICT, series_name text NOT NULL, invoice_number text NOT NULL,
  concept text NOT NULL CHECK(char_length(btrim(concept)) BETWEEN 1 AND 240), net_cents bigint NOT NULL CHECK(net_cents BETWEEN 0 AND 100000000000),
  tax_basis_points integer NOT NULL CHECK(tax_basis_points BETWEEN 0 AND 10000), tax_cents bigint NOT NULL CHECK(tax_cents BETWEEN 0 AND 100000000000),
  gross_cents bigint NOT NULL CHECK(gross_cents=net_cents+tax_cents), tax_description text,
  fiscal_snapshot jsonb NOT NULL CHECK(jsonb_typeof(fiscal_snapshot)='object'), status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), idempotency_key uuid NOT NULL UNIQUE, request_hash char(64) NOT NULL,
  UNIQUE(series_id,invoice_number)
);

CREATE TABLE economic_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL, action text NOT NULL, resource_type text NOT NULL,
  resource_id uuid NOT NULL, client_id uuid REFERENCES clients(id) ON DELETE RESTRICT, details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object'), occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX economic_audit_client_timeline_idx ON economic_audit_events(client_id,occurred_at DESC,id DESC);
CREATE FUNCTION economic_immutable_rows() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'economic records are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER economic_transactions_immutable BEFORE UPDATE OR DELETE ON economic_transactions FOR EACH ROW EXECUTE FUNCTION economic_immutable_rows();
CREATE TRIGGER economic_splits_immutable BEFORE UPDATE OR DELETE ON economic_payment_splits FOR EACH ROW EXECUTE FUNCTION economic_immutable_rows();
CREATE TRIGGER economic_audit_immutable BEFORE UPDATE OR DELETE ON economic_audit_events FOR EACH ROW EXECUTE FUNCTION economic_immutable_rows();
