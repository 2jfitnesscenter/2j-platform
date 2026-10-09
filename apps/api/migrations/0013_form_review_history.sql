CREATE TABLE client_form_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES client_form_assignments(id) ON DELETE RESTRICT,
  response_id uuid NOT NULL REFERENCES client_form_responses(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  form_version_id uuid NOT NULL REFERENCES client_form_versions(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  note text NOT NULL DEFAULT '',
  actor_id text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(note) <= 1000),
  CHECK (char_length(actor_id) BETWEEN 1 AND 120)
);
CREATE INDEX client_form_reviews_assignment_idx ON client_form_reviews(assignment_id, reviewed_at, id);
CREATE TRIGGER client_form_reviews_no_change BEFORE UPDATE OR DELETE ON client_form_reviews FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER client_form_reviews_no_truncate BEFORE TRUNCATE ON client_form_reviews FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
REVOKE DELETE, TRUNCATE ON client_form_reviews FROM PUBLIC;
