-- Invoicing settings the owner fills in (A65/A66). Every field starts EMPTY: no issuer data, tax id, address or legal text is shipped in the code.
-- An invoice cannot be issued until the required issuer fields exist; issued documents keep a snapshot, so later edits never change them.

CREATE TABLE economic_invoice_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  issuer_name text CHECK (issuer_name IS NULL OR char_length(btrim(issuer_name)) BETWEEN 1 AND 160),
  issuer_tax_id text CHECK (issuer_tax_id IS NULL OR char_length(btrim(issuer_tax_id)) BETWEEN 1 AND 30),
  issuer_address text CHECK (issuer_address IS NULL OR char_length(btrim(issuer_address)) BETWEEN 1 AND 240),
  issuer_postal_code text CHECK (issuer_postal_code IS NULL OR char_length(btrim(issuer_postal_code)) BETWEEN 1 AND 20),
  issuer_locality text CHECK (issuer_locality IS NULL OR char_length(btrim(issuer_locality)) BETWEEN 1 AND 100),
  issuer_province text CHECK (issuer_province IS NULL OR char_length(btrim(issuer_province)) BETWEEN 1 AND 100),
  default_igic_basis_points integer NOT NULL DEFAULT 300 CHECK (default_igic_basis_points BETWEEN 0 AND 10000),
  default_series_id uuid REFERENCES economic_invoice_series(id) ON DELETE RESTRICT,
  footer_text text CHECK (footer_text IS NULL OR char_length(footer_text) <= 600),
  legal_text text CHECK (legal_text IS NULL OR char_length(legal_text) <= 1500),
  logo_key text CHECK (logo_key IS NULL OR logo_key ~ '^invoice-logos/[0-9a-f]{64}\.(png|jpg|svg)$'),
  logo_mime text CHECK (logo_mime IS NULL OR logo_mime IN ('image/png','image/jpeg','image/svg+xml')),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT economic_invoice_settings_logo_pair CHECK ((logo_key IS NULL) = (logo_mime IS NULL))
);
INSERT INTO economic_invoice_settings(singleton) VALUES (true);

-- A rectifying invoice states why it exists and may correct an invoice only once; the original is never modified (documents are immutable).
ALTER TABLE economic_fiscal_documents ADD COLUMN rectification_reason text CHECK (rectification_reason IS NULL OR char_length(btrim(rectification_reason)) BETWEEN 3 AND 240);
ALTER TABLE economic_fiscal_documents ADD CONSTRAINT economic_fiscal_documents_reason_required CHECK ((status = 'rectified') = (rectification_reason IS NOT NULL));
CREATE UNIQUE INDEX economic_fiscal_documents_one_rectification ON economic_fiscal_documents(rectifies_document_id) WHERE rectifies_document_id IS NOT NULL;
CREATE UNIQUE INDEX economic_fiscal_documents_one_per_draft ON economic_fiscal_documents(draft_id) WHERE rectifies_document_id IS NULL;
CREATE INDEX economic_fiscal_documents_charge_idx ON economic_fiscal_documents(source_charge_id, issued_at);
