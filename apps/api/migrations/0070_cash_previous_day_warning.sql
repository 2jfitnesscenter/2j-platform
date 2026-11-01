-- A76: previous-day registers are warnings, not a global barrier.
CREATE OR REPLACE FUNCTION economic_require_current_open_cash_session(target_session uuid, target_actor text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target_date date; target_status text; target_register uuid; custodian_actor text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('2j-economic-register-operations'));
  IF EXISTS (SELECT 1 FROM economic_cash_sessions WHERE status='open' AND register_id IS NULL) THEN
    RAISE EXCEPTION 'unassigned legacy cash session requires owner resolution' USING ERRCODE='23514', CONSTRAINT='economic_legacy_cash_session_requires_resolution';
  END IF;
  SELECT local_date,status,register_id INTO target_date,target_status,target_register
    FROM economic_cash_sessions WHERE id=target_session FOR UPDATE;
  IF NOT FOUND OR target_status<>'open' OR target_date<>(now() AT TIME ZONE 'Atlantic/Canary')::date OR target_register IS NULL THEN
    RAISE EXCEPTION 'cash movement requires current-day open register session' USING ERRCODE='23514', CONSTRAINT='economic_current_cash_session_required';
  END IF;
  IF target_actor IS NOT NULL THEN
    SELECT actor_id INTO custodian_actor FROM economic_cash_custodies
      WHERE cash_session_id=target_session AND ended_at IS NULL FOR UPDATE;
    IF custodian_actor IS DISTINCT FROM target_actor THEN
      RAISE EXCEPTION 'cash movement actor is not current register custodian' USING ERRCODE='23514', CONSTRAINT='economic_cash_custodian_required';
    END IF;
  END IF;
END $$;

DROP TRIGGER IF EXISTS staff_timeclock_cash_custody_guard ON staff_timeclock_events;
DROP FUNCTION IF EXISTS staff_timeclock_cash_custody_guard();
