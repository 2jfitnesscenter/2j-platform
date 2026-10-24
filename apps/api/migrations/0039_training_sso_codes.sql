-- One-time Training SSO codes. Only the SHA-256 of the code is stored; the code itself is never persisted.
-- A code is bound to one person, one active auth subject and the Training user linked at issue time.
CREATE TABLE platform_training_sso_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash char(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  person_id uuid NOT NULL,
  auth_subject_link_id uuid NOT NULL,
  training_user_id text NOT NULL,
  audience text NOT NULL,
  purpose text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_key_id text,
  terminal_reason text,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT platform_training_sso_audience_check CHECK (audience='2j-training-sso'),
  CONSTRAINT platform_training_sso_purpose_check CHECK (purpose='training-session'),
  CONSTRAINT platform_training_sso_state_check CHECK (state IN ('pending','consumed','expired','revoked')),
  CONSTRAINT platform_training_sso_ttl_check CHECK (expires_at>created_at AND expires_at<=created_at+interval '60 seconds'),
  CONSTRAINT platform_training_sso_training_user_check CHECK (training_user_id=btrim(training_user_id) AND char_length(training_user_id) BETWEEN 1 AND 200 AND training_user_id !~ '[[:cntrl:]]'),
  CONSTRAINT platform_training_sso_state_columns_check CHECK (
    (state='pending' AND consumed_at IS NULL AND consumed_key_id IS NULL AND terminal_reason IS NULL) OR
    (state='consumed' AND consumed_at IS NOT NULL AND consumed_key_id IS NOT NULL AND terminal_reason IS NULL) OR
    (state IN ('expired','revoked') AND consumed_at IS NULL AND terminal_reason IS NOT NULL AND char_length(terminal_reason) BETWEEN 1 AND 80)
  ),
  CONSTRAINT platform_training_sso_version_check CHECK (version>0),
  CONSTRAINT platform_training_sso_person_fk FOREIGN KEY (person_id) REFERENCES platform_persons(id) ON DELETE RESTRICT,
  CONSTRAINT platform_training_sso_subject_person_fk FOREIGN KEY (auth_subject_link_id,person_id)
    REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT
);
CREATE INDEX platform_training_sso_person_pending_idx ON platform_training_sso_codes(person_id,expires_at) WHERE state='pending';

CREATE FUNCTION validate_platform_training_sso_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_status text; subject_status text; linked integer;
BEGIN
  IF NEW.state<>'pending' OR NEW.version<>1 OR NEW.consumed_at IS NOT NULL OR NEW.consumed_key_id IS NOT NULL OR NEW.terminal_reason IS NOT NULL THEN
    RAISE EXCEPTION 'SSO code must start pending' USING ERRCODE='23514';
  END IF;
  NEW.created_at=now();
  IF NEW.expires_at<=now() OR NEW.expires_at>now()+interval '60 seconds' THEN RAISE EXCEPTION 'SSO code TTL is invalid' USING ERRCODE='23514'; END IF;
  SELECT p.status,s.status INTO person_status,subject_status FROM platform_persons p JOIN platform_person_auth_subjects s ON s.person_id=p.id
    WHERE p.id=NEW.person_id AND s.id=NEW.auth_subject_link_id FOR SHARE OF p,s;
  IF person_status IS DISTINCT FROM 'active' OR subject_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'identity binding is not active' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO linked FROM training_account_links WHERE person_id=NEW.person_id AND training_user_id=NEW.training_user_id AND status='active';
  IF linked<>1 THEN RAISE EXCEPTION 'active Training link required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_training_sso_insert_guard BEFORE INSERT ON platform_training_sso_codes
  FOR EACH ROW EXECUTE FUNCTION validate_platform_training_sso_insert();

CREATE FUNCTION protect_platform_training_sso_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SSO code history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.auth_subject_link_id IS DISTINCT FROM OLD.auth_subject_link_id OR NEW.training_user_id IS DISTINCT FROM OLD.training_user_id
    OR NEW.audience IS DISTINCT FROM OLD.audience OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'SSO code identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.state<>'pending' THEN RAISE EXCEPTION 'SSO code is final' USING ERRCODE='55000'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'SSO code version must advance once' USING ERRCODE='23514'; END IF;
  IF NEW.state='consumed' THEN
    IF OLD.expires_at<=now() THEN RAISE EXCEPTION 'SSO code expired' USING ERRCODE='55000'; END IF;
    NEW.consumed_at=now();
  ELSIF NEW.state='expired' THEN
    IF OLD.expires_at>now() THEN RAISE EXCEPTION 'SSO code is not expired' USING ERRCODE='55000'; END IF;
  ELSIF NEW.state<>'revoked' THEN
    RAISE EXCEPTION 'invalid SSO code transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_training_sso_protection BEFORE UPDATE OR DELETE ON platform_training_sso_codes
  FOR EACH ROW EXECUTE FUNCTION protect_platform_training_sso_code();
CREATE TRIGGER platform_training_sso_no_truncate BEFORE TRUNCATE ON platform_training_sso_codes
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();

ALTER TABLE platform_identity_audit_events DROP CONSTRAINT platform_identity_audit_action_check;
ALTER TABLE platform_identity_audit_events ADD CONSTRAINT platform_identity_audit_action_check CHECK (action IN (
  'person.created','person.client_linked','person.staff_linked','training.linked','training.link_revoked',
  'person.auth_subject_linked','person.auth_subject_revoked','training.link_transaction_created',
  'training.link_transaction_verified','training.link_transaction_consumed','training.link_transaction_cancelled',
  'training.link_transaction_expired','training.link_reconciliation_recovered','training.link_pending_created',
  'training.link_conflict_detected','training.suspended','training.suspension_lifted',
  'training.sso_issued','training.sso_redeemed','training.sso_rejected'
));
