-- Bilateral Training link lifecycle. A canonical link becomes ACTIVE only with Training's acknowledgement and becomes REVOKED only with
-- Training's acknowledgement of the revocation (or an audited administrative waiver). Provisioned profiles get their own source record.
-- Historical explicit_admin links keep their meaning. Everything is additive; no existing row changes.

CREATE TABLE platform_training_provisioning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  correlation_id uuid NOT NULL,
  person_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  display_name text NOT NULL,
  state text NOT NULL DEFAULT 'requested',
  training_user_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_training_provisioning_person_fk FOREIGN KEY (person_id) REFERENCES platform_persons(id) ON DELETE RESTRICT,
  CONSTRAINT platform_training_provisioning_name_check CHECK (display_name=btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 60 AND display_name !~ '[[:cntrl:]<>]'),
  CONSTRAINT platform_training_provisioning_state_check CHECK (state IN ('requested','provisioned','failed')),
  CONSTRAINT platform_training_provisioning_user_check CHECK ((state='provisioned') = (training_user_id IS NOT NULL) AND (training_user_id IS NULL OR (training_user_id=btrim(training_user_id) AND char_length(training_user_id) BETWEEN 1 AND 200 AND training_user_id !~ '[[:cntrl:]]'))),
  CONSTRAINT platform_training_provisioning_actor_check CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
-- A person is provisioned at most once; a failed attempt does not block a new decision.
CREATE UNIQUE INDEX platform_training_provisioning_one_per_person ON platform_training_provisioning(person_id) WHERE state IN ('requested','provisioned');
CREATE UNIQUE INDEX platform_training_provisioning_training_user_key ON platform_training_provisioning(training_user_id) WHERE training_user_id IS NOT NULL;

CREATE FUNCTION protect_platform_training_provisioning() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'provisioning history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'provisioning request identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.state<>'requested' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'provisioning result is final' USING ERRCODE='55000'; END IF;
  IF NEW.state NOT IN ('provisioned','failed','requested') THEN RAISE EXCEPTION 'invalid provisioning transition' USING ERRCODE='55000'; END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at=now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_training_provisioning_protection BEFORE UPDATE OR DELETE ON platform_training_provisioning FOR EACH ROW EXECUTE FUNCTION protect_platform_training_provisioning();
CREATE TRIGGER platform_training_provisioning_no_truncate BEFORE TRUNCATE ON platform_training_provisioning FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();

ALTER TABLE training_account_links
  ADD COLUMN source_provisioning_id uuid,
  ADD COLUMN training_ack_id text,
  ADD COLUMN training_acked_at timestamptz,
  ADD COLUMN revocation_ack_id text;
ALTER TABLE training_account_links
  ADD CONSTRAINT training_account_links_source_provisioning_fk FOREIGN KEY (source_provisioning_id) REFERENCES platform_training_provisioning(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX training_account_links_source_provisioning_key ON training_account_links(source_provisioning_id) WHERE source_provisioning_id IS NOT NULL;

ALTER TABLE training_account_links
  DROP CONSTRAINT training_account_links_method_check,
  DROP CONSTRAINT training_account_links_source_check;
ALTER TABLE training_account_links
  ADD CONSTRAINT training_account_links_method_check CHECK (method IN ('explicit_admin','verified_training_proof','provisioned')),
  ADD CONSTRAINT training_account_links_source_check CHECK (
    (method='explicit_admin' AND source_transaction_id IS NULL AND source_receipt_id IS NULL AND source_provisioning_id IS NULL AND status IN ('active','revoked')) OR
    (method='verified_training_proof' AND source_transaction_id IS NOT NULL AND source_receipt_id IS NOT NULL AND source_provisioning_id IS NULL) OR
    (method='provisioned' AND source_transaction_id IS NULL AND source_receipt_id IS NULL AND source_provisioning_id IS NOT NULL)
  ),
  ADD CONSTRAINT training_account_links_ack_check CHECK (
    (training_ack_id IS NULL OR char_length(training_ack_id) BETWEEN 1 AND 200) AND (revocation_ack_id IS NULL OR char_length(revocation_ack_id) BETWEEN 1 AND 200) AND
    ((training_ack_id IS NULL) = (training_acked_at IS NULL)) AND
    (status<>'active' OR method='explicit_admin' OR training_ack_id IS NOT NULL) AND
    (status<>'revoked' OR method='explicit_admin' OR revocation_ack_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION protect_training_account_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.training_ack_id IS NOT NULL OR NEW.training_acked_at IS NOT NULL OR NEW.revocation_ack_id IS NOT NULL THEN
      RAISE EXCEPTION 'acknowledgements are recorded by lifecycle transitions only' USING ERRCODE='23514';
    END IF;
    IF NEW.method='explicit_admin' THEN
      IF NEW.status<>'active' OR NEW.source_transaction_id IS NOT NULL OR NEW.source_receipt_id IS NOT NULL OR NEW.source_provisioning_id IS NOT NULL THEN
        RAISE EXCEPTION 'legacy admin links must start active without proof source' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.method='verified_training_proof' THEN
      IF NEW.status<>'pending' OR NEW.source_transaction_id IS NULL OR NEW.source_receipt_id IS NULL OR NEW.link_version<>1 OR NEW.request_id<>NEW.source_transaction_id THEN
        RAISE EXCEPTION 'verified proof links must start pending at version one with immutable receipt source' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM training_link_transactions t WHERE t.transaction_id=NEW.source_transaction_id AND t.person_id=NEW.person_id AND t.verified_training_user_id=NEW.training_user_id AND t.state IN ('verified','consumed')) THEN
        RAISE EXCEPTION 'canonical link requires matching verified transaction' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM training_link_transactions t WHERE t.transaction_id=NEW.source_transaction_id
          AND t.person_id=NEW.person_id AND t.verified_training_user_id=NEW.training_user_id AND t.state IN ('verified','consumed')
          AND (t.source_receipt_id IS NULL OR t.source_receipt_id=NEW.source_receipt_id)
      ) THEN RAISE EXCEPTION 'canonical link receipt source is inconsistent' USING ERRCODE='23514'; END IF;
    ELSIF NEW.method='provisioned' THEN
      IF NEW.status<>'pending' OR NEW.source_provisioning_id IS NULL OR NEW.source_transaction_id IS NOT NULL OR NEW.source_receipt_id IS NOT NULL OR NEW.link_version<>1 OR NEW.request_id<>NEW.source_provisioning_id THEN
        RAISE EXCEPTION 'provisioned links must start pending at version one with their provisioning source' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM platform_training_provisioning p WHERE p.id=NEW.source_provisioning_id AND p.person_id=NEW.person_id AND p.training_user_id=NEW.training_user_id AND p.state='provisioned') THEN
        RAISE EXCEPTION 'provisioned link requires the matching completed provisioning' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'training link history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.link_id IS DISTINCT FROM OLD.link_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.training_user_id IS DISTINCT FROM OLD.training_user_id OR NEW.method IS DISTINCT FROM OLD.method OR NEW.source_transaction_id IS DISTINCT FROM OLD.source_transaction_id OR NEW.source_receipt_id IS DISTINCT FROM OLD.source_receipt_id OR NEW.source_provisioning_id IS DISTINCT FROM OLD.source_provisioning_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'training link identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.status IN ('revoked','conflict') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'terminal training link is final' USING ERRCODE='55000'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.method='explicit_admin' AND OLD.status='active' AND NEW.status='revoked' THEN
      IF NEW.link_version NOT IN (OLD.link_version,OLD.link_version+1) THEN RAISE EXCEPTION 'link version must advance exactly once' USING ERRCODE='23514'; END IF;
      NEW.link_version=OLD.link_version+1; NEW.revoked_at=now();
    ELSIF OLD.method IN ('verified_training_proof','provisioned') AND OLD.status='pending' AND NEW.status='active' THEN
      -- Activation exists only with Training's acknowledgement, recorded exactly once.
      IF NEW.link_version<>OLD.link_version+1 THEN RAISE EXCEPTION 'link version must advance exactly once' USING ERRCODE='23514'; END IF;
      IF OLD.training_ack_id IS NOT NULL OR NEW.training_ack_id IS NULL OR NEW.revocation_ack_id IS DISTINCT FROM OLD.revocation_ack_id THEN
        RAISE EXCEPTION 'activation requires Training acknowledgement' USING ERRCODE='55000';
      END IF;
      NEW.training_acked_at=now();
    ELSIF OLD.method IN ('verified_training_proof','provisioned') AND OLD.status='active' AND NEW.status='revocation_pending' THEN
      IF NEW.link_version<>OLD.link_version+1 THEN RAISE EXCEPTION 'link version must advance exactly once' USING ERRCODE='23514'; END IF;
      IF NEW.training_ack_id IS DISTINCT FROM OLD.training_ack_id OR NEW.training_acked_at IS DISTINCT FROM OLD.training_acked_at OR NEW.revocation_ack_id IS DISTINCT FROM OLD.revocation_ack_id THEN
        RAISE EXCEPTION 'acknowledgements are immutable outside their own transitions' USING ERRCODE='55000';
      END IF;
    ELSIF OLD.method IN ('verified_training_proof','provisioned') AND OLD.status='revocation_pending' AND NEW.status='revoked' THEN
      IF NEW.link_version<>OLD.link_version+1 THEN RAISE EXCEPTION 'link version must advance exactly once' USING ERRCODE='23514'; END IF;
      IF OLD.revocation_ack_id IS NOT NULL OR NEW.revocation_ack_id IS NULL OR NEW.training_ack_id IS DISTINCT FROM OLD.training_ack_id OR NEW.training_acked_at IS DISTINCT FROM OLD.training_acked_at THEN
        RAISE EXCEPTION 'revocation requires Training acknowledgement (or an audited waiver)' USING ERRCODE='55000';
      END IF;
      NEW.revoked_at=now();
    ELSIF OLD.method IN ('verified_training_proof','provisioned') AND OLD.status IN ('pending','active','revocation_pending') AND NEW.status='conflict' THEN
      IF NEW.link_version<>OLD.link_version+1 THEN RAISE EXCEPTION 'link version must advance exactly once' USING ERRCODE='23514'; END IF;
      IF NEW.training_ack_id IS DISTINCT FROM OLD.training_ack_id OR NEW.training_acked_at IS DISTINCT FROM OLD.training_acked_at OR NEW.revocation_ack_id IS DISTINCT FROM OLD.revocation_ack_id THEN
        RAISE EXCEPTION 'acknowledgements are immutable outside their own transitions' USING ERRCODE='55000';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid canonical link transition' USING ERRCODE='55000';
    END IF;
  ELSIF NEW.link_version IS DISTINCT FROM OLD.link_version OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
    OR NEW.training_ack_id IS DISTINCT FROM OLD.training_ack_id OR NEW.training_acked_at IS DISTINCT FROM OLD.training_acked_at OR NEW.revocation_ack_id IS DISTINCT FROM OLD.revocation_ack_id THEN
    RAISE EXCEPTION 'link version, acknowledgements and lifecycle timestamps are immutable outside transitions' USING ERRCODE='55000';
  ELSIF NEW IS DISTINCT FROM OLD AND OLD.status<>'active' THEN
    RAISE EXCEPTION 'canonical link is immutable outside lifecycle transitions' USING ERRCODE='55000';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at=now(); END IF;
  RETURN NEW;
END; $$;

ALTER TABLE platform_identity_audit_events DROP CONSTRAINT platform_identity_audit_action_check;
ALTER TABLE platform_identity_audit_events ADD CONSTRAINT platform_identity_audit_action_check CHECK (action IN (
  'person.created','person.client_linked','person.staff_linked','training.linked','training.link_revoked',
  'person.auth_subject_linked','person.auth_subject_revoked','training.link_transaction_created',
  'training.link_transaction_verified','training.link_transaction_consumed','training.link_transaction_cancelled',
  'training.link_transaction_expired','training.link_reconciliation_recovered','training.link_pending_created',
  'training.link_conflict_detected','training.suspended','training.suspension_lifted',
  'training.sso_issued','training.sso_redeemed','training.sso_rejected',
  'training.link_activated','training.link_revocation_requested','training.link_ack_failed',
  'training.provisioning_requested','training.provisioned','training.provisioning_failed'
));
