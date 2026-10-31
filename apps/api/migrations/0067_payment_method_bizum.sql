-- Bizum pasa a ser un método de cobro propio (antes se guardaba como «otro»). Solo amplía los valores admitidos:
-- no cambia filas existentes ni las reglas de caja (Bizum, como «otro», exige caja abierta; solo la transferencia validada queda exenta).
ALTER TABLE economic_payment_splits
  DROP CONSTRAINT economic_payment_splits_method_check,
  ADD CONSTRAINT economic_payment_splits_method_check CHECK (method IN ('cash','card','transfer','bizum','direct_debit','other'));
ALTER TABLE store_sales
  DROP CONSTRAINT store_sales_payment_method_check,
  ADD CONSTRAINT store_sales_payment_method_check CHECK (payment_method IS NULL OR payment_method IN ('cash','card','transfer','bizum','other'));
ALTER TABLE store_sale_cash_movements
  DROP CONSTRAINT store_sale_cash_movements_payment_method_check,
  ADD CONSTRAINT store_sale_cash_movements_payment_method_check CHECK (payment_method IS NULL OR payment_method IN ('cash','card','transfer','bizum','other'));
