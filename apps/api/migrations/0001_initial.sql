CREATE TABLE areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT areas_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT areas_normalized_name_length CHECK (char_length(normalized_name) BETWEEN 1 AND 80),
  CONSTRAINT areas_normalized_name_matches_name CHECK (normalized_name = lower(btrim(name))),
  CONSTRAINT areas_status_allowed CHECK (status IN ('active', 'archived'))
);
CREATE UNIQUE INDEX areas_normalized_active_unique ON areas(lower(btrim(name))) WHERE status = 'active';
INSERT INTO areas(name, normalized_name, status) VALUES
  ('La Sala', 'la sala', 'active'), ('El Búnker', 'el búnker', 'active'),
  ('El Estudio', 'el estudio', 'active'), ('Entrenamiento personal', 'entrenamiento personal', 'active');

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id uuid NOT NULL REFERENCES areas(id) ON DELETE RESTRICT,
  name text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT services_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT services_status_allowed CHECK (status IN ('active', 'draft', 'archived'))
);
CREATE UNIQUE INDEX services_name_area_unique ON services(area_id, lower(name)) WHERE status <> 'archived';
CREATE INDEX services_updated_idx ON services(updated_at DESC, name);

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_name_length CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT plans_status_allowed CHECK (status IN ('active', 'draft', 'archived')),
  CONSTRAINT plans_version_positive CHECK (current_version > 0)
);
CREATE UNIQUE INDEX plans_active_name_unique ON plans(lower(name)) WHERE status <> 'archived';
CREATE UNIQUE INDEX plans_idempotency_key_unique ON plans(idempotency_key);
CREATE INDEX plans_status_name_idx ON plans(status, lower(name));

CREATE TABLE plan_services (
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  plan_version integer NOT NULL,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id, plan_version, service_id)
);
CREATE INDEX plan_services_service_idx ON plan_services(service_id, plan_id, plan_version);

CREATE TABLE plan_versions (
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  kind text NOT NULL,
  renewal_cadence text,
  period_days integer,
  timezone text NOT NULL DEFAULT 'Europe/Canary',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id, version),
  CONSTRAINT plan_versions_version_positive CHECK (version > 0),
  CONSTRAINT plan_versions_kind_allowed CHECK (kind IN ('recurring', 'session_pack')),
  CONSTRAINT plan_versions_cadence_allowed CHECK (renewal_cadence IS NULL OR renewal_cadence IN ('weekly', 'monthly', 'custom_period')),
  CONSTRAINT plan_versions_period_days_range CHECK (period_days IS NULL OR period_days BETWEEN 1 AND 3660),
  CONSTRAINT plan_versions_cadence_compatibility CHECK (
    (kind = 'recurring' AND renewal_cadence IS NOT NULL AND
      ((renewal_cadence = 'custom_period' AND period_days IS NOT NULL) OR
       (renewal_cadence IN ('weekly', 'monthly') AND period_days IS NULL))) OR
    (kind = 'session_pack' AND renewal_cadence IS NULL AND period_days IS NULL)
  ),
  CONSTRAINT plan_versions_timezone CHECK (char_length(timezone) BETWEEN 1 AND 80)
);

ALTER TABLE plans ADD CONSTRAINT plans_current_version_fk
  FOREIGN KEY (id, current_version) REFERENCES plan_versions(plan_id, version)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE plan_services ADD CONSTRAINT plan_services_version_fk
  FOREIGN KEY (plan_id, plan_version) REFERENCES plan_versions(plan_id, version) ON DELETE RESTRICT;

CREATE TABLE plan_rights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  plan_version integer NOT NULL,
  right_type text NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE RESTRICT,
  quota_scope text,
  quantity integer,
  period text,
  period_mode text,
  timezone text,
  valid_days integer,
  valid_days_start_rule text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_rights_version_fk FOREIGN KEY (plan_id, plan_version) REFERENCES plan_versions(plan_id, version) ON DELETE RESTRICT,
  CONSTRAINT plan_rights_type_allowed CHECK (right_type IN ('service_access', 'sessions_quota', 'period_quota')),
  CONSTRAINT plan_rights_scope_allowed CHECK (quota_scope IS NULL OR quota_scope IN ('shared', 'per_service')),
  CONSTRAINT plan_rights_quantity_range CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 100000),
  CONSTRAINT plan_rights_period_allowed CHECK (period IS NULL OR period IN ('week', 'month', 'plan_period')),
  CONSTRAINT plan_rights_period_mode_allowed CHECK (period_mode IS NULL OR period_mode IN ('calendar', 'rolling')),
  CONSTRAINT plan_rights_valid_days_range CHECK (valid_days IS NULL OR valid_days BETWEEN 1 AND 3660),
  CONSTRAINT plan_rights_valid_days_start_rule_allowed CHECK (valid_days_start_rule IS NULL OR valid_days_start_rule IN ('purchase', 'first_use')),
  CONSTRAINT plan_rights_type_fields CHECK (
    (right_type = 'service_access' AND quantity IS NULL AND quota_scope IS NULL AND period IS NULL AND period_mode IS NULL AND timezone IS NULL) OR
    (right_type = 'sessions_quota' AND quantity IS NOT NULL AND quota_scope IS NOT NULL AND period IS NULL AND period_mode IS NULL AND timezone IS NULL) OR
    (right_type = 'period_quota' AND quantity IS NOT NULL AND quota_scope IS NOT NULL AND
      ((period = 'plan_period' AND period_mode IS NULL AND timezone IS NULL) OR
       (period IN ('week', 'month') AND period_mode IN ('calendar', 'rolling') AND timezone IS NOT NULL AND char_length(timezone) BETWEEN 1 AND 80)))
  ),
  CONSTRAINT plan_rights_per_service_scope CHECK (quota_scope <> 'per_service' OR service_id IS NOT NULL),
  CONSTRAINT plan_rights_valid_days_rule CHECK ((valid_days IS NULL) = (valid_days_start_rule IS NULL))
);
CREATE UNIQUE INDEX plan_rights_global_unique ON plan_rights(plan_id, plan_version, right_type) WHERE service_id IS NULL;
CREATE UNIQUE INDEX plan_rights_service_unique ON plan_rights(plan_id, plan_version, right_type, service_id) WHERE service_id IS NOT NULL;
CREATE INDEX plan_rights_version_idx ON plan_rights(plan_id, plan_version);

CREATE FUNCTION set_updated_at_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER areas_updated_at BEFORE UPDATE ON areas FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
CREATE TRIGGER services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
CREATE FUNCTION reject_catalog_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'catalog definitions must be archived, not deleted' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER areas_archive_instead_delete BEFORE DELETE ON areas FOR EACH ROW EXECUTE FUNCTION reject_catalog_delete();
CREATE TRIGGER services_archive_instead_delete BEFORE DELETE ON services FOR EACH ROW EXECUTE FUNCTION reject_catalog_delete();

CREATE FUNCTION reject_immutable_plan_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'plan versions and their rights are immutable; create a new version' USING ERRCODE = '55000';
END;
$$;
CREATE FUNCTION reject_active_plan_definition_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_plan_id uuid;
DECLARE selected_version integer;
DECLARE current_version integer;
DECLARE selected_status text;
BEGIN
  selected_plan_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;
  IF TG_TABLE_NAME IN ('plan_rights','plan_services') THEN
    selected_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_version ELSE NEW.plan_version END;
  END IF;
  SELECT status,plans.current_version INTO selected_status,current_version FROM plans WHERE id = selected_plan_id;
  IF selected_status = 'active' AND (TG_TABLE_NAME NOT IN ('plan_rights','plan_services') OR selected_version <= current_version) THEN
    RAISE EXCEPTION 'active plan definitions are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION reject_versioned_row_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'versioned definitions are append-only; create a new version or archive the plan' USING ERRCODE = '55000';
END;
$$;
CREATE FUNCTION validate_plan_right_service_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_kind text;
BEGIN
  SELECT kind INTO plan_kind FROM plan_versions WHERE plan_id=NEW.plan_id AND version=NEW.plan_version;
  IF plan_kind = 'session_pack' AND NEW.right_type = 'period_quota' THEN
    RAISE EXCEPTION 'session packs cannot include periodic quotas' USING ERRCODE = '23514';
  END IF;
  IF NEW.service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM plan_services WHERE plan_id=NEW.plan_id AND plan_version=NEW.plan_version AND service_id=NEW.service_id
  ) THEN
    RAISE EXCEPTION 'a right can only target a service included in that plan version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION protect_plan_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'plans must be archived, not deleted' USING ERRCODE = '55000'; END IF;
  IF NEW.current_version < OLD.current_version THEN
    RAISE EXCEPTION 'plan versions cannot move backwards' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    RAISE EXCEPTION 'archived plans cannot be reactivated' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'active' AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.current_version < OLD.current_version OR
      NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
      (NEW.status NOT IN ('active', 'archived'))) THEN
    RAISE EXCEPTION 'active plan definitions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER plan_versions_immutable BEFORE UPDATE OR DELETE ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_plan_version_mutation();
CREATE TRIGGER plan_rights_active_immutable BEFORE UPDATE OR DELETE ON plan_rights
  FOR EACH ROW EXECUTE FUNCTION reject_active_plan_definition_mutation();
CREATE TRIGGER plan_rights_active_insert_guard BEFORE INSERT ON plan_rights
  FOR EACH ROW EXECUTE FUNCTION reject_active_plan_definition_mutation();
CREATE TRIGGER plan_rights_service_target_guard BEFORE INSERT OR UPDATE ON plan_rights
  FOR EACH ROW EXECUTE FUNCTION validate_plan_right_service_target();
CREATE TRIGGER plan_rights_append_only BEFORE UPDATE OR DELETE ON plan_rights
  FOR EACH ROW EXECUTE FUNCTION reject_versioned_row_mutation();
CREATE TRIGGER plan_services_active_immutable BEFORE INSERT OR UPDATE OR DELETE ON plan_services
  FOR EACH ROW EXECUTE FUNCTION reject_active_plan_definition_mutation();
CREATE TRIGGER plan_services_append_only BEFORE UPDATE OR DELETE ON plan_services
  FOR EACH ROW EXECUTE FUNCTION reject_versioned_row_mutation();
CREATE TRIGGER plans_identity_protection BEFORE UPDATE OR DELETE ON plans
  FOR EACH ROW EXECUTE FUNCTION protect_plan_identity();
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW
  EXECUTE FUNCTION set_updated_at_timestamp();

CREATE FUNCTION enforce_session_pack_quota() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_plan_id uuid;
DECLARE selected_version integer;
DECLARE selected_kind text;
BEGIN
  selected_plan_id := NEW.plan_id;
  IF TG_TABLE_NAME = 'plan_versions' THEN selected_version := NEW.version;
  ELSE selected_version := NEW.plan_version;
  END IF;
  SELECT kind INTO selected_kind FROM plan_versions WHERE plan_id=selected_plan_id AND version=selected_version;
  IF selected_kind = 'session_pack' AND NOT EXISTS (
    SELECT 1 FROM plan_rights WHERE plan_id=selected_plan_id AND plan_version=selected_version AND right_type='sessions_quota'
  ) THEN
    RAISE EXCEPTION 'session packs require a sessions quota right' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER plan_versions_session_pack_check AFTER INSERT ON plan_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_session_pack_quota();
CREATE CONSTRAINT TRIGGER plan_rights_session_pack_check AFTER INSERT ON plan_rights
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_session_pack_quota();
