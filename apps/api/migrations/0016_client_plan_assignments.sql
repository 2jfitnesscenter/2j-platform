CREATE TABLE client_plan_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_version integer NOT NULL,
  charge_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  status text NOT NULL DEFAULT 'active',
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_plan_assignments_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT client_plan_assignments_charge_id_economic_charges_id_fk FOREIGN KEY (charge_id) REFERENCES economic_charges(id) ON DELETE RESTRICT,
  CONSTRAINT client_plan_assignments_version_fk FOREIGN KEY (plan_id,plan_version) REFERENCES plan_versions(plan_id,version) ON DELETE RESTRICT,
  CONSTRAINT client_plan_assignments_charge_client_fk FOREIGN KEY (charge_id,client_id) REFERENCES economic_charges(id,client_id) ON DELETE RESTRICT,
  CONSTRAINT client_plan_assignments_status CHECK (status IN ('active','cancelled')),
  CONSTRAINT client_plan_assignments_date_range CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT client_plan_assignments_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT client_plan_assignments_actor CHECK (char_length(created_by) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX client_plan_assignments_idempotency_unique ON client_plan_assignments(idempotency_key);
CREATE INDEX client_plan_assignments_client_dates_idx ON client_plan_assignments(client_id,starts_on DESC,created_at DESC);

CREATE TABLE dashboard_preferences (
  actor_id text PRIMARY KEY,
  layout jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dashboard_preferences ADD CONSTRAINT dashboard_preferences_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120);
ALTER TABLE dashboard_preferences ADD CONSTRAINT dashboard_preferences_layout CHECK (jsonb_typeof(layout)='object');

ALTER TABLE client_events DROP CONSTRAINT client_events_type_allowed;
ALTER TABLE client_events ADD CONSTRAINT client_events_type_allowed CHECK (event_type IN ('client.created','client.archived','client.plan_assigned'));

CREATE OR REPLACE FUNCTION client_plan_assignment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'client plan assignments preserve purchase history' USING ERRCODE='55000', CONSTRAINT='client_plan_assignment_immutable';
END $$;
CREATE TRIGGER client_plan_assignments_immutable BEFORE UPDATE OR DELETE ON client_plan_assignments FOR EACH ROW EXECUTE FUNCTION client_plan_assignment_immutable();
