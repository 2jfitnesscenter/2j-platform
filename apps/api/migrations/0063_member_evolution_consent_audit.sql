ALTER TABLE client_consents DROP CONSTRAINT client_consents_type;
ALTER TABLE client_consents ADD CONSTRAINT client_consents_type CHECK (consent_type IN ('data_processing','center_rules','image_use','physical_activity','health_data','home_evolution','other'));
CREATE UNIQUE INDEX client_consents_one_active_home_evolution ON client_consents(consent_type) WHERE consent_type='home_evolution' AND status='active';

CREATE TABLE platform_member_evolution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  person_id uuid REFERENCES platform_persons(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  consent_version_id uuid REFERENCES client_consent_versions(id) ON DELETE RESTRICT,
  consent_content_sha256 char(64),
  typed_name text,
  decision text,
  idempotency_key uuid,
  request_hash char(64),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_member_evolution_event_type_check CHECK (event_type IN ('summary_requested','consent_granted','consent_revoked')),
  CONSTRAINT platform_member_evolution_decision_check CHECK (decision IS NULL OR decision IN ('allowed','not_linked','entitlement_required','consent_unpublished','consent_required','consent_revoked')),
  CONSTRAINT platform_member_evolution_hash_check CHECK ((consent_content_sha256 IS NULL OR consent_content_sha256 ~ '^[0-9a-f]{64}$') AND (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$')),
  CONSTRAINT platform_member_evolution_typed_name_check CHECK (typed_name IS NULL OR (char_length(btrim(typed_name)) BETWEEN 1 AND 160 AND typed_name=btrim(typed_name))),
  CONSTRAINT platform_member_evolution_event_shape_check CHECK (
    (event_type='summary_requested' AND consent_version_id IS NULL AND consent_content_sha256 IS NULL AND typed_name IS NULL AND decision IS NOT NULL AND idempotency_key IS NULL AND request_hash IS NULL)
    OR (event_type='consent_granted' AND consent_version_id IS NOT NULL AND consent_content_sha256 IS NOT NULL AND typed_name IS NOT NULL AND decision IS NULL AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL)
    OR (event_type='consent_revoked' AND consent_version_id IS NOT NULL AND consent_content_sha256 IS NOT NULL AND typed_name IS NULL AND decision IS NULL AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL)
  )
);
CREATE UNIQUE INDEX platform_member_evolution_idempotency_unique ON platform_member_evolution_events(client_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX platform_member_evolution_client_timeline_idx ON platform_member_evolution_events(client_id,occurred_at DESC,id DESC);
CREATE INDEX platform_member_evolution_person_timeline_idx ON platform_member_evolution_events(person_id,occurred_at DESC,id DESC) WHERE person_id IS NOT NULL;

CREATE FUNCTION platform_member_evolution_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'member evolution events are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER platform_member_evolution_events_no_change BEFORE UPDATE OR DELETE ON platform_member_evolution_events
  FOR EACH ROW EXECUTE FUNCTION platform_member_evolution_events_immutable();
CREATE TRIGGER platform_member_evolution_events_no_truncate BEFORE TRUNCATE ON platform_member_evolution_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_member_evolution_events_immutable();
REVOKE UPDATE, DELETE, TRUNCATE ON platform_member_evolution_events FROM PUBLIC;
