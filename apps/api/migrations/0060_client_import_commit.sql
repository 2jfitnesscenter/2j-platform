-- Real client import (A62/A63): the owner confirms a previewed TIMP file on screen and the clients are created in one transaction.
-- Additive only: every new column is nullable, so manually created clients are untouched. No debt, charges or payments are imported.

CREATE TABLE client_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  source_format text NOT NULL CHECK (source_format IN ('csv','xlsx','xls')),
  file_digest char(64) NOT NULL UNIQUE,
  row_count integer NOT NULL CHECK (row_count BETWEEN 0 AND 2000),
  created_count integer NOT NULL CHECK (created_count BETWEEN 0 AND row_count),
  skipped_count integer NOT NULL CHECK (skipped_count BETWEEN 0 AND row_count),
  active_count integer NOT NULL CHECK (active_count BETWEEN 0 AND created_count),
  inactive_count integer NOT NULL CHECK (inactive_count BETWEEN 0 AND created_count),
  incomplete_count integer NOT NULL CHECK (incomplete_count BETWEEN 0 AND created_count),
  email_not_stored_count integer NOT NULL CHECK (email_not_stored_count BETWEEN 0 AND created_count),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_import_runs_actor_length CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  CONSTRAINT client_import_runs_digest_format CHECK (file_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_import_runs_counts CHECK (created_count + skipped_count = row_count AND active_count + inactive_count = created_count)
);

-- Bind a confirmation to the exact previewed file and Canary-local activity cutoff.
-- These values contain no client data and are append-only with the existing audit row.
ALTER TABLE client_import_preview_audit
  ADD COLUMN file_digest char(64),
  ADD COLUMN as_of_date date,
  ADD CONSTRAINT client_import_preview_file_digest_format CHECK (file_digest IS NULL OR file_digest ~ '^[0-9a-f]{64}$');

CREATE FUNCTION client_import_runs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'client import runs are append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER client_import_runs_no_change BEFORE UPDATE OR DELETE ON client_import_runs
  FOR EACH ROW EXECUTE FUNCTION client_import_runs_immutable();
CREATE TRIGGER client_import_runs_no_truncate BEFORE TRUNCATE ON client_import_runs
  FOR EACH STATEMENT EXECUTE FUNCTION client_import_runs_immutable();
REVOKE DELETE, TRUNCATE ON client_import_runs FROM PUBLIC;

ALTER TABLE clients
  ADD COLUMN import_run_id uuid REFERENCES client_import_runs(id) ON DELETE RESTRICT,
  ADD COLUMN import_source text,
  ADD COLUMN external_ref text,
  ADD COLUMN member_number text,
  ADD COLUMN gender text,
  ADD COLUMN joined_on date,
  ADD COLUMN last_reservation_on date,
  ADD COLUMN import_provenance text,
  ADD COLUMN import_tags text,
  ADD COLUMN import_incomplete_fields text[],
  ADD COLUMN import_review_flags text[];

ALTER TABLE clients
  ADD CONSTRAINT clients_import_source_allowed CHECK (import_source IS NULL OR import_source = 'timp'),
  ADD CONSTRAINT clients_import_ref_pair CHECK ((import_source IS NULL) = (external_ref IS NULL)),
  ADD CONSTRAINT clients_external_ref_length CHECK (external_ref IS NULL OR char_length(external_ref) BETWEEN 1 AND 80),
  ADD CONSTRAINT clients_member_number_length CHECK (member_number IS NULL OR char_length(member_number) <= 80),
  ADD CONSTRAINT clients_gender_allowed CHECK (gender IS NULL OR gender IN ('F','M')),
  ADD CONSTRAINT clients_import_text_length CHECK ((import_provenance IS NULL OR char_length(import_provenance) <= 300) AND (import_tags IS NULL OR char_length(import_tags) <= 600));

CREATE UNIQUE INDEX clients_import_external_ref_unique ON clients(import_source, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX clients_import_run_idx ON clients(import_run_id) WHERE import_run_id IS NOT NULL;

ALTER TABLE client_events DROP CONSTRAINT client_events_type_allowed;
ALTER TABLE client_events ADD CONSTRAINT client_events_type_allowed CHECK (event_type IN (
  'client.created','client.archived','client.profile_updated','client.plan_assigned','client.plan_paused',
  'client.plan_resumed','client.plan_cancelled','client.plan_renewed','client.plan_changed','client.imported'
));
