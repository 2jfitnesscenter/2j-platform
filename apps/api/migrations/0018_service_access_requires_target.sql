-- New direct-access rights must name one service. Existing legacy rows are
-- retained for audit/history, but are filtered from effective access and
-- cannot be assigned or activated into a new version.
ALTER TABLE plan_rights
  ADD CONSTRAINT plan_rights_service_access_requires_service
  CHECK (right_type <> 'service_access' OR service_id IS NOT NULL) NOT VALID;

CREATE FUNCTION guard_service_access_target_before_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active'
     AND (OLD.status IS DISTINCT FROM 'active' OR NEW.current_version IS DISTINCT FROM OLD.current_version)
     AND EXISTS (
       SELECT 1 FROM plan_rights
       WHERE plan_id = NEW.id
         AND plan_version = NEW.current_version
         AND right_type = 'service_access'
         AND service_id IS NULL
     ) THEN
    RAISE EXCEPTION 'service access requires a service target' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER plans_service_access_target_guard
  BEFORE UPDATE OF status, current_version ON plans
  FOR EACH ROW EXECUTE FUNCTION guard_service_access_target_before_activation();
