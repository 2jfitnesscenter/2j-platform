CREATE TABLE client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  title text NOT NULL,
  document_type text NOT NULL,
  visibility text NOT NULL DEFAULT 'staff_only',
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  file_extension text NOT NULL,
  size_bytes integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT client_documents_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT client_documents_type CHECK (document_type IN ('contract','consent','identity','other')),
  CONSTRAINT client_documents_visibility CHECK (visibility IN ('staff_only','client_visible')),
  CONSTRAINT client_documents_object_key CHECK (char_length(object_key) BETWEEN 1 AND 240 AND object_key !~ '(^/|\.\.|//)'),
  CONSTRAINT client_documents_mime CHECK ((mime_type='application/pdf' AND file_extension='pdf') OR (mime_type='image/jpeg' AND file_extension='jpg') OR (mime_type='image/png' AND file_extension='png')),
  CONSTRAINT client_documents_size CHECK (size_bytes BETWEEN 1 AND 5242880),
  CONSTRAINT client_documents_status CHECK ((status='active' AND archived_at IS NULL) OR (status='archived' AND archived_at IS NOT NULL)),
  CONSTRAINT client_documents_creator CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
CREATE INDEX client_documents_client_timeline_idx ON client_documents(client_id,created_at DESC,id DESC) WHERE status='active';
CREATE INDEX client_documents_client_visible_idx ON client_documents(client_id,created_at DESC,id DESC) WHERE status='active' AND visibility='client_visible';

CREATE TABLE client_document_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES client_documents(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  actor_kind text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_document_audit_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  CONSTRAINT client_document_audit_actor_kind CHECK (actor_kind IN ('staff','client')),
  CONSTRAINT client_document_audit_action CHECK (action IN ('uploaded','visibility_changed','downloaded')),
  CONSTRAINT client_document_audit_details CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX client_document_audit_timeline_idx ON client_document_audit_events(client_id,document_id,occurred_at DESC,id DESC);
CREATE FUNCTION client_document_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'client document audit history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER client_document_audit_no_change BEFORE UPDATE OR DELETE ON client_document_audit_events FOR EACH ROW EXECUTE FUNCTION client_document_history_guard();
CREATE TRIGGER client_document_audit_no_truncate BEFORE TRUNCATE ON client_document_audit_events FOR EACH STATEMENT EXECUTE FUNCTION client_document_history_guard();
REVOKE DELETE, TRUNCATE ON client_document_audit_events FROM PUBLIC;
