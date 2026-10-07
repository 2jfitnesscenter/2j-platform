ALTER TABLE services ALTER COLUMN status DROP DEFAULT;
ALTER TABLE plans ALTER COLUMN currency DROP DEFAULT;
ALTER TABLE plans ALTER COLUMN currency DROP NOT NULL;
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_price_minor_check;
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_price_currency_required;
ALTER TABLE plans ADD CONSTRAINT plans_price_currency_required CHECK (price_minor IS NULL OR (price_minor >= 0 AND currency IS NOT NULL));
