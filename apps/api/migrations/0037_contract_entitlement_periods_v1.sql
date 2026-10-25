-- F1-B extends the 098E period/ledger foundation without rewriting legacy rows.

ALTER TABLE plan_rights ADD COLUMN quantity_rule text;
ALTER TABLE plan_rights ADD CONSTRAINT plan_rights_quantity_rule_allowed
  CHECK (quantity_rule IS NULL OR quantity_rule IN ('weekday_ratio_v1','fixed_v1','unlimited'));
ALTER TABLE plan_rights DROP CONSTRAINT plan_rights_type_fields;
ALTER TABLE plan_rights ADD CONSTRAINT plan_rights_type_fields CHECK (
  (right_type='service_access' AND training_access_level IS NULL AND quantity IS NULL AND quota_scope IS NULL AND quantity_rule IS NULL AND period IS NULL AND period_mode IS NULL AND timezone IS NULL)
  OR (right_type='sessions_quota' AND training_access_level IS NULL AND quota_scope IS NOT NULL AND period IS NULL AND period_mode IS NULL AND timezone IS NULL AND (
    (quantity_rule IS NULL AND quantity IS NOT NULL)
    OR (quantity_rule='weekday_ratio_v1' AND quantity IS NULL AND weekly_frequency BETWEEN 1 AND 5)
    OR (quantity_rule='fixed_v1' AND quantity BETWEEN 1 AND 100000 AND weekly_frequency IS NULL)
    OR (quantity_rule='unlimited' AND quantity IS NULL AND weekly_frequency IS NULL)
  ))
  OR (right_type='period_quota' AND training_access_level IS NULL AND quantity IS NOT NULL AND quota_scope IS NOT NULL AND quantity_rule IS NULL AND
    ((period='plan_period' AND period_mode IS NULL AND timezone IS NULL) OR
    (period IN ('week','month') AND period_mode IN ('calendar','rolling') AND timezone IS NOT NULL AND char_length(timezone) BETWEEN 1 AND 80)))
  OR (right_type='training_access' AND service_id IS NULL AND training_access_level IN ('full','autonomous') AND quota_scope IS NULL AND quantity IS NULL AND quantity_rule IS NULL AND weekly_frequency IS NULL AND period IS NULL AND period_mode IS NULL AND timezone IS NULL AND valid_days IS NULL AND valid_days_start_rule IS NULL)
);

CREATE FUNCTION validate_plan_quantity_rule_set(target_plan_id uuid, target_version integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE plan_row record;
BEGIN
  SELECT term_kind,kind INTO plan_row FROM plan_versions WHERE plan_id=target_plan_id AND version=target_version;
  IF NOT FOUND THEN RETURN; END IF;
  IF plan_row.term_kind IS NULL THEN
    IF EXISTS (SELECT 1 FROM plan_rights WHERE plan_id=target_plan_id AND plan_version=target_version AND quantity_rule IS NOT NULL) THEN
      RAISE EXCEPTION 'quantity rules require a term-enabled plan version' USING ERRCODE='23514', CONSTRAINT='plan_rights_quantity_rule_term_compatibility';
    END IF;
    RETURN;
  END IF;
  IF plan_row.term_kind IN ('natural_month','custom_range','rolling_months') THEN
    IF NOT EXISTS (SELECT 1 FROM plan_rights WHERE plan_id=target_plan_id AND plan_version=target_version AND right_type='sessions_quota')
      OR EXISTS (SELECT 1 FROM plan_rights WHERE plan_id=target_plan_id AND plan_version=target_version AND right_type='sessions_quota' AND (quantity_rule IS NULL OR quantity_rule NOT IN ('weekday_ratio_v1','unlimited'))) THEN
      RAISE EXCEPTION 'term-enabled recurring plans require an explicit supported session quantity rule' USING ERRCODE='23514', CONSTRAINT='plan_rights_quantity_rule_term_compatibility';
    END IF;
  ELSIF plan_row.term_kind IN ('pack','one_off') THEN
    IF plan_row.kind<>'session_pack'
      OR NOT EXISTS (SELECT 1 FROM plan_rights WHERE plan_id=target_plan_id AND plan_version=target_version AND right_type='sessions_quota')
      OR EXISTS (SELECT 1 FROM plan_rights WHERE plan_id=target_plan_id AND plan_version=target_version AND right_type='sessions_quota' AND quantity_rule IS DISTINCT FROM 'fixed_v1') THEN
      RAISE EXCEPTION 'term-enabled pack plans require fixed session quantity rights' USING ERRCODE='23514', CONSTRAINT='plan_rights_quantity_rule_term_compatibility';
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION check_plan_quantity_rule_set_from_right() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM validate_plan_quantity_rule_set(OLD.plan_id,OLD.plan_version);
  ELSE
    PERFORM validate_plan_quantity_rule_set(NEW.plan_id,NEW.plan_version);
    IF TG_OP='UPDATE' AND (OLD.plan_id,OLD.plan_version) IS DISTINCT FROM (NEW.plan_id,NEW.plan_version) THEN
      PERFORM validate_plan_quantity_rule_set(OLD.plan_id,OLD.plan_version);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER plan_rights_quantity_rule_set_guard
  AFTER INSERT OR UPDATE OR DELETE ON plan_rights DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_plan_quantity_rule_set_from_right();

CREATE FUNCTION check_plan_quantity_rule_set_from_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM validate_plan_quantity_rule_set(NEW.plan_id,NEW.version);
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER plan_versions_quantity_rule_set_guard
  AFTER INSERT OR UPDATE ON plan_versions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_plan_quantity_rule_set_from_version();

ALTER TABLE assignment_entitlement_periods ALTER COLUMN period_end DROP NOT NULL;
ALTER TABLE assignment_entitlement_periods ALTER COLUMN weekly_frequency DROP NOT NULL;
ALTER TABLE assignment_entitlement_periods ALTER COLUMN sessions_snapshot DROP NOT NULL;
ALTER TABLE assignment_entitlement_periods ADD COLUMN period_index smallint;
ALTER TABLE assignment_entitlement_periods ADD COLUMN entitlement_mode text;
ALTER TABLE assignment_entitlement_periods ADD COLUMN formula_id text;
ALTER TABLE assignment_entitlement_periods ADD COLUMN weekdays_in_period integer;
ALTER TABLE assignment_entitlement_periods ADD COLUMN sessions_granted integer;
ALTER TABLE assignment_entitlement_periods DROP CONSTRAINT assignment_entitlement_periods_dates;
ALTER TABLE assignment_entitlement_periods DROP CONSTRAINT assignment_entitlement_periods_bag_formula;
ALTER TABLE assignment_entitlement_periods ADD CONSTRAINT assignment_entitlement_periods_model CHECK (COALESCE(
  (entitlement_mode IS NULL AND period_index IS NULL AND formula_id IS NULL AND weekdays_in_period IS NULL AND sessions_granted IS NULL
    AND period_end IS NOT NULL AND period_end>=period_start AND weekly_frequency BETWEEN 1 AND 5 AND sessions_snapshot BETWEEN 0 AND 100000
    AND sessions_snapshot=entitlement_sessions_v1(entitlement_weekdays(period_start,period_end),weekly_frequency))
  OR (entitlement_mode='quota' AND period_index BETWEEN 0 AND 32767 AND formula_id='weekday_ratio_v1'
    AND period_end IS NOT NULL AND period_end>=period_start AND weekdays_in_period=entitlement_weekdays(period_start,period_end)
    AND weekly_frequency BETWEEN 1 AND 5 AND sessions_granted BETWEEN 1 AND 100000
    AND sessions_granted=entitlement_sessions_v1(weekdays_in_period,weekly_frequency) AND sessions_snapshot IS NULL)
  OR (entitlement_mode='quota' AND period_index BETWEEN 0 AND 32767 AND formula_id='fixed_v1'
    AND (period_end IS NULL OR period_end>=period_start) AND weekdays_in_period IS NULL AND weekly_frequency IS NULL
    AND sessions_granted BETWEEN 1 AND 100000 AND sessions_snapshot IS NULL)
  OR (entitlement_mode='unlimited' AND period_index BETWEEN 0 AND 32767 AND formula_id IS NULL
    AND period_end IS NOT NULL AND period_end>=period_start AND weekdays_in_period IS NULL AND weekly_frequency IS NULL
    AND sessions_granted IS NULL AND sessions_snapshot IS NULL), FALSE));
CREATE UNIQUE INDEX assignment_entitlement_periods_assignment_right_index_unique
  ON assignment_entitlement_periods(assignment_id,right_id,period_index) WHERE period_index IS NOT NULL;

CREATE UNIQUE INDEX client_entitlement_ledger_period_grant_unique
  ON client_entitlement_ledger(entitlement_period_id,right_key)
  WHERE entitlement_period_id IS NOT NULL AND entry_type='grant';

CREATE OR REPLACE FUNCTION assignment_entitlement_periods_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_row record;
DECLARE right_row record;
DECLARE terms_row record;
DECLARE prior_hash char(64);
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'entitlement period facts are immutable' USING ERRCODE='55000';
  END IF;
  SELECT plan_id,plan_version INTO assignment_row FROM client_plan_assignments
    WHERE id=NEW.assignment_id AND client_id=NEW.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'entitlement period assignment is unavailable' USING ERRCODE='23503'; END IF;
  SELECT quantity_rule,weekly_frequency,quantity INTO right_row FROM plan_rights
    WHERE id=NEW.right_id AND plan_id=assignment_row.plan_id AND plan_version=assignment_row.plan_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'entitlement period right does not belong to assignment plan version' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_right_assignment_match'; END IF;
  IF NEW.entitlement_mode IS NOT NULL THEN
    SELECT term_kind,contract_start,contract_end INTO terms_row FROM assignment_contract_terms WHERE assignment_id=NEW.assignment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'term-enabled periods require immutable contract terms' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_contract_terms_required'; END IF;
    IF NEW.formula_id='weekday_ratio_v1' AND (right_row.quantity_rule IS DISTINCT FROM 'weekday_ratio_v1' OR NEW.weekly_frequency IS DISTINCT FROM right_row.weekly_frequency
      OR terms_row.term_kind NOT IN ('natural_month','custom_range','rolling_months') OR NEW.period_start<terms_row.contract_start OR NEW.period_end>terms_row.contract_end
      OR NEW.period_index<>((EXTRACT(YEAR FROM NEW.period_start)-EXTRACT(YEAR FROM terms_row.contract_start))*12+(EXTRACT(MONTH FROM NEW.period_start)-EXTRACT(MONTH FROM terms_row.contract_start)))
      OR NEW.period_start IS DISTINCT FROM CASE WHEN NEW.period_index=0 THEN terms_row.contract_start ELSE date_trunc('month',NEW.period_start)::date END
      OR NEW.period_end IS DISTINCT FROM LEAST((date_trunc('month',NEW.period_start)::date+INTERVAL '1 month - 1 day')::date,terms_row.contract_end)) THEN
      RAISE EXCEPTION 'weekday-ratio period is inconsistent with contract terms' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_contract_terms_match';
    END IF;
    IF NEW.entitlement_mode='unlimited' AND (right_row.quantity_rule IS DISTINCT FROM 'unlimited' OR terms_row.term_kind NOT IN ('natural_month','custom_range','rolling_months') OR NEW.period_start IS DISTINCT FROM terms_row.contract_start OR NEW.period_end IS DISTINCT FROM terms_row.contract_end) THEN
      RAISE EXCEPTION 'unlimited period must cover its full contract once' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_contract_terms_match';
    END IF;
    IF NEW.formula_id='fixed_v1' AND (right_row.quantity_rule IS DISTINCT FROM 'fixed_v1' OR NEW.sessions_granted IS DISTINCT FROM right_row.quantity OR terms_row.term_kind NOT IN ('pack','one_off')) THEN
      RAISE EXCEPTION 'fixed period requires a pack or one-off fixed right' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_contract_terms_match';
    END IF;
  END IF;
  SELECT request_hash INTO prior_hash FROM assignment_entitlement_periods WHERE idempotency_key=NEW.idempotency_key;
  IF FOUND THEN
    IF prior_hash=NEW.request_hash THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'entitlement period idempotency key was reused with different facts' USING ERRCODE='23505', CONSTRAINT='assignment_entitlement_periods_idempotency_key_key';
  END IF;
  IF EXISTS (
    SELECT 1 FROM assignment_entitlement_periods p
    WHERE p.assignment_id=NEW.assignment_id AND p.right_id=NEW.right_id
      AND daterange(p.period_start,p.period_end,'[]') && daterange(NEW.period_start,NEW.period_end,'[]')
  ) THEN
    RAISE EXCEPTION 'entitlement periods cannot overlap' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_no_overlap';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION client_entitlement_ledger_period_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE period_row record;
BEGIN
  IF NEW.entry_type<>'grant' OR NEW.entitlement_period_id IS NULL THEN RETURN NEW; END IF;
  SELECT entitlement_mode,sessions_granted,right_id INTO period_row FROM assignment_entitlement_periods WHERE id=NEW.entitlement_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'period grant references an unavailable entitlement period' USING ERRCODE='23514', CONSTRAINT='client_entitlement_ledger_period_grant_matches_bag';
  END IF;
  -- Rows created by the original 0033 period engine have NULL entitlement_mode.
  -- Preserve their existing payment-activation grants; the frozen bag invariant
  -- applies only to the new F1-B quota materialization model.
  IF period_row.entitlement_mode IS NULL THEN RETURN NEW; END IF;
  IF period_row.entitlement_mode<>'quota' OR NEW.right_key<>period_row.right_id::text OR NEW.quantity IS DISTINCT FROM period_row.sessions_granted THEN
    RAISE EXCEPTION 'period grant must equal its frozen quota bag' USING ERRCODE='23514', CONSTRAINT='client_entitlement_ledger_period_grant_matches_bag';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_entitlement_ledger_period_grant_guard
  BEFORE INSERT ON client_entitlement_ledger FOR EACH ROW EXECUTE FUNCTION client_entitlement_ledger_period_grant_guard();

CREATE FUNCTION assignment_entitlement_period_has_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entitlement_mode='quota' AND NOT EXISTS (
    SELECT 1 FROM client_entitlement_ledger l WHERE l.entitlement_period_id=NEW.id AND l.right_key=NEW.right_id::text AND l.entry_type='grant' AND l.quantity=NEW.sessions_granted
  ) THEN
    RAISE EXCEPTION 'quota entitlement period requires its frozen bag grant' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_grant_required';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER assignment_entitlement_periods_grant_required
  AFTER INSERT ON assignment_entitlement_periods DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assignment_entitlement_period_has_grant_guard();

CREATE FUNCTION assignment_entitlement_periods_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'entitlement period facts are immutable' USING ERRCODE='55000'; END $$;
CREATE TRIGGER assignment_entitlement_periods_no_truncate
  BEFORE TRUNCATE ON assignment_entitlement_periods FOR EACH STATEMENT
  EXECUTE FUNCTION assignment_entitlement_periods_no_truncate();
