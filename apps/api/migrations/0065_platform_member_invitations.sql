-- Platform member invitations: bearer secret is returned once and only its SHA-256 digest is persisted.
-- Issuing an invitation does not create a person/client or a Training account. Redemption remains a separate gated integration.
CREATE TABLE platform_member_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','revoked')),
  created_by text NOT NULL CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_by text,
  revoked_at timestamptz,
  revoke_reason text,
  CONSTRAINT platform_member_invitations_expiry_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CONSTRAINT platform_member_invitations_revoked_by_check CHECK (revoked_by IS NULL OR char_length(btrim(revoked_by)) BETWEEN 1 AND 120),
  CONSTRAINT platform_member_invitations_reason_check CHECK (revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 10 AND 300),
  CONSTRAINT platform_member_invitations_revoke_state_check CHECK (
    (status='pending' AND revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);
CREATE INDEX platform_member_invitations_listing_idx ON platform_member_invitations(created_at DESC,id DESC);
CREATE INDEX platform_member_invitations_expiry_idx ON platform_member_invitations(expires_at) WHERE status='pending';

CREATE TABLE platform_member_invitation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES platform_member_invitations(id) ON DELETE RESTRICT,
  actor_id text NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 120),
  action text NOT NULL CHECK (action IN ('created','revoked')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_member_invitation_events_timeline_idx ON platform_member_invitation_events(invitation_id,occurred_at,id);

CREATE FUNCTION platform_member_invitation_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='platform_member_invitation_events' THEN
    RAISE EXCEPTION 'platform_member_invitation_events is append-only' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'member invitations are retained' USING ERRCODE='55000'; END IF;
  IF OLD.status <> 'pending' OR NEW.id <> OLD.id OR NEW.token_hash <> OLD.token_hash OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'member invitation is immutable except for one revocation' USING ERRCODE='55000';
  END IF;
  IF NEW.status <> 'revoked' THEN RAISE EXCEPTION 'member invitation transition is invalid' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_member_invitations_protect BEFORE UPDATE OR DELETE ON platform_member_invitations FOR EACH ROW EXECUTE FUNCTION platform_member_invitation_protect();
CREATE TRIGGER platform_member_invitation_events_protect BEFORE UPDATE OR DELETE ON platform_member_invitation_events FOR EACH ROW EXECUTE FUNCTION platform_member_invitation_protect();
