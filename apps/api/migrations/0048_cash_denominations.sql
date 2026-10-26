-- Preserve the denomination detail used for opening and blind closing counts.
-- Existing cash sessions remain readable; their historical breakdown is NULL.
ALTER TABLE economic_cash_sessions
  ADD COLUMN opening_denominations jsonb,
  ADD COLUMN counted_denominations jsonb;

CREATE FUNCTION economic_cash_denominations_valid(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(value)) = 15
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(value) entry(key, quantity)
      WHERE entry.key NOT IN (
        'coin_0_01','coin_0_02','coin_0_05','coin_0_10','coin_0_20','coin_0_50','coin_1','coin_2',
        'bill_5','bill_10','bill_20','bill_50','bill_100','bill_200','bill_500'
      )
      OR jsonb_typeof(entry.quantity) <> 'number'
      OR entry.quantity::text !~ '^[0-9]+$'
      OR (entry.quantity::text)::numeric > 1000000
    );
$$;

ALTER TABLE economic_cash_sessions
  ADD CONSTRAINT economic_cash_sessions_opening_denominations_valid
    CHECK (opening_denominations IS NULL OR economic_cash_denominations_valid(opening_denominations)),
  ADD CONSTRAINT economic_cash_sessions_counted_denominations_valid
    CHECK (counted_denominations IS NULL OR economic_cash_denominations_valid(counted_denominations)),
  ADD CONSTRAINT economic_cash_sessions_counted_denominations_closed
    CHECK (counted_denominations IS NULL OR (counted_cents IS NOT NULL AND status IN ('closed','late_close')));

CREATE OR REPLACE FUNCTION economic_cash_session_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'cash sessions cannot be deleted' USING ERRCODE='55000'; END IF;
  IF OLD.status<>'open' OR NEW.status NOT IN ('closed','late_close') OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.local_date IS DISTINCT FROM OLD.local_date OR NEW.opening_cents IS DISTINCT FROM OLD.opening_cents
    OR NEW.opening_denominations IS DISTINCT FROM OLD.opening_denominations OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.closed_at IS NULL OR NEW.closed_by IS NULL
    OR NEW.counted_cents IS NULL OR NEW.counted_denominations IS NULL OR NEW.expected_cents IS NULL
    OR NEW.difference_cents IS DISTINCT FROM NEW.counted_cents-NEW.expected_cents OR NEW.close_kind IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'invalid cash session transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
