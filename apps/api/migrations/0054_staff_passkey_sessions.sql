-- Staff and owner login is isolated from Member pilot sessions and ceremonies.
CREATE TABLE platform_staff_passkey_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  auth_subject_link_id uuid NOT NULL,
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (auth_subject_link_id,person_id) REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);
CREATE INDEX platform_staff_passkey_enrollments_live_idx ON platform_staff_passkey_enrollments(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE platform_staff_passkey_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('registration','authentication')),
  challenge text NOT NULL CHECK (char_length(challenge) BETWEEN 16 AND 256 AND challenge ~ '^[A-Za-z0-9_-]+$'),
  enrollment_id uuid REFERENCES platform_staff_passkey_enrollments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK ((purpose='registration') = (enrollment_id IS NOT NULL)),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX platform_staff_passkey_challenges_expiry_idx ON platform_staff_passkey_challenges(expires_at);

CREATE TABLE platform_staff_sessions (
  session_hash char(64) PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  person_id uuid NOT NULL,
  auth_subject_link_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY (auth_subject_link_id,person_id) REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '12 hours')
);
CREATE INDEX platform_staff_sessions_expiry_idx ON platform_staff_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX platform_staff_sessions_subject_idx ON platform_staff_sessions(auth_subject_link_id,created_at DESC);

CREATE FUNCTION platform_staff_session_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_hash IS DISTINCT FROM OLD.session_hash OR NEW.person_id IS DISTINCT FROM OLD.person_id OR
     NEW.auth_subject_link_id IS DISTINCT FROM OLD.auth_subject_link_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'staff session identity and expiry are immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'revoked staff sessions are final' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_staff_session_protection BEFORE UPDATE ON platform_staff_sessions FOR EACH ROW EXECUTE FUNCTION platform_staff_session_protect();

CREATE TABLE platform_staff_session_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  auth_subject_link_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('session.created','session.revoked','passkey.enrollment_issued','passkey.registered','passkey.login_rejected')),
  resource_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (auth_subject_link_id,person_id) REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT
);
CREATE INDEX platform_staff_session_audit_person_idx ON platform_staff_session_audit_events(person_id,occurred_at DESC,id DESC);
CREATE FUNCTION platform_staff_session_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'staff authentication audit is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER platform_staff_session_audit_immutable BEFORE UPDATE OR DELETE ON platform_staff_session_audit_events FOR EACH ROW EXECUTE FUNCTION platform_staff_session_audit_immutable();
CREATE TRIGGER platform_staff_session_audit_no_truncate BEFORE TRUNCATE ON platform_staff_session_audit_events FOR EACH STATEMENT EXECUTE FUNCTION platform_staff_session_audit_immutable();
