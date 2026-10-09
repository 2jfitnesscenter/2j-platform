-- 2J-073: extend the central commercial catalog and client entitlement model.
ALTER TABLE plan_versions ADD COLUMN base_price_cents bigint;
ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_base_price_range
  CHECK (base_price_cents IS NULL OR base_price_cents BETWEEN 0 AND 100000000000);

CREATE TABLE plan_module_accesses (
  plan_id uuid NOT NULL,
  plan_version integer NOT NULL,
  module text NOT NULL CONSTRAINT plan_module_accesses_module CHECK (module IN ('reservations','training','nutrition','health')),
  access_level text NOT NULL CONSTRAINT plan_module_accesses_level CHECK (access_level IN ('limited','full')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id,plan_version,module),
  CONSTRAINT plan_module_accesses_version_fk FOREIGN KEY(plan_id,plan_version) REFERENCES plan_versions(plan_id,version) ON DELETE RESTRICT
);
CREATE TABLE plan_module_capabilities (
  plan_id uuid NOT NULL,
  plan_version integer NOT NULL,
  module text NOT NULL,
  capability text NOT NULL CONSTRAINT plan_module_capabilities_format CHECK (capability ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id,plan_version,module,capability),
  CONSTRAINT plan_module_capabilities_access_fk FOREIGN KEY(plan_id,plan_version,module) REFERENCES plan_module_accesses(plan_id,plan_version,module) ON DELETE RESTRICT
);
CREATE TABLE plan_version_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL CONSTRAINT plan_version_changes_plan_id_plans_id_fk REFERENCES plans(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  actor_id text NOT NULL CONSTRAINT plan_version_changes_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  idempotency_key uuid NOT NULL CONSTRAINT plan_version_changes_idempotency_unique UNIQUE,
  request_hash char(64) NOT NULL CONSTRAINT plan_version_changes_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_version_changes_version_fk FOREIGN KEY(plan_id,version) REFERENCES plan_versions(plan_id,version) ON DELETE RESTRICT
);
CREATE FUNCTION plan_version_changes_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'plan version changes are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER plan_version_changes_immutable BEFORE UPDATE OR DELETE ON plan_version_changes
  FOR EACH ROW EXECUTE FUNCTION plan_version_changes_append_only();
CREATE TRIGGER plan_module_accesses_immutable BEFORE INSERT OR UPDATE OR DELETE ON plan_module_accesses
  FOR EACH ROW EXECUTE FUNCTION reject_active_plan_definition_mutation();
CREATE TRIGGER plan_module_capabilities_immutable BEFORE INSERT OR UPDATE OR DELETE ON plan_module_capabilities
  FOR EACH ROW EXECUTE FUNCTION reject_active_plan_definition_mutation();

ALTER TABLE client_plan_assignments
  ADD COLUMN sale_price_cents bigint,
  ADD COLUMN snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE client_plan_assignments ADD CONSTRAINT client_plan_assignments_sale_price_range
  CHECK (sale_price_cents IS NULL OR sale_price_cents BETWEEN 0 AND 100000000000);
ALTER TABLE client_plan_assignments ADD CONSTRAINT client_plan_assignments_snapshot_object
  CHECK (jsonb_typeof(snapshot)='object');

-- Lifecycle is an append-only event stream. The original assignment and its commercial snapshot never change.
CREATE TABLE client_plan_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL CONSTRAINT client_plan_assignment_events_assignment_fk REFERENCES client_plan_assignments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CONSTRAINT client_plan_assignment_events_type CHECK (event_type IN ('activated','paused','resumed','cancelled','renewed','changed')),
  effective_on date NOT NULL,
  expected_resume_on date,
  reason text,
  actor_id text NOT NULL CONSTRAINT client_plan_assignment_events_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  actor_role text CONSTRAINT client_plan_assignment_events_actor_role CHECK (actor_role IN ('admin','trainer','reception-management','accountant')),
  idempotency_key uuid NOT NULL CONSTRAINT client_plan_assignment_events_idempotency_unique UNIQUE,
  request_hash char(64) NOT NULL CONSTRAINT client_plan_assignment_events_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_plan_assignment_events_resume_range CHECK (expected_resume_on IS NULL OR expected_resume_on >= effective_on),
  CONSTRAINT client_plan_assignment_events_reason CHECK ((event_type IN ('paused','cancelled') AND char_length(btrim(COALESCE(reason,''))) BETWEEN 3 AND 240) OR (event_type NOT IN ('paused','cancelled')))
);
CREATE INDEX client_plan_assignment_events_timeline_idx ON client_plan_assignment_events(assignment_id,effective_on DESC,created_at DESC,id DESC);

-- Composite FK used by the ledger.
ALTER TABLE client_plan_assignments ADD CONSTRAINT client_plan_assignments_id_client_unique UNIQUE(id,client_id);

CREATE TABLE client_entitlement_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL CONSTRAINT client_entitlement_ledger_client_fk REFERENCES clients(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL,
  right_key text NOT NULL CONSTRAINT client_entitlement_ledger_right_key CHECK (char_length(right_key) BETWEEN 1 AND 120),
  entry_type text NOT NULL CONSTRAINT client_entitlement_ledger_entry_type CHECK (entry_type IN ('grant','consume','restore','adjustment','expire')),
  quantity integer NOT NULL CONSTRAINT client_entitlement_ledger_quantity CHECK (quantity <> 0 AND quantity BETWEEN -100000 AND 100000 AND ((entry_type IN ('grant','restore') AND quantity>0) OR (entry_type IN ('consume','expire') AND quantity<0) OR entry_type='adjustment')),
  reason text NOT NULL CONSTRAINT client_entitlement_ledger_reason CHECK (char_length(btrim(reason)) BETWEEN 2 AND 240),
  external_reference text,
  actor_id text NOT NULL CONSTRAINT client_entitlement_ledger_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  idempotency_key uuid NOT NULL CONSTRAINT client_entitlement_ledger_idempotency_unique UNIQUE,
  request_hash char(64) NOT NULL CONSTRAINT client_entitlement_ledger_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_entitlement_ledger_assignment_client_fk FOREIGN KEY(assignment_id,client_id) REFERENCES client_plan_assignments(id,client_id) ON DELETE RESTRICT
);
CREATE INDEX client_entitlement_ledger_balance_idx ON client_entitlement_ledger(assignment_id,right_key,occurred_at,id);
CREATE INDEX client_entitlement_ledger_client_idx ON client_entitlement_ledger(client_id,occurred_at DESC,id DESC);

CREATE FUNCTION client_entitlement_ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'entitlement ledger is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER client_entitlement_ledger_immutable BEFORE UPDATE OR DELETE ON client_entitlement_ledger
  FOR EACH ROW EXECUTE FUNCTION client_entitlement_ledger_append_only();
CREATE FUNCTION client_entitlement_balance_nonnegative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE existing_balance integer;
BEGIN
  PERFORM 1 FROM client_plan_assignments WHERE id=NEW.assignment_id FOR UPDATE;
  SELECT COALESCE(sum(quantity),0)::int INTO existing_balance FROM client_entitlement_ledger WHERE assignment_id=NEW.assignment_id AND right_key=NEW.right_key;
  IF existing_balance+NEW.quantity<0 THEN RAISE EXCEPTION 'entitlement balance cannot be negative' USING ERRCODE='23514',CONSTRAINT='client_entitlement_balance_nonnegative'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_entitlement_balance_guard BEFORE INSERT ON client_entitlement_ledger
  FOR EACH ROW EXECUTE FUNCTION client_entitlement_balance_nonnegative();
CREATE FUNCTION client_plan_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'assignment events are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER client_plan_events_immutable BEFORE UPDATE OR DELETE ON client_plan_assignment_events
  FOR EACH ROW EXECUTE FUNCTION client_plan_event_append_only();

CREATE OR REPLACE FUNCTION reject_immutable_plan_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.frozen_at IS NULL AND NEW.frozen_at IS NOT NULL AND
    (to_jsonb(NEW) - 'frozen_at') = (to_jsonb(OLD) - 'frozen_at') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'plan versions and their rights are immutable; create a new version' USING ERRCODE = '55000';
END $$;

CREATE OR REPLACE FUNCTION reject_active_plan_definition_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_plan_id uuid;
DECLARE selected_version integer;
BEGIN
  selected_plan_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;
  selected_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_version ELSE NEW.plan_version END;
  PERFORM 1 FROM plan_versions WHERE plan_id=selected_plan_id AND version=selected_version AND frozen_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'frozen plan definitions are immutable' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_plan_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'plans must be archived, not deleted' USING ERRCODE='55000'; END IF;
  IF NEW.status='archived' AND OLD.status<>'archived' THEN UPDATE plan_versions SET frozen_at=now() WHERE plan_id=OLD.id AND version=OLD.current_version AND frozen_at IS NULL; END IF;
  IF NEW.current_version<OLD.current_version THEN RAISE EXCEPTION 'plan versions cannot move backwards' USING ERRCODE='55000'; END IF;
  IF OLD.status='archived' AND (NEW.status<>'archived' OR NEW.current_version IS DISTINCT FROM OLD.current_version OR NEW.name IS DISTINCT FROM OLD.name) THEN RAISE EXCEPTION 'archived plans are immutable' USING ERRCODE='55000'; END IF;
  IF OLD.status='draft' AND NEW.current_version IS DISTINCT FROM OLD.current_version AND NEW.current_version<>OLD.current_version+1 THEN RAISE EXCEPTION 'draft plans may advance only to the next version' USING ERRCODE='55000'; END IF;
  IF OLD.status='active' AND NEW.current_version IS DISTINCT FROM OLD.current_version THEN
    IF NEW.current_version<>OLD.current_version+1 OR NOT EXISTS (SELECT 1 FROM plan_versions WHERE plan_id=NEW.id AND version=NEW.current_version AND frozen_at IS NOT NULL) THEN
      RAISE EXCEPTION 'active plans advance only to a frozen next version' USING ERRCODE='55000';
    END IF;
  END IF;
  IF OLD.status='draft' AND NEW.status='active' THEN
    IF NOT EXISTS (SELECT 1 FROM plan_versions WHERE plan_id=NEW.id AND version=NEW.current_version AND frozen_at IS NOT NULL) OR
      NOT EXISTS (SELECT 1 FROM plan_services WHERE plan_id=NEW.id AND plan_version=NEW.current_version) OR
      NOT EXISTS (SELECT 1 FROM plan_rights WHERE plan_id=NEW.id AND plan_version=NEW.current_version) THEN
      RAISE EXCEPTION 'active plans require a frozen version with services and rights' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=NEW.id AND ps.plan_version=NEW.current_version AND (s.status<>'active' OR a.status<>'active')) THEN
      RAISE EXCEPTION 'active plans require active services and areas' USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD.status='active' AND ((NEW.name IS DISTINCT FROM OLD.name AND NEW.current_version=OLD.current_version) OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.status NOT IN ('active','archived')) THEN
    RAISE EXCEPTION 'active plan identity is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;

-- Backfill immutable commercial snapshots and initial lifecycle state for existing sales.
ALTER TABLE client_plan_assignments DISABLE TRIGGER client_plan_assignments_immutable;
UPDATE client_plan_assignments x SET snapshot=jsonb_build_object(
  'planId',x.plan_id,'planVersion',x.plan_version,'name',p.name,'kind',v.kind,
  'salePriceCents',c.amount_cents,'services',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'area',a.name) ORDER BY s.id) FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=x.plan_id AND ps.plan_version=x.plan_version),'[]'::jsonb),
  'rights',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'rightType',r.right_type,'serviceId',r.service_id,'quotaScope',r.quota_scope,'quantity',r.quantity,'period',r.period,'validDays',r.valid_days,'validDaysStartRule',r.valid_days_start_rule) ORDER BY r.id) FROM plan_rights r WHERE r.plan_id=x.plan_id AND r.plan_version=x.plan_version),'[]'::jsonb),
  'modules',COALESCE((SELECT jsonb_agg(jsonb_build_object('module',m.module,'accessLevel',m.access_level,'capabilities',COALESCE((SELECT jsonb_agg(mc.capability ORDER BY mc.capability) FROM plan_module_capabilities mc WHERE mc.plan_id=m.plan_id AND mc.plan_version=m.plan_version AND mc.module=m.module),'[]'::jsonb)) ORDER BY m.module) FROM plan_module_accesses m WHERE m.plan_id=x.plan_id AND m.plan_version=x.plan_version),'[]'::jsonb),
  'startsOn',x.starts_on,'endsOn',x.ends_on,'terms',jsonb_build_object('renewalCadence',v.renewal_cadence,'periodDays',v.period_days,'timezone',v.timezone)
) , sale_price_cents=c.amount_cents
FROM plans p,plan_versions v,economic_charges c
WHERE p.id=x.plan_id AND v.plan_id=x.plan_id AND v.version=x.plan_version AND c.id=x.charge_id;
ALTER TABLE client_plan_assignments ENABLE TRIGGER client_plan_assignments_immutable;

ALTER TABLE client_events DROP CONSTRAINT client_events_type_allowed;
ALTER TABLE client_events ADD CONSTRAINT client_events_type_allowed CHECK (event_type IN ('client.created','client.archived','client.plan_assigned','client.plan_paused','client.plan_resumed','client.plan_cancelled','client.plan_renewed','client.plan_changed'));

INSERT INTO client_plan_assignment_events(assignment_id,event_type,effective_on,actor_id,actor_role,idempotency_key,request_hash,reason)
SELECT id,CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'activated' END,
  CASE WHEN status='cancelled' THEN (created_at AT TIME ZONE 'Atlantic/Canary')::date ELSE starts_on END,
  created_by,NULL,gen_random_uuid(),repeat('0',64),
  CASE WHEN status='cancelled' THEN 'Importado como cancelado desde el historial anterior.' ELSE NULL END
FROM client_plan_assignments;

INSERT INTO client_entitlement_ledger(client_id,assignment_id,right_key,entry_type,quantity,reason,actor_id,idempotency_key,request_hash)
SELECT a.client_id,a.id,r.id::text,'grant',r.quantity,'Saldo inicial importado del bono',a.created_by,gen_random_uuid(),repeat('0',64)
FROM client_plan_assignments a JOIN plan_versions v ON v.plan_id=a.plan_id AND v.version=a.plan_version
JOIN plan_rights r ON r.plan_id=a.plan_id AND r.plan_version=a.plan_version AND r.right_type='sessions_quota'
WHERE v.kind='session_pack' AND r.quantity IS NOT NULL;
