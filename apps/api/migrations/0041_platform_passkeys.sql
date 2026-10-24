-- Platform-owned passkeys (WebAuthn) for central member authentication. Disabled by default and restricted to development/test by the server
-- until a human security review approves a production rollout. The relying-party id is configuration, never a column default: it is immutable
-- for every stored credential (rp_id is recorded so a later change of host can never silently orphan or cross-bind credentials).

CREATE TABLE platform_passkey_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  person_id uuid NOT NULL,
  auth_subject_link_id uuid NOT NULL,
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT platform_passkey_enrollments_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour'),
  CONSTRAINT platform_passkey_enrollments_subject_fk FOREIGN KEY (auth_subject_link_id,person_id) REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT
);
CREATE INDEX platform_passkey_enrollments_subject_idx ON platform_passkey_enrollments(auth_subject_link_id,created_at DESC) WHERE consumed_at IS NULL;

CREATE TABLE platform_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  auth_subject_link_id uuid NOT NULL,
  credential_id text NOT NULL UNIQUE CHECK (char_length(credential_id) BETWEEN 16 AND 1024 AND credential_id ~ '^[A-Za-z0-9_-]+$'),
  public_key bytea NOT NULL CHECK (length(public_key) BETWEEN 16 AND 1024),
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  rp_id text NOT NULL CHECK (rp_id ~ '^[a-z0-9.-]+$' AND char_length(rp_id) BETWEEN 1 AND 253),
  label text NOT NULL DEFAULT 'passkey' CHECK (label=btrim(label) AND char_length(label) BETWEEN 1 AND 60 AND label !~ '[[:cntrl:]<>]'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT platform_passkeys_revocation CHECK ((status='revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT platform_passkeys_subject_fk FOREIGN KEY (auth_subject_link_id,person_id) REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT
);
CREATE INDEX platform_passkeys_subject_idx ON platform_passkeys(auth_subject_link_id) WHERE status='active';

CREATE TABLE platform_passkey_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('registration','authentication')),
  challenge text NOT NULL CHECK (char_length(challenge) BETWEEN 16 AND 256 AND challenge ~ '^[A-Za-z0-9_-]+$'),
  enrollment_id uuid REFERENCES platform_passkey_enrollments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT platform_passkey_challenges_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CONSTRAINT platform_passkey_challenges_enrollment_binding CHECK ((purpose='registration') = (enrollment_id IS NOT NULL))
);
CREATE INDEX platform_passkey_challenges_expiry_idx ON platform_passkey_challenges(expires_at);

CREATE FUNCTION platform_passkey_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'passkey history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.auth_subject_link_id IS DISTINCT FROM OLD.auth_subject_link_id
    OR NEW.credential_id IS DISTINCT FROM OLD.credential_id OR NEW.public_key IS DISTINCT FROM OLD.public_key OR NEW.rp_id IS DISTINCT FROM OLD.rp_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'passkey identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.status='revoked' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'revoked passkeys are final' USING ERRCODE='55000'; END IF;
  IF NEW.sign_count < OLD.sign_count THEN RAISE EXCEPTION 'passkey counter cannot move backwards' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_passkey_protection BEFORE UPDATE OR DELETE ON platform_passkeys FOR EACH ROW EXECUTE FUNCTION platform_passkey_protect();

CREATE FUNCTION platform_passkey_single_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'passkey enrollment history is retained' USING ERRCODE='55000'; END IF;
  IF OLD.consumed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'consumed passkey records are final' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN RAISE EXCEPTION 'passkey record identity and expiry are immutable' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_passkey_enrollment_single_use BEFORE UPDATE OR DELETE ON platform_passkey_enrollments FOR EACH ROW EXECUTE FUNCTION platform_passkey_single_use();
CREATE TRIGGER platform_passkey_challenge_single_use BEFORE UPDATE ON platform_passkey_challenges FOR EACH ROW EXECUTE FUNCTION platform_passkey_single_use();

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
  'passkey.enrollment_issued','passkey.registered','passkey.login','passkey.login_rejected','passkey.revoked'
));
