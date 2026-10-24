-- Browser-bound Training SSO codes (decision 3 of the final pre-audit decisions).
-- A code is issued for a challenge created by the browser that started the flow at Training (PKCE S256: challenge = base64url(SHA-256(verifier))).
-- Only the challenge is stored. The verifier stays in an HttpOnly cookie of Training's origin and is sent server-to-server at redemption,
-- so a code that reaches any other browser (login CSRF, a forwarded link) cannot be redeemed.
-- Additive: one nullable column (rows issued before this migration, if any, are unaffected and can no longer be redeemed by the new code path),
-- a stricter insert guard, and the immutability list extended with the new column.
ALTER TABLE platform_training_sso_codes ADD COLUMN binding_challenge char(43);
ALTER TABLE platform_training_sso_codes ADD CONSTRAINT platform_training_sso_binding_format_check
  CHECK (binding_challenge IS NULL OR binding_challenge ~ '^[A-Za-z0-9_-]{43}$');

CREATE OR REPLACE FUNCTION validate_platform_training_sso_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE person_status text; subject_status text; linked integer;
BEGIN
  IF NEW.state<>'pending' OR NEW.version<>1 OR NEW.consumed_at IS NOT NULL OR NEW.consumed_key_id IS NOT NULL OR NEW.terminal_reason IS NOT NULL THEN
    RAISE EXCEPTION 'SSO code must start pending' USING ERRCODE='23514';
  END IF;
  IF NEW.binding_challenge IS NULL THEN RAISE EXCEPTION 'SSO code must be bound to a browser challenge' USING ERRCODE='23514'; END IF;
  NEW.created_at=now();
  IF NEW.expires_at<=now() OR NEW.expires_at>now()+interval '60 seconds' THEN RAISE EXCEPTION 'SSO code TTL is invalid' USING ERRCODE='23514'; END IF;
  SELECT p.status,s.status INTO person_status,subject_status FROM platform_persons p JOIN platform_person_auth_subjects s ON s.person_id=p.id
    WHERE p.id=NEW.person_id AND s.id=NEW.auth_subject_link_id FOR SHARE OF p,s;
  IF person_status IS DISTINCT FROM 'active' OR subject_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'identity binding is not active' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO linked FROM training_account_links WHERE person_id=NEW.person_id AND training_user_id=NEW.training_user_id AND status='active';
  IF linked<>1 THEN RAISE EXCEPTION 'active Training link required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_platform_training_sso_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SSO code history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.auth_subject_link_id IS DISTINCT FROM OLD.auth_subject_link_id OR NEW.training_user_id IS DISTINCT FROM OLD.training_user_id
    OR NEW.audience IS DISTINCT FROM OLD.audience OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.binding_challenge IS DISTINCT FROM OLD.binding_challenge
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
