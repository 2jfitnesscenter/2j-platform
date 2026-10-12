CREATE TABLE platform_member_pilot_credentials (
  auth_subject_link_id uuid PRIMARY KEY REFERENCES platform_person_auth_subjects(id) ON DELETE RESTRICT,
  code_hash char(64) NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((status='revoked') = (revoked_at IS NOT NULL))
);

ALTER TABLE platform_person_auth_subjects ADD CONSTRAINT platform_person_auth_subject_id_person_unique UNIQUE (id,person_id);

CREATE TABLE platform_member_sessions (
  session_hash char(64) PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  person_id uuid NOT NULL,
  auth_subject_link_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT platform_member_sessions_expiry CHECK (expires_at > created_at),
  CONSTRAINT platform_member_sessions_subject_person_fk FOREIGN KEY (auth_subject_link_id,person_id)
    REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT
);
CREATE INDEX platform_member_sessions_expiry_idx ON platform_member_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX platform_member_sessions_subject_idx ON platform_member_sessions(auth_subject_link_id,created_at DESC);
CREATE FUNCTION platform_member_session_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_hash IS DISTINCT FROM OLD.session_hash OR NEW.person_id IS DISTINCT FROM OLD.person_id OR
    NEW.auth_subject_link_id IS DISTINCT FROM OLD.auth_subject_link_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'member session identity and expiry are immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'revoked member sessions are final' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_member_session_protection BEFORE UPDATE ON platform_member_sessions
  FOR EACH ROW EXECUTE FUNCTION platform_member_session_protect();

CREATE TABLE platform_member_session_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  auth_subject_link_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('session.created','session.revoked')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_member_session_audit_subject_person_fk FOREIGN KEY (auth_subject_link_id,person_id)
    REFERENCES platform_person_auth_subjects(id,person_id) ON DELETE RESTRICT
);
CREATE INDEX platform_member_session_audit_person_idx ON platform_member_session_audit_events(person_id,occurred_at DESC,id DESC);
CREATE FUNCTION platform_member_session_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'member session audit is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER platform_member_session_audit_immutable BEFORE UPDATE OR DELETE ON platform_member_session_audit_events
  FOR EACH ROW EXECUTE FUNCTION platform_member_session_audit_immutable();
CREATE TRIGGER platform_member_session_audit_no_truncate BEFORE TRUNCATE ON platform_member_session_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_member_session_audit_immutable();
