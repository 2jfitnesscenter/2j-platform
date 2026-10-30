CREATE TABLE center_business_profile (
  center_key text PRIMARY KEY CHECK (center_key = '2j'),
  business_name text NOT NULL,
  contact_email text,
  contact_phone text,
  address text,
  city text,
  postal_code text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT center_business_name_length CHECK (char_length(btrim(business_name)) BETWEEN 1 AND 120),
  CONSTRAINT center_business_email_length CHECK (contact_email IS NULL OR char_length(contact_email) BETWEEN 3 AND 254),
  CONSTRAINT center_business_phone_length CHECK (contact_phone IS NULL OR char_length(contact_phone) BETWEEN 5 AND 40),
  CONSTRAINT center_business_address_length CHECK (address IS NULL OR char_length(address) <= 200),
  CONSTRAINT center_business_city_length CHECK (city IS NULL OR char_length(city) <= 100),
  CONSTRAINT center_business_postal_length CHECK (postal_code IS NULL OR char_length(postal_code) <= 20),
  CONSTRAINT center_business_updated_by_length CHECK (char_length(btrim(updated_by)) BETWEEN 1 AND 120)
);

CREATE TABLE center_business_profile_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_key text NOT NULL REFERENCES center_business_profile(center_key) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action = 'center_profile.updated'),
  changed_fields jsonb NOT NULL CHECK (jsonb_typeof(changed_fields) = 'array'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT center_business_profile_audit_actor CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 120)
);
CREATE INDEX center_business_profile_audit_timeline_idx ON center_business_profile_audit_events(center_key, occurred_at DESC, id DESC);
CREATE FUNCTION center_business_profile_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'center business profile audit is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER center_business_profile_audit_no_change BEFORE UPDATE OR DELETE ON center_business_profile_audit_events FOR EACH ROW EXECUTE FUNCTION center_business_profile_audit_guard();
CREATE TRIGGER center_business_profile_audit_no_truncate BEFORE TRUNCATE ON center_business_profile_audit_events FOR EACH STATEMENT EXECUTE FUNCTION center_business_profile_audit_guard();
REVOKE DELETE, TRUNCATE ON center_business_profile_audit_events FROM PUBLIC;
