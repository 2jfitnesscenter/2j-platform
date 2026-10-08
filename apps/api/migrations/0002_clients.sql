CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_first_name_length CHECK (char_length(btrim(first_name)) BETWEEN 1 AND 80),
  CONSTRAINT clients_last_name_length CHECK (char_length(btrim(last_name)) BETWEEN 1 AND 100),
  CONSTRAINT clients_email_length CHECK (email IS NULL OR char_length(email) <= 254),
  CONSTRAINT clients_phone_length CHECK (phone IS NULL OR char_length(phone) <= 40),
  CONSTRAINT clients_status_allowed CHECK (status IN ('active', 'archived'))
);
CREATE INDEX clients_active_name_idx ON clients(lower(last_name), lower(first_name), id) WHERE status='active';
CREATE INDEX clients_archived_name_idx ON clients(lower(last_name), lower(first_name), id) WHERE status='archived';

CREATE TABLE client_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL CONSTRAINT client_events_client_id_clients_id_fk REFERENCES clients(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_events_type_allowed CHECK (event_type IN ('client.created', 'client.archived')),
  CONSTRAINT client_events_actor_length CHECK (char_length(actor_id) BETWEEN 1 AND 120)
);
CREATE INDEX client_events_timeline_idx ON client_events(client_id, occurred_at DESC, id DESC);

CREATE FUNCTION protect_client_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'client records are archived, not deleted' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER clients_no_delete BEFORE DELETE ON clients FOR EACH ROW EXECUTE FUNCTION protect_client_history();
CREATE TRIGGER clients_no_truncate BEFORE TRUNCATE ON clients FOR EACH STATEMENT EXECUTE FUNCTION protect_client_history();
CREATE TRIGGER client_events_no_update BEFORE UPDATE OR DELETE ON client_events FOR EACH ROW EXECUTE FUNCTION protect_client_history();
CREATE TRIGGER client_events_no_truncate BEFORE TRUNCATE ON client_events FOR EACH STATEMENT EXECUTE FUNCTION protect_client_history();
