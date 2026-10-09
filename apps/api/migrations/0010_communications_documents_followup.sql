CREATE TABLE communication_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_key text NOT NULL DEFAULT '2j',
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT communication_conversations_center_key CHECK (char_length(center_key) BETWEEN 1 AND 80),
  CONSTRAINT communication_conversations_status CHECK (status IN ('active','archived')),
  CONSTRAINT communication_conversations_center_client_unique UNIQUE (center_key,client_id)
);
CREATE INDEX communication_conversations_inbox_idx ON communication_conversations(status,last_message_at DESC,id DESC);

CREATE TABLE communication_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES communication_conversations(id) ON DELETE RESTRICT,
  sender_kind text NOT NULL,
  sender_actor_id text NOT NULL,
  body text NOT NULL,
  template_id uuid,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_messages_sender CHECK (sender_kind IN ('staff','client')),
  CONSTRAINT communication_messages_actor CHECK (char_length(sender_actor_id) BETWEEN 1 AND 120),
  CONSTRAINT communication_messages_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  CONSTRAINT communication_messages_idempotency_unique UNIQUE (conversation_id,sender_kind,idempotency_key)
);
CREATE INDEX communication_messages_timeline_idx ON communication_messages(conversation_id,created_at,id);

CREATE TABLE communication_message_reads (
  message_id uuid NOT NULL REFERENCES communication_messages(id) ON DELETE RESTRICT,
  reader_kind text NOT NULL,
  is_read boolean NOT NULL,
  actor_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,reader_kind),
  CONSTRAINT communication_message_reads_reader CHECK (reader_kind IN ('center','client')),
  CONSTRAINT communication_message_reads_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120)
);

CREATE TABLE communication_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES communication_conversations(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_internal_notes_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 3000),
  CONSTRAINT communication_internal_notes_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120)
);
CREATE INDEX communication_internal_notes_timeline_idx ON communication_internal_notes(conversation_id,created_at DESC,id DESC);

CREATE TABLE communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT communication_templates_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT communication_templates_category CHECK (category IN ('welcome','documents','payment','reservation','followup','general')),
  CONSTRAINT communication_templates_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  CONSTRAINT communication_templates_status CHECK (status IN ('active','archived')),
  CONSTRAINT communication_templates_creator CHECK (char_length(created_by) BETWEEN 1 AND 120),
  CONSTRAINT communication_templates_updater CHECK (char_length(updated_by) BETWEEN 1 AND 120)
);
ALTER TABLE communication_messages ADD CONSTRAINT communication_messages_template_fk FOREIGN KEY(template_id) REFERENCES communication_templates(id) ON DELETE RESTRICT;

CREATE TABLE communication_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_audit_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  CONSTRAINT communication_audit_action CHECK (action IN ('conversation.created','message.sent','message.read','message.unread','internal_note.created','template.created','template.updated','template.archived','template.sent','form.created','form.version_created','form.activated','form.archived','form.assigned','form.responded','form.reviewed','consent.created','consent.version_created','consent.activated','consent.accepted','requirement.created','requirement.archived','requirement.overridden')),
  CONSTRAINT communication_audit_details CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX communication_audit_client_timeline_idx ON communication_audit_events(client_id,occurred_at DESC,id DESC);

CREATE TABLE client_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  sensitivity text NOT NULL DEFAULT 'operational',
  status text NOT NULL DEFAULT 'draft',
  active_version_id uuid,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT client_forms_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT client_forms_category CHECK (category IN ('general','onboarding','par_q','check_in','consent_support')),
  CONSTRAINT client_forms_sensitivity CHECK (sensitivity IN ('operational','health')),
  CONSTRAINT client_forms_status CHECK (status IN ('draft','active','archived')),
  CONSTRAINT client_forms_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);

CREATE TABLE client_form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES client_forms(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  description text NOT NULL DEFAULT '',
  fields jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_form_versions_sequence_unique UNIQUE(form_id,version),
  CONSTRAINT client_form_versions_positive CHECK (version > 0),
  CONSTRAINT client_form_versions_description CHECK (char_length(description) <= 2000),
  CONSTRAINT client_form_versions_fields_array CHECK (jsonb_typeof(fields)='array' AND jsonb_array_length(fields) BETWEEN 1 AND 100),
  CONSTRAINT client_form_versions_status CHECK (status IN ('draft','active','archived')),
  CONSTRAINT client_form_versions_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
ALTER TABLE client_forms ADD CONSTRAINT client_forms_active_version_fk FOREIGN KEY(active_version_id) REFERENCES client_form_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX client_form_versions_form_idx ON client_form_versions(form_id,version DESC);

CREATE TABLE client_form_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  form_version_id uuid NOT NULL REFERENCES client_form_versions(id) ON DELETE RESTRICT,
  required boolean NOT NULL DEFAULT false,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'assigned',
  idempotency_key uuid NOT NULL,
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_form_assignments_status CHECK (status IN ('assigned','submitted','review_required','approved','rejected','expired','cancelled')),
  CONSTRAINT client_form_assignments_actor CHECK (char_length(assigned_by) BETWEEN 1 AND 120),
  CONSTRAINT client_form_assignments_idempotency_unique UNIQUE(client_id,idempotency_key)
);
CREATE UNIQUE INDEX client_form_assignments_active_unique ON client_form_assignments(client_id,form_version_id) WHERE status IN ('assigned','submitted','review_required');
CREATE INDEX client_form_assignments_client_status_idx ON client_form_assignments(client_id,status,due_at);

CREATE TABLE client_form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL UNIQUE REFERENCES client_form_assignments(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  form_version_id uuid NOT NULL REFERENCES client_form_versions(id) ON DELETE RESTRICT,
  answers jsonb NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_form_responses_answers_object CHECK (jsonb_typeof(answers)='object'),
  CONSTRAINT client_form_responses_request_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_form_responses_idempotency_unique UNIQUE(client_id,idempotency_key)
);
CREATE INDEX client_form_responses_client_history_idx ON client_form_responses(client_id,submitted_at DESC,id DESC);

CREATE TABLE client_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  consent_type text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  requires_acceptance boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft',
  active_version_id uuid,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT client_consents_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT client_consents_type CHECK (consent_type IN ('data_processing','center_rules','image_use','physical_activity','health_data','other')),
  CONSTRAINT client_consents_status CHECK (status IN ('draft','active','archived')),
  CONSTRAINT client_consents_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);

CREATE TABLE client_consent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id uuid NOT NULL REFERENCES client_consents(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  content_sha256 text NOT NULL,
  effective_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_consent_versions_sequence_unique UNIQUE(consent_id,version),
  CONSTRAINT client_consent_versions_positive CHECK (version > 0),
  CONSTRAINT client_consent_versions_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT client_consent_versions_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 30000),
  CONSTRAINT client_consent_versions_hash CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_consent_versions_status CHECK (status IN ('draft','active','archived')),
  CONSTRAINT client_consent_versions_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
ALTER TABLE client_consents ADD CONSTRAINT client_consents_active_version_fk FOREIGN KEY(active_version_id) REFERENCES client_consent_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE client_consent_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  consent_version_id uuid NOT NULL REFERENCES client_consent_versions(id) ON DELETE RESTRICT,
  method text NOT NULL,
  typed_name text NOT NULL,
  accepted_by text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  accepted_content_sha256 text NOT NULL,
  accepted_content_snapshot text NOT NULL,
  idempotency_key uuid NOT NULL,
  CONSTRAINT client_consent_acceptances_unique UNIQUE(client_id,consent_version_id),
  CONSTRAINT client_consent_acceptances_method CHECK (method IN ('checkbox_typed_name','staff_assisted')),
  CONSTRAINT client_consent_acceptances_name CHECK (char_length(btrim(typed_name)) BETWEEN 1 AND 160),
  CONSTRAINT client_consent_acceptances_actor CHECK (char_length(accepted_by) BETWEEN 1 AND 120),
  CONSTRAINT client_consent_acceptances_hash CHECK (accepted_content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_consent_acceptances_snapshot CHECK (char_length(accepted_content_snapshot) BETWEEN 1 AND 30000),
  CONSTRAINT client_consent_acceptances_idempotency UNIQUE(client_id,idempotency_key)
);
CREATE INDEX client_consent_acceptances_client_idx ON client_consent_acceptances(client_id,accepted_at DESC);

CREATE TABLE document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,
  scope_id uuid,
  requirement_type text NOT NULL,
  form_id uuid REFERENCES client_forms(id) ON DELETE RESTRICT,
  consent_id uuid REFERENCES client_consents(id) ON DELETE RESTRICT,
  required boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  retention_policy_key text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT document_requirements_scope CHECK ((scope_type='center' AND scope_id IS NULL) OR (scope_type IN ('client','service','plan') AND scope_id IS NOT NULL)),
  CONSTRAINT document_requirements_type CHECK ((requirement_type='form' AND form_id IS NOT NULL AND consent_id IS NULL) OR (requirement_type='consent' AND consent_id IS NOT NULL AND form_id IS NULL)),
  CONSTRAINT document_requirements_creator CHECK (char_length(created_by) BETWEEN 1 AND 120),
  CONSTRAINT document_requirements_retention_key CHECK (retention_policy_key IS NULL OR char_length(retention_policy_key) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX document_requirements_active_unique ON document_requirements(scope_type,COALESCE(scope_id,'00000000-0000-0000-0000-000000000000'::uuid),requirement_type,COALESCE(form_id,consent_id)) WHERE active;
CREATE INDEX document_requirements_scope_idx ON document_requirements(scope_type,scope_id) WHERE active AND required;

CREATE TABLE followup_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT followup_audit_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  CONSTRAINT followup_audit_action CHECK (action IN ('form.created','form.version_created','form.activated','form.archived','form.assigned','form.responded','form.reviewed','consent.created','consent.version_created','consent.activated','consent.accepted','requirement.created','requirement.archived','requirement.overridden')),
  CONSTRAINT followup_audit_details CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX followup_audit_client_idx ON followup_audit_events(client_id,occurred_at DESC,id DESC);

CREATE FUNCTION communications_history_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'communications history is append only' USING ERRCODE='55000'; END;
$$;
CREATE FUNCTION communications_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'communications version history is append only' USING ERRCODE='55000'; END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION 'communications version content is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER communication_messages_no_delete BEFORE DELETE ON communication_messages FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER communication_messages_no_truncate BEFORE TRUNCATE ON communication_messages FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER communication_internal_notes_no_change BEFORE UPDATE OR DELETE ON communication_internal_notes FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER communication_internal_notes_no_truncate BEFORE TRUNCATE ON communication_internal_notes FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER communication_audit_no_change BEFORE UPDATE OR DELETE ON communication_audit_events FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER communication_audit_no_truncate BEFORE TRUNCATE ON communication_audit_events FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER client_form_versions_no_change BEFORE UPDATE OR DELETE ON client_form_versions FOR EACH ROW EXECUTE FUNCTION communications_version_guard();
CREATE TRIGGER client_form_versions_no_truncate BEFORE TRUNCATE ON client_form_versions FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER client_form_responses_no_change BEFORE UPDATE OR DELETE ON client_form_responses FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER client_form_responses_no_truncate BEFORE TRUNCATE ON client_form_responses FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER client_consent_versions_no_change BEFORE UPDATE OR DELETE ON client_consent_versions FOR EACH ROW EXECUTE FUNCTION communications_version_guard();
CREATE TRIGGER client_consent_versions_no_truncate BEFORE TRUNCATE ON client_consent_versions FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER client_consent_acceptances_no_change BEFORE UPDATE OR DELETE ON client_consent_acceptances FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER client_consent_acceptances_no_truncate BEFORE TRUNCATE ON client_consent_acceptances FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER followup_audit_no_change BEFORE UPDATE OR DELETE ON followup_audit_events FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER followup_audit_no_truncate BEFORE TRUNCATE ON followup_audit_events FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();

REVOKE DELETE, TRUNCATE ON communication_messages,communication_internal_notes,communication_audit_events,client_form_versions,client_form_responses,client_consent_versions,client_consent_acceptances,followup_audit_events FROM PUBLIC;

ALTER TABLE calendar_audit_events DROP CONSTRAINT calendar_audit_action;
ALTER TABLE calendar_audit_events ADD CONSTRAINT calendar_audit_action CHECK (action IN ('session.created','session.generated','session.cancelled','session.reassigned','session.availability_override','template.archived','reservation.created','reservation.cancelled','reservation.overbooked','reservation.attendance_changed','reservation.cancelled_by_center','reservation.debt_override','reservation.document_override','waitlist.entered','waitlist.cancelled','waitlist.cancelled_by_center'));
