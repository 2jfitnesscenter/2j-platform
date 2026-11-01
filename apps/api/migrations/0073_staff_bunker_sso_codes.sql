-- One-time staff SSO codes for the Bunker admin (A79). Platform is the identity authority; Bunker redeems server-to-server.
-- Only the SHA-256 of the code is stored. Audience and purpose are distinct from the member Training SSO, so a code of one flow can never be redeemed in the other.
CREATE TABLE platform_staff_sso_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash char(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  person_id uuid NOT NULL,
  auth_subject_link_id uuid NOT NULL,
  audience text NOT NULL,
  purpose text NOT NULL,
  binding_challenge char(43) NOT NULL CHECK (binding_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_key_id text,
  terminal_reason text,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT platform_staff_sso_audience_check CHECK (audience='2j-bunker-admin-sso'),
  CONSTRAINT platform_staff_sso_purpose_check CHECK (purpose='bunker-admin-session'),
  CONSTRAINT platform_staff_sso_state_check CHECK (state IN ('pending','consumed','expired','revoked')),
  CONSTRAINT platform_staff_sso_ttl_check CHECK (expires_at>created_at AND expires_at<=created_at+interval '60 seconds'),
  CONSTRAINT platform_staff_sso_state_columns_check CHECK (
    (state='pending' AND consumed_at IS NULL AND consumed_key_id IS NULL AND terminal_reason IS NULL) OR
    (state='consumed' AND consumed_at IS NOT NULL AND consumed_key_id IS NOT NULL AND terminal_reason IS NULL) OR
    (state IN ('expired','revoked') AND consumed_at IS NULL AND terminal_reason IS NOT NULL AND char_length(terminal_reason) BETWEEN 1 AND 80)
  ),
  CONSTRAINT platform_staff_sso_version_check CHECK (version>0),
  CONSTRAINT platform_staff_sso_subject_person_fk FOREIGN KEY (auth_subject_link_id,person_id)
    REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT
);
CREATE INDEX platform_staff_sso_person_pending_idx ON platform_staff_sso_codes(person_id,expires_at) WHERE state='pending';

CREATE FUNCTION validate_platform_staff_sso_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state<>'pending' OR NEW.version<>1 OR NEW.consumed_at IS NOT NULL OR NEW.consumed_key_id IS NOT NULL OR NEW.terminal_reason IS NOT NULL THEN
    RAISE EXCEPTION 'staff SSO code must start pending' USING ERRCODE='23514';
  END IF;
  NEW.created_at=now();
  IF NEW.expires_at<=now() OR NEW.expires_at>now()+interval '60 seconds' THEN RAISE EXCEPTION 'staff SSO code TTL is invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_staff_sso_insert_guard BEFORE INSERT ON platform_staff_sso_codes
  FOR EACH ROW EXECUTE FUNCTION validate_platform_staff_sso_insert();

CREATE FUNCTION protect_platform_staff_sso_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'staff SSO code history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.auth_subject_link_id IS DISTINCT FROM OLD.auth_subject_link_id OR NEW.audience IS DISTINCT FROM OLD.audience
    OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.binding_challenge IS DISTINCT FROM OLD.binding_challenge
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'staff SSO code identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.state<>'pending' THEN RAISE EXCEPTION 'staff SSO code is final' USING ERRCODE='55000'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'staff SSO code version must advance once' USING ERRCODE='23514'; END IF;
  IF NEW.state='consumed' THEN
    IF OLD.expires_at<=now() THEN RAISE EXCEPTION 'staff SSO code expired' USING ERRCODE='55000'; END IF;
    NEW.consumed_at=now();
  ELSIF NEW.state='expired' THEN
    IF OLD.expires_at>now() THEN RAISE EXCEPTION 'staff SSO code is not expired' USING ERRCODE='55000'; END IF;
  ELSIF NEW.state<>'revoked' THEN
    RAISE EXCEPTION 'invalid staff SSO code transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_staff_sso_protection BEFORE UPDATE OR DELETE ON platform_staff_sso_codes
  FOR EACH ROW EXECUTE FUNCTION protect_platform_staff_sso_code();
CREATE TRIGGER platform_staff_sso_no_truncate BEFORE TRUNCATE ON platform_staff_sso_codes
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();

ALTER TABLE platform_identity_audit_events DROP CONSTRAINT platform_identity_audit_action_check;
ALTER TABLE platform_identity_audit_events ADD CONSTRAINT platform_identity_audit_action_check CHECK (action IN (
  'person.created','person.client_linked','person.staff_linked','training.linked','training.link_revoked',
  'person.auth_subject_linked','person.auth_subject_revoked','training.link_transaction_created',
  'training.link_transaction_verified','training.link_transaction_consumed','training.link_transaction_cancelled',
  'training.link_transaction_expired','training.link_reconciliation_recovered','training.link_pending_created',
  'training.link_conflict_detected','training.suspended','training.suspension_lifted',
  'training.sso_issued','training.sso_redeemed','training.sso_rejected',
  'training.link_activated','training.link_revocation_requested','training.link_ack_failed',
  'training.provisioning_requested','training.provisioned','training.provisioning_failed',
  'passkey.enrollment_issued','passkey.registered','passkey.login','passkey.login_rejected','passkey.revoked',
  'staff.bunker_sso_issued','staff.bunker_sso_redeemed','staff.bunker_sso_rejected'
));
