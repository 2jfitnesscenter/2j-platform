-- A67: immutable sale-line discounts and buyer notes preserved on issued fiscal documents.
ALTER TABLE store_sale_lines
  ADD COLUMN discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents BETWEEN 0 AND unit_price_cents),
  ADD COLUMN discount_reason text CHECK (discount_reason IS NULL OR char_length(btrim(discount_reason)) BETWEEN 3 AND 240),
  ADD COLUMN igic_basis_points integer CHECK (igic_basis_points BETWEEN 0 AND 10000),
  ADD COLUMN tax_cents bigint CHECK (tax_cents BETWEEN 0 AND line_total_cents),
  ADD CONSTRAINT store_sale_lines_igic_pair CHECK ((igic_basis_points IS NULL) = (tax_cents IS NULL));

ALTER TABLE store_sale_lines
  DROP CONSTRAINT store_sale_lines_check,
  ADD CONSTRAINT store_sale_lines_discount_reason_required CHECK ((discount_cents = 0) = (discount_reason IS NULL)),
  ADD CONSTRAINT store_sale_lines_discount_total CHECK (line_total_cents = (unit_price_cents - discount_cents) * quantity);

ALTER TABLE economic_invoice_drafts
  ADD COLUMN invoice_note text CHECK (invoice_note IS NULL OR char_length(invoice_note) <= 1000);
ALTER TABLE economic_fiscal_documents
  ADD COLUMN invoice_note text CHECK (invoice_note IS NULL OR char_length(invoice_note) <= 1000);
