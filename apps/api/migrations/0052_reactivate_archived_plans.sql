-- D172: retiring a quota prevents new assignments but remains reversible.
-- Reactivation keeps the same frozen commercial version and requires its dependencies to be usable.
CREATE OR REPLACE FUNCTION protect_plan_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'plans must be archived, not deleted' USING ERRCODE='55000'; END IF;
  IF NEW.status='archived' AND OLD.status<>'archived' THEN UPDATE plan_versions SET frozen_at=now() WHERE plan_id=OLD.id AND version=OLD.current_version AND frozen_at IS NULL; END IF;
  IF NEW.current_version<OLD.current_version THEN RAISE EXCEPTION 'plan versions cannot move backwards' USING ERRCODE='55000'; END IF;
  IF OLD.status='archived' AND (NEW.status NOT IN ('archived','active') OR NEW.current_version IS DISTINCT FROM OLD.current_version OR NEW.name IS DISTINCT FROM OLD.name) THEN RAISE EXCEPTION 'archived plan definitions are immutable' USING ERRCODE='55000'; END IF;
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
  IF OLD.status='archived' AND NEW.status='active' THEN
    IF NOT EXISTS (SELECT 1 FROM plan_versions WHERE plan_id=NEW.id AND version=NEW.current_version AND frozen_at IS NOT NULL) OR
      NOT EXISTS (SELECT 1 FROM plan_services WHERE plan_id=NEW.id AND plan_version=NEW.current_version) OR
      NOT EXISTS (SELECT 1 FROM plan_rights WHERE plan_id=NEW.id AND plan_version=NEW.current_version) THEN
      RAISE EXCEPTION 'reactivated plans require their frozen version, services and rights' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM plan_services ps JOIN services s ON s.id=ps.service_id JOIN areas a ON a.id=s.area_id WHERE ps.plan_id=NEW.id AND ps.plan_version=NEW.current_version AND (s.status<>'active' OR a.status<>'active')) THEN
      RAISE EXCEPTION 'reactivated plans require active services and areas' USING ERRCODE='23514';
    END IF;
  END IF;
  IF OLD.status='active' AND ((NEW.name IS DISTINCT FROM OLD.name AND NEW.current_version=OLD.current_version) OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.status NOT IN ('active','archived')) THEN
    RAISE EXCEPTION 'active plan identity is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
