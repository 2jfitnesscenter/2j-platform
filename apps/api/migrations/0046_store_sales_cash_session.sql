ALTER TABLE store_sales
  ADD COLUMN cash_session_id uuid REFERENCES economic_cash_sessions(id) ON DELETE RESTRICT;

CREATE INDEX store_sales_cash_session_idx
  ON store_sales(cash_session_id, created_at, id)
  WHERE cash_session_id IS NOT NULL;

CREATE FUNCTION store_sale_payment_requires_cash_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_state='paid' AND NEW.cash_session_id IS NULL THEN
    RAISE EXCEPTION 'paid store sale requires an open cash session' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER store_sale_payment_cash_session_guard
  BEFORE INSERT ON store_sales
  FOR EACH ROW EXECUTE FUNCTION store_sale_payment_requires_cash_session();
