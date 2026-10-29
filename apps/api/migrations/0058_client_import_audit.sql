CREATE TABLE client_import_preview_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  source_format text NOT NULL CHECK (source_format IN ('csv','xlsx')),
  row_count integer NOT NULL CHECK (row_count BETWEEN 0 AND 500),
  valid_count integer NOT NULL CHECK (valid_count BETWEEN 0 AND row_count),
  invalid_count integer NOT NULL CHECK (invalid_count BETWEEN 0 AND row_count),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_import_preview_actor_length CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  CONSTRAINT client_import_preview_counts CHECK (valid_count + invalid_count = row_count)
);

CREATE INDEX client_import_preview_actor_idx ON client_import_preview_audit(actor_id, created_at DESC, id DESC);

CREATE FUNCTION client_import_preview_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'client import preview audit is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER client_import_preview_audit_no_change BEFORE UPDATE OR DELETE ON client_import_preview_audit
  FOR EACH ROW EXECUTE FUNCTION client_import_preview_audit_immutable();
CREATE TRIGGER client_import_preview_audit_no_truncate BEFORE TRUNCATE ON client_import_preview_audit
  FOR EACH STATEMENT EXECUTE FUNCTION client_import_preview_audit_immutable();
REVOKE DELETE, TRUNCATE ON client_import_preview_audit FROM PUBLIC;
