-- Canonical Platform link lifecycle. Historical explicit_admin rows retain their
-- identity and active/revoked meaning; verified proof only inserts pending links.
ALTER TABLE training_account_links
  ADD COLUMN source_transaction_id uuid,
  ADD COLUMN source_receipt_id uuid;

ALTER TABLE training_link_transactions
  ADD COLUMN source_receipt_id uuid;

ALTER TABLE training_link_transactions
  ADD CONSTRAINT training_link_transactions_receipt_state_check CHECK (
    source_receipt_id IS NULL OR state IN ('verified','consumed','expired')
  );
CREATE UNIQUE INDEX training_link_transactions_source_receipt_key ON training_link_transactions(source_receipt_id) WHERE source_receipt_id IS NOT NULL;

ALTER TABLE training_account_links
  DROP CONSTRAINT training_account_links_status_check,
  DROP CONSTRAINT training_account_links_method_check,
  DROP CONSTRAINT training_account_links_revoked_check;

ALTER TABLE training_account_links
  ADD CONSTRAINT training_account_links_status_check CHECK (status IN ('pending','active','revocation_pending','revoked','conflict')),
  ADD CONSTRAINT training_account_links_method_check CHECK (method IN ('explicit_admin','verified_training_proof')),
  ADD CONSTRAINT training_account_links_revoked_check CHECK ((status='revoked') = (revoked_at IS NOT NULL)),
  ADD CONSTRAINT training_account_links_source_check CHECK (
    (method='explicit_admin' AND source_transaction_id IS NULL AND source_receipt_id IS NULL AND status IN ('active','revoked')) OR
    (method='verified_training_proof' AND source_transaction_id IS NOT NULL AND source_receipt_id IS NOT NULL)
  ),
  ADD CONSTRAINT training_account_links_source_transaction_fk FOREIGN KEY (source_transaction_id) REFERENCES training_link_transactions(transaction_id) ON DELETE RESTRICT;

DROP INDEX training_account_links_one_active_person;
DROP INDEX training_account_links_one_active_user;
CREATE UNIQUE INDEX training_account_links_one_nonterminal_person ON training_account_links(person_id) WHERE status IN ('pending','active','revocation_pending');
CREATE UNIQUE INDEX training_account_links_one_nonterminal_user ON training_account_links(training_user_id) WHERE status IN ('pending','active','revocation_pending');
CREATE UNIQUE INDEX training_account_links_source_receipt_key ON training_account_links(source_receipt_id) WHERE source_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX training_account_links_source_transaction_key ON training_account_links(source_transaction_id) WHERE source_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_training_account_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.method='explicit_admin' THEN
      IF NEW.status<>'active' OR NEW.source_transaction_id IS NOT NULL OR NEW.source_receipt_id IS NOT NULL THEN
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
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'training link history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.link_id IS DISTINCT FROM OLD.link_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.training_user_id IS DISTINCT FROM OLD.training_user_id OR NEW.method IS DISTINCT FROM OLD.method OR NEW.source_transaction_id IS DISTINCT FROM OLD.source_transaction_id OR NEW.source_receipt_id IS DISTINCT FROM OLD.source_receipt_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'training link identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.status IN ('revoked','conflict') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'terminal training link is final' USING ERRCODE='55000'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.method='explicit_admin' AND OLD.status='active' AND NEW.status='revoked' THEN
      IF NEW.link_version NOT IN (OLD.link_version,OLD.link_version+1) THEN RAISE EXCEPTION 'link version must advance exactly once' USING ERRCODE='23514'; END IF;
      NEW.link_version=OLD.link_version+1; NEW.revoked_at=now();
    ELSIF OLD.method='verified_training_proof' AND ((OLD.status='active' AND NEW.status='revocation_pending') OR (OLD.status='revocation_pending' AND NEW.status='revoked') OR (OLD.status IN ('pending','active','revocation_pending') AND NEW.status='conflict')) THEN
      IF NEW.link_version<>OLD.link_version+1 THEN RAISE EXCEPTION 'link version must advance exactly once' USING ERRCODE='23514'; END IF;
      IF NEW.status='revoked' THEN NEW.revoked_at=now(); END IF;
    ELSE
      RAISE EXCEPTION 'invalid canonical link transition; activation requires Training acknowledgement' USING ERRCODE='55000';
    END IF;
  ELSIF NEW.link_version IS DISTINCT FROM OLD.link_version OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'link version and lifecycle timestamps are immutable outside transitions' USING ERRCODE='55000';
  ELSIF NEW IS DISTINCT FROM OLD AND OLD.status<>'active' THEN
    RAISE EXCEPTION 'canonical link is immutable outside lifecycle transitions' USING ERRCODE='55000';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at=now(); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER training_account_link_protection ON training_account_links;
CREATE TRIGGER training_account_link_protection BEFORE INSERT OR UPDATE OR DELETE ON training_account_links FOR EACH ROW EXECUTE FUNCTION protect_training_account_link();

CREATE OR REPLACE FUNCTION protect_training_link_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_status text; subject_status text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'link transaction history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.verified_training_user_id IS NOT NULL AND (NEW.verified_training_user_id<>btrim(NEW.verified_training_user_id) OR char_length(NEW.verified_training_user_id) NOT BETWEEN 1 AND 200 OR NEW.verified_training_user_id ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'verified Training subject is not canonical' USING ERRCODE='23514';
  END IF;
  IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.auth_subject_link_id IS DISTINCT FROM OLD.auth_subject_link_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.nonce_hash IS DISTINCT FROM OLD.nonce_hash OR NEW.audience IS DISTINCT FROM OLD.audience OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'link transaction identity is immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.source_receipt_id IS DISTINCT FROM OLD.source_receipt_id AND NOT (OLD.source_receipt_id IS NULL AND OLD.state='pending' AND NEW.state='verified' AND NEW.source_receipt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'receipt source is write-once during recovery' USING ERRCODE='55000';
  END IF;
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at AND NOT (OLD.state='pending' AND NEW.state='verified') THEN
    RAISE EXCEPTION 'verification timestamp is immutable after verification' USING ERRCODE='55000';
  END IF;
  IF NEW.verified_training_user_id IS DISTINCT FROM OLD.verified_training_user_id AND NOT (OLD.verified_training_user_id IS NULL AND NEW.verified_training_user_id IS NOT NULL AND OLD.state='pending' AND NEW.state='verified') THEN
    RAISE EXCEPTION 'verified Training subject is write-once during verification' USING ERRCODE='55000';
  END IF;
  IF OLD.state IN ('consumed','cancelled','expired') THEN RAISE EXCEPTION 'link transaction is final' USING ERRCODE='55000'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'link transaction version must advance once' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.state='pending' AND NEW.state IN ('verified','expired','cancelled')) OR (OLD.state='verified' AND NEW.state IN ('consumed','expired','cancelled'))) THEN
    RAISE EXCEPTION 'invalid link transaction transition' USING ERRCODE='55000';
  END IF;
  IF NEW.state='verified' THEN
    IF NEW.source_receipt_id IS NOT NULL THEN
      IF NEW.verified_at IS NULL OR NEW.verified_at<OLD.created_at OR NEW.verified_at>OLD.expires_at OR NEW.verified_at>now()+interval '30 seconds' THEN RAISE EXCEPTION 'receipt verification time outside transaction window' USING ERRCODE='55000'; END IF;
    ELSE
      IF OLD.expires_at<=now() THEN RAISE EXCEPTION 'link transaction expired' USING ERRCODE='55000'; END IF;
      NEW.verified_at=now();
    END IF;
  ELSIF NEW.state='consumed' THEN
    IF OLD.expires_at<=now() THEN RAISE EXCEPTION 'link transaction expired' USING ERRCODE='55000'; END IF;
    NEW.consumed_at=now();
  ELSIF NEW.state='expired' THEN
    IF OLD.expires_at>now() THEN RAISE EXCEPTION 'link transaction is not expired' USING ERRCODE='55000'; END IF;
  ELSIF NEW.state='cancelled' THEN
    NEW.cancelled_at=now();
  END IF;
  IF NEW.state IN ('verified','consumed') THEN
    SELECT p.status,s.status INTO person_status,subject_status FROM platform_persons p JOIN platform_person_auth_subjects s ON s.person_id=p.id WHERE p.id=NEW.person_id AND s.id=NEW.auth_subject_link_id FOR SHARE OF p,s;
    IF person_status IS DISTINCT FROM 'active' OR subject_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'identity binding is not active' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END; $$;

ALTER TABLE platform_identity_audit_events DROP CONSTRAINT platform_identity_audit_action_check;
ALTER TABLE platform_identity_audit_events ADD CONSTRAINT platform_identity_audit_action_check CHECK (action IN (
  'person.created','person.client_linked','person.staff_linked','training.linked','training.link_revoked',
  'person.auth_subject_linked','person.auth_subject_revoked',
  'training.link_transaction_created','training.link_transaction_verified','training.link_transaction_consumed',
  'training.link_transaction_cancelled','training.link_transaction_expired',
  'training.link_reconciliation_recovered','training.link_pending_created','training.link_conflict_detected'
));
