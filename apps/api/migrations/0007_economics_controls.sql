ALTER TABLE economic_settings
  ADD COLUMN fiscal_legal_gate_open boolean NOT NULL DEFAULT false,
  ADD COLUMN document_retention_months integer CHECK (document_retention_months IS NULL OR document_retention_months BETWEEN 1 AND 1200);

ALTER TABLE calendar_audit_events DROP CONSTRAINT calendar_audit_action;
ALTER TABLE calendar_audit_events ADD CONSTRAINT calendar_audit_action CHECK (action IN ('session.created','session.generated','session.cancelled','template.archived','reservation.created','reservation.cancelled','reservation.overbooked','reservation.attendance_changed','reservation.cancelled_by_center','reservation.debt_override','waitlist.entered','waitlist.cancelled','waitlist.cancelled_by_center'));

ALTER TABLE economic_transactions
  ADD COLUMN cash_session_id uuid REFERENCES economic_cash_sessions(id) ON DELETE RESTRICT;

ALTER TABLE economic_cash_sessions
  ADD COLUMN expected_cents bigint,
  ADD COLUMN difference_cents bigint,
  ADD COLUMN close_kind text;
ALTER TABLE economic_cash_sessions DROP CONSTRAINT economic_cash_sessions_check;
ALTER TABLE economic_cash_sessions DROP CONSTRAINT economic_cash_sessions_local_date_key;
ALTER TABLE economic_cash_sessions DROP CONSTRAINT economic_cash_sessions_status_check;
ALTER TABLE economic_cash_sessions ADD CONSTRAINT economic_cash_sessions_status_check CHECK(status IN ('open','closed','late_close'));
UPDATE economic_cash_sessions SET expected_cents=opening_cents,difference_cents=counted_cents-opening_cents,close_kind='closed' WHERE status='closed';
ALTER TABLE economic_cash_sessions ADD CONSTRAINT economic_cash_sessions_close_snapshot CHECK (
  (status='open' AND closed_at IS NULL AND counted_cents IS NULL AND expected_cents IS NULL AND difference_cents IS NULL AND close_kind IS NULL)
  OR (status IN ('closed','late_close') AND closed_at IS NOT NULL AND counted_cents IS NOT NULL AND expected_cents IS NOT NULL AND difference_cents=counted_cents-expected_cents AND close_kind=status)
);
CREATE UNIQUE INDEX economic_cash_one_open_session ON economic_cash_sessions(status) WHERE status='open';

ALTER TABLE economic_charges DROP CONSTRAINT economic_charges_state_check;
ALTER TABLE economic_charges ADD CONSTRAINT economic_charges_state_check CHECK(state IN ('pending','exempt','void'));
ALTER TABLE economic_charges ADD COLUMN void_reason text, ADD COLUMN voided_by text, ADD COLUMN voided_at timestamptz;
ALTER TABLE economic_charges ADD CONSTRAINT economic_charge_void_metadata CHECK (
  (state='void' AND char_length(btrim(void_reason)) BETWEEN 3 AND 240 AND voided_by IS NOT NULL AND voided_at IS NOT NULL)
  OR (state<>'void' AND void_reason IS NULL AND voided_by IS NULL AND voided_at IS NULL)
);
ALTER TABLE client_fiscal_profiles ADD COLUMN province text;

ALTER TABLE economic_invoice_drafts ALTER COLUMN invoice_number DROP NOT NULL;
ALTER TABLE economic_invoice_drafts ALTER COLUMN series_name DROP NOT NULL;
UPDATE economic_invoice_drafts SET invoice_number=NULL,series_name=NULL;
ALTER TABLE economic_invoice_drafts ADD COLUMN document_type text NOT NULL DEFAULT 'simplified_ticket' CHECK(document_type IN ('simplified_ticket','full_invoice'));
ALTER TABLE economic_invoice_drafts ADD COLUMN source_charge_id uuid REFERENCES economic_charges(id) ON DELETE RESTRICT;
ALTER TABLE economic_invoice_drafts ADD COLUMN line_items jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(line_items)='array');
ALTER TABLE economic_invoice_drafts ADD COLUMN payment_methods jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(payment_methods)='array');
ALTER TABLE economic_invoice_drafts ADD COLUMN tax_treatment text NOT NULL DEFAULT 'taxable' CHECK(tax_treatment IN ('taxable','exempt','non_subject','mixed'));
ALTER TABLE economic_invoice_drafts ADD COLUMN tax_rate_basis_points integer CHECK(tax_rate_basis_points BETWEEN 0 AND 10000);
UPDATE economic_invoice_drafts SET tax_rate_basis_points=tax_basis_points;
ALTER TABLE economic_invoice_drafts ADD CONSTRAINT economic_invoice_draft_tax_treatment CHECK (
  (tax_treatment='taxable' AND tax_rate_basis_points IS NOT NULL)
  OR (tax_treatment IN ('exempt','non_subject','mixed') AND tax_rate_basis_points IS NULL AND (tax_treatment='mixed' OR tax_cents=0))
);

CREATE TABLE economic_fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES economic_invoice_drafts(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK(document_type IN ('simplified_ticket','full_invoice')),
  status text NOT NULL CHECK(status IN ('issued','rectified')),
  series_id uuid NOT NULL REFERENCES economic_invoice_series(id) ON DELETE RESTRICT,
  series_name text NOT NULL,
  document_number text NOT NULL,
  document_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Atlantic/Canary')::date),
  source_charge_id uuid NOT NULL REFERENCES economic_charges(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  issuer_snapshot jsonb NOT NULL CHECK(jsonb_typeof(issuer_snapshot)='object'),
  client_snapshot jsonb NOT NULL CHECK(jsonb_typeof(client_snapshot)='object'),
  lines_snapshot jsonb NOT NULL CHECK(jsonb_typeof(lines_snapshot)='array'),
  payment_methods jsonb NOT NULL CHECK(jsonb_typeof(payment_methods)='array'),
  totals_snapshot jsonb NOT NULL CHECK(jsonb_typeof(totals_snapshot)='object'),
  rectifies_document_id uuid REFERENCES economic_fiscal_documents(id) ON DELETE RESTRICT,
  issued_by text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(series_id,document_number),
  CHECK((status='rectified') = (rectifies_document_id IS NOT NULL))
);
CREATE TABLE economic_document_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  retention_months integer CHECK(retention_months IS NULL OR retention_months BETWEEN 1 AND 1200),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO economic_document_policy(singleton) VALUES(true);

CREATE FUNCTION economic_block_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'economic history cannot be truncated' USING ERRCODE='55000'; END $$;
CREATE FUNCTION economic_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'economic history cannot be deleted' USING ERRCODE='55000'; END $$;
CREATE FUNCTION economic_charge_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'economic charges cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.concept IS DISTINCT FROM OLD.concept OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.due_on IS DISTINCT FROM OLD.due_on OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.exempt_reason IS DISTINCT FROM OLD.exempt_reason THEN
    RAISE EXCEPTION 'charge definition is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.state<>'pending' OR NEW.state<>'void' OR NEW.voided_by IS NULL OR NEW.voided_at IS NULL OR char_length(btrim(COALESCE(NEW.void_reason,'')))<3 THEN
    RAISE EXCEPTION 'invalid charge state transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER economic_charge_guard BEFORE UPDATE OR DELETE ON economic_charges FOR EACH ROW EXECUTE FUNCTION economic_charge_transition_guard();

CREATE FUNCTION economic_cash_session_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'cash sessions cannot be deleted' USING ERRCODE='55000'; END IF;
  IF OLD.status<>'open' OR NEW.status NOT IN ('closed','late_close') OR NEW.id IS DISTINCT FROM OLD.id OR NEW.local_date IS DISTINCT FROM OLD.local_date OR NEW.opening_cents IS DISTINCT FROM OLD.opening_cents OR NEW.opened_by IS DISTINCT FROM OLD.opened_by OR NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.closed_at IS NULL OR NEW.closed_by IS NULL OR NEW.counted_cents IS NULL OR NEW.expected_cents IS NULL OR NEW.difference_cents IS DISTINCT FROM NEW.counted_cents-NEW.expected_cents OR NEW.close_kind IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'invalid cash session transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER economic_cash_session_guard BEFORE UPDATE OR DELETE ON economic_cash_sessions FOR EACH ROW EXECUTE FUNCTION economic_cash_session_transition_guard();

CREATE FUNCTION economic_transfer_proof_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'transfer proof history cannot be deleted' USING ERRCODE='55000'; END IF;
  IF OLD.status<>'pending_validation' OR NEW.status NOT IN ('validated','rejected') OR NEW.id IS DISTINCT FROM OLD.id OR NEW.charge_id IS DISTINCT FROM OLD.charge_id OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents OR NEW.content_type IS DISTINCT FROM OLD.content_type OR NEW.file_name IS DISTINCT FROM OLD.file_name OR NEW.file_bytes IS DISTINCT FROM OLD.file_bytes OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL OR (NEW.status='validated') IS DISTINCT FROM (NEW.transaction_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid transfer proof transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER economic_transfer_proof_guard BEFORE UPDATE OR DELETE ON economic_transfer_proofs FOR EACH ROW EXECUTE FUNCTION economic_transfer_proof_transition_guard();

CREATE FUNCTION economic_series_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'invoice series cannot be deleted' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.next_number<OLD.next_number OR (OLD.next_number>1 AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.prefix IS DISTINCT FROM OLD.prefix)) THEN
    RAISE EXCEPTION 'invoice series mutation is not allowed' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER economic_invoice_series_guard BEFORE UPDATE OR DELETE ON economic_invoice_series FOR EACH ROW EXECUTE FUNCTION economic_series_guard();
CREATE FUNCTION economic_take_next_document_number(p_series_id uuid) RETURNS TABLE(series_id uuid,series_name text,series_prefix text,numeric_number bigint,display_number text) LANGUAGE sql AS $$
  UPDATE economic_invoice_series SET next_number=next_number+1 WHERE id=p_series_id AND active=true
  RETURNING id,name,prefix,next_number-1,prefix||'-'||(next_number-1)::text
$$;

CREATE FUNCTION economic_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'issued fiscal documents are immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER economic_fiscal_documents_immutable BEFORE UPDATE OR DELETE ON economic_fiscal_documents FOR EACH ROW EXECUTE FUNCTION economic_document_guard();

CREATE FUNCTION economic_draft_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'invoice drafts cannot be deleted' USING ERRCODE='55000'; END $$;
CREATE TRIGGER economic_invoice_drafts_no_delete BEFORE DELETE ON economic_invoice_drafts FOR EACH ROW EXECUTE FUNCTION economic_draft_delete_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['economic_transactions','economic_payment_splits','economic_audit_events','economic_charges','economic_cash_adjustments','economic_cash_sessions','economic_transfer_proofs','economic_invoice_series','economic_invoice_drafts','economic_fiscal_documents'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION economic_block_truncate()', t||'_no_truncate', t);
  END LOOP;
END $$;

DROP TRIGGER economic_transactions_immutable ON economic_transactions;
CREATE TRIGGER economic_transactions_immutable BEFORE UPDATE OR DELETE ON economic_transactions FOR EACH ROW EXECUTE FUNCTION economic_immutable_rows();
CREATE TRIGGER economic_adjustments_immutable BEFORE UPDATE OR DELETE ON economic_cash_adjustments FOR EACH ROW EXECUTE FUNCTION economic_block_delete();
