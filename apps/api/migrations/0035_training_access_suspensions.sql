-- Administrative Training suspension is independent of identity, links and commercial rights.
CREATE TABLE platform_training_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('suspended','lifted')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  actor_id text NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 120),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX platform_training_access_events_person_timeline_idx
  ON platform_training_access_events(person_id, occurred_at DESC, id DESC);
CREATE TRIGGER platform_training_access_events_immutable
  BEFORE UPDATE OR DELETE ON platform_training_access_events
  FOR EACH ROW EXECUTE FUNCTION prevent_platform_identity_audit_mutation();
CREATE TRIGGER platform_training_access_events_no_truncate
  BEFORE TRUNCATE ON platform_training_access_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();

ALTER TABLE platform_identity_audit_events DROP CONSTRAINT platform_identity_audit_action_check;
ALTER TABLE platform_identity_audit_events ADD CONSTRAINT platform_identity_audit_action_check CHECK (action IN (
  'person.created','person.client_linked','person.staff_linked','training.linked','training.link_revoked',
  'person.auth_subject_linked','person.auth_subject_revoked','training.link_transaction_created',
  'training.link_transaction_verified','training.link_transaction_consumed','training.link_transaction_cancelled',
  'training.link_transaction_expired','training.link_reconciliation_recovered','training.link_pending_created',
  'training.link_conflict_detected','training.suspended','training.suspension_lifted'
));
