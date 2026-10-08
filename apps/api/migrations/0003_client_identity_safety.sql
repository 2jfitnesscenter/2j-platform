-- Active email addresses identify one current client; archived history may retain them.
CREATE UNIQUE INDEX clients_active_email_unique
  ON clients (lower(btrim(email)))
  WHERE status = 'active' AND email IS NOT NULL;

ALTER TABLE client_events
  ADD COLUMN actor_role text;
ALTER TABLE client_events
  ADD CONSTRAINT client_events_actor_role_allowed
  CHECK (actor_role IS NULL OR actor_role IN ('admin', 'trainer', 'reception-management', 'accountant'));

CREATE TABLE client_creation_idempotency (
  idempotency_key uuid PRIMARY KEY,
  request_hash char(64) NOT NULL,
  client_id uuid NOT NULL CONSTRAINT client_creation_idempotency_client_id_clients_id_fk REFERENCES clients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_creation_idempotency_hash_format CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX client_creation_idempotency_client_idx ON client_creation_idempotency(client_id);
