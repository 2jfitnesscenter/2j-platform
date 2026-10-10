-- Central auth subjects bind explicitly to Platform persons. Nothing is inferred from facets or profile data.
CREATE TABLE platform_person_auth_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  auth_subject text NOT NULL,
  provider text NOT NULL,
  provider_version smallint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  CONSTRAINT platform_person_auth_subject_canonical CHECK (auth_subject=btrim(auth_subject) AND char_length(auth_subject) BETWEEN 1 AND 500 AND auth_subject !~ '[[:cntrl:]]'),
  CONSTRAINT platform_person_auth_provider_check CHECK (provider=btrim(provider) AND provider ~ '^[a-z][a-z0-9.-]{0,63}$'),
  CONSTRAINT platform_person_auth_provider_version_check CHECK (provider_version BETWEEN 1 AND 32767),
  CONSTRAINT platform_person_auth_status_check CHECK (status IN ('active','revoked')),
  CONSTRAINT platform_person_auth_revocation_check CHECK ((status='active' AND revoked_at IS NULL AND revoked_by IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)),
  CONSTRAINT platform_person_auth_actor_check CHECK (char_length(created_by) BETWEEN 1 AND 120 AND (revoked_by IS NULL OR char_length(revoked_by) BETWEEN 1 AND 120)),
  CONSTRAINT platform_person_auth_subjects_person_id_platform_persons_id_fk FOREIGN KEY (person_id) REFERENCES platform_persons(id) ON DELETE RESTRICT
);
-- V1 retains a subject's ownership forever; a revoked subject is never silently reassigned.
CREATE UNIQUE INDEX platform_person_auth_subject_owner_unique ON platform_person_auth_subjects(provider,auth_subject);
CREATE INDEX platform_person_auth_subject_person_active_idx ON platform_person_auth_subjects(person_id,created_at DESC) WHERE status='active';

CREATE TABLE training_link_transactions (
  transaction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  auth_subject_link_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  request_hash char(64) NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  nonce_hash char(64) NOT NULL UNIQUE,
  audience text NOT NULL,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT training_link_transactions_state_check CHECK (state IN ('pending','verified','consumed','expired','cancelled')),
  CONSTRAINT training_link_transactions_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$' AND nonce_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT training_link_transactions_audience_check CHECK (audience='2j-training-account-link'),
  CONSTRAINT training_link_transactions_purpose_check CHECK (purpose='training-account-link'),
  CONSTRAINT training_link_transactions_ttl_check CHECK (expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
  CONSTRAINT training_link_transactions_state_timestamps_check CHECK (
    (state='pending' AND verified_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL) OR
    (state='verified' AND verified_at IS NOT NULL AND consumed_at IS NULL AND cancelled_at IS NULL) OR
    (state='consumed' AND verified_at IS NOT NULL AND consumed_at IS NOT NULL AND cancelled_at IS NULL) OR
    (state='expired' AND consumed_at IS NULL AND cancelled_at IS NULL) OR
    (state='cancelled' AND consumed_at IS NULL AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT training_link_transactions_failure_check CHECK (failure_reason IS NULL OR (state IN ('expired','cancelled') AND char_length(failure_reason) BETWEEN 1 AND 80)),
  CONSTRAINT training_link_transactions_version_check CHECK (version>0),
  CONSTRAINT training_link_transactions_person_id_platform_persons_id_fk FOREIGN KEY (person_id) REFERENCES platform_persons(id) ON DELETE RESTRICT,
  CONSTRAINT training_link_transactions_auth_subject_link_id_platform_person_auth_subjects_id_fk FOREIGN KEY (auth_subject_link_id) REFERENCES platform_person_auth_subjects(id) ON DELETE RESTRICT
);
CREATE INDEX training_link_transactions_person_state_idx ON training_link_transactions(person_id,state,expires_at);

CREATE FUNCTION validate_training_link_transaction_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_status text; subject_status text; subject_person uuid;
BEGIN
  IF NEW.state<>'pending' OR NEW.version<>1 OR NEW.verified_at IS NOT NULL OR NEW.consumed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.failure_reason IS NOT NULL THEN RAISE EXCEPTION 'link transaction must start pending' USING ERRCODE='23514'; END IF;
  NEW.created_at=now();
  IF NEW.expires_at<=now() OR NEW.expires_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'link transaction TTL is invalid' USING ERRCODE='23514'; END IF;
  SELECT p.status,s.status,s.person_id INTO person_status,subject_status,subject_person FROM platform_persons p JOIN platform_person_auth_subjects s ON s.person_id=p.id WHERE p.id=NEW.person_id AND s.id=NEW.auth_subject_link_id FOR SHARE OF p,s;
  IF person_status IS DISTINCT FROM 'active' OR subject_status IS DISTINCT FROM 'active' OR subject_person IS DISTINCT FROM NEW.person_id THEN RAISE EXCEPTION 'identity binding is not active' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER training_link_transaction_identity_guard BEFORE INSERT ON training_link_transactions FOR EACH ROW EXECUTE FUNCTION validate_training_link_transaction_identity();

ALTER TABLE platform_identity_audit_events DROP CONSTRAINT platform_identity_audit_action_check;
ALTER TABLE platform_identity_audit_events ADD CONSTRAINT platform_identity_audit_action_check CHECK (action IN (
  'person.created','person.client_linked','person.staff_linked','training.linked','training.link_revoked',
  'person.auth_subject_linked','person.auth_subject_revoked',
  'training.link_transaction_created','training.link_transaction_verified','training.link_transaction_consumed',
  'training.link_transaction_cancelled','training.link_transaction_expired'
));

CREATE FUNCTION protect_platform_person_auth_subject() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_status text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'active' OR NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL THEN RAISE EXCEPTION 'auth subject must be created active' USING ERRCODE='23514'; END IF;
    SELECT status INTO person_status FROM platform_persons WHERE id=NEW.person_id FOR SHARE;
    IF person_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'person is not active' USING ERRCODE='23514'; END IF;
    NEW.verified_at=now(); NEW.created_at=now();
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'auth subject history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.auth_subject IS DISTINCT FROM OLD.auth_subject OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.provider_version IS DISTINCT FROM OLD.provider_version OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'auth subject identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.status='revoked' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'revoked auth subject is final' USING ERRCODE='55000'; END IF;
  IF OLD.status='active' AND NEW.status='revoked' THEN
    NEW.revoked_at=now();
    IF NEW.revoked_by IS NULL THEN RAISE EXCEPTION 'revocation actor required' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'invalid auth subject transition' USING ERRCODE='55000';
  END IF;
  SELECT status INTO person_status FROM platform_persons WHERE id=NEW.person_id FOR SHARE;
  IF NEW.status='active' AND person_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'person is not active' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER platform_person_auth_subject_protection BEFORE INSERT OR UPDATE OR DELETE ON platform_person_auth_subjects FOR EACH ROW EXECUTE FUNCTION protect_platform_person_auth_subject();
CREATE TRIGGER platform_person_auth_subject_no_truncate BEFORE TRUNCATE ON platform_person_auth_subjects FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();

CREATE FUNCTION protect_training_link_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_status text; subject_status text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'link transaction history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.auth_subject_link_id IS DISTINCT FROM OLD.auth_subject_link_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.nonce_hash IS DISTINCT FROM OLD.nonce_hash OR NEW.audience IS DISTINCT FROM OLD.audience OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'link transaction identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.state IN ('consumed','cancelled','expired') THEN RAISE EXCEPTION 'link transaction is final' USING ERRCODE='55000'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'link transaction version must advance once' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.state='pending' AND NEW.state IN ('verified','expired','cancelled')) OR (OLD.state='verified' AND NEW.state IN ('consumed','expired','cancelled'))) THEN
    RAISE EXCEPTION 'invalid link transaction transition' USING ERRCODE='55000';
  END IF;
  IF NEW.state='verified' THEN
    IF OLD.expires_at<=now() THEN RAISE EXCEPTION 'link transaction expired' USING ERRCODE='55000'; END IF;
    NEW.verified_at=now();
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
CREATE TRIGGER training_link_transaction_protection BEFORE UPDATE OR DELETE ON training_link_transactions FOR EACH ROW EXECUTE FUNCTION protect_training_link_transaction();
CREATE TRIGGER training_link_transaction_no_truncate BEFORE TRUNCATE ON training_link_transactions FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();
