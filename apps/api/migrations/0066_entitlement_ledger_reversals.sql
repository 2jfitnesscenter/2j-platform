ALTER TABLE client_entitlement_ledger
  DROP CONSTRAINT client_entitlement_ledger_entry_type,
  ADD CONSTRAINT client_entitlement_ledger_entry_type
    CHECK (entry_type IN ('grant','consume','restore','adjustment','expire','reversal')),
  DROP CONSTRAINT client_entitlement_ledger_quantity,
  ADD CONSTRAINT client_entitlement_ledger_quantity CHECK (quantity <> 0 AND quantity BETWEEN -100000 AND 100000
    AND ((entry_type IN ('grant','restore') AND quantity>0) OR (entry_type IN ('consume','expire') AND quantity<0)
      OR entry_type IN ('adjustment','reversal'))),
  ADD COLUMN reversal_of_id uuid;

ALTER TABLE client_entitlement_ledger
  ADD CONSTRAINT client_entitlement_ledger_assignment_client_id_unique
    UNIQUE (id, assignment_id, client_id),
  ADD CONSTRAINT client_entitlement_ledger_reversal_fk
    FOREIGN KEY (reversal_of_id, assignment_id, client_id)
    REFERENCES client_entitlement_ledger(id, assignment_id, client_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT client_entitlement_ledger_reversal_type
    CHECK ((entry_type = 'reversal' AND reversal_of_id IS NOT NULL AND reversal_of_id <> id)
      OR (entry_type <> 'reversal' AND reversal_of_id IS NULL));

CREATE UNIQUE INDEX client_entitlement_ledger_reversal_once
  ON client_entitlement_ledger(reversal_of_id)
  WHERE reversal_of_id IS NOT NULL;

CREATE FUNCTION client_entitlement_ledger_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original client_entitlement_ledger%ROWTYPE;
BEGIN
  IF NEW.reversal_of_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO original FROM client_entitlement_ledger WHERE id=NEW.reversal_of_id;
  IF original.id IS NULL OR original.entry_type <> 'adjustment'
    OR original.right_key <> NEW.right_key
    OR original.entitlement_period_id IS DISTINCT FROM NEW.entitlement_period_id
    OR original.quantity <> -NEW.quantity THEN
    RAISE EXCEPTION 'entitlement reversal must exactly reverse a manual adjustment' USING ERRCODE='23514', CONSTRAINT='client_entitlement_ledger_reversal_matches_original';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER client_entitlement_ledger_reversal_guard
  BEFORE INSERT ON client_entitlement_ledger
  FOR EACH ROW EXECUTE FUNCTION client_entitlement_ledger_reversal_guard();

CREATE OR REPLACE FUNCTION validate_plan_quantity_rule_set(target_plan_id uuid, target_version integer) RETURNS void LANGUAGE plpgsql AS $$
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
      OR EXISTS (SELECT 1 FROM plan_rights WHERE plan_id=target_plan_id AND plan_version=target_version AND right_type='sessions_quota'
        AND (quantity_rule IS DISTINCT FROM 'fixed_v1' OR (plan_row.term_kind='one_off' AND quantity IS DISTINCT FROM 1))) THEN
      RAISE EXCEPTION 'term-enabled pack plans require fixed session quantity rights and one_off grants exactly one session' USING ERRCODE='23514', CONSTRAINT='plan_rights_quantity_rule_term_compatibility';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION assignment_entitlement_period_has_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_period_id uuid;
DECLARE period_row record;
BEGIN
  IF TG_TABLE_NAME='assignment_entitlement_periods' THEN target_period_id:=NEW.id;
  ELSE target_period_id:=NEW.period_id; END IF;
  SELECT id,right_id,entitlement_mode,formula_id,sessions_granted INTO period_row
    FROM assignment_entitlement_periods WHERE id=target_period_id;
  IF period_row.entitlement_mode='quota' AND NOT EXISTS (
    SELECT 1 FROM client_entitlement_ledger l WHERE l.entitlement_period_id=period_row.id
      AND l.right_key=period_row.right_id::text AND l.entry_type='grant' AND l.quantity=period_row.sessions_granted
  ) AND NOT (
    period_row.formula_id='fixed_v1'
    AND EXISTS(SELECT 1 FROM assignment_entitlement_period_events e WHERE e.period_id=period_row.id AND e.event_type='charge_linked')
    AND NOT EXISTS(SELECT 1 FROM assignment_entitlement_period_events e WHERE e.period_id=period_row.id AND e.event_type='payment_validated')
  ) THEN
    RAISE EXCEPTION 'quota entitlement period requires its frozen bag grant after payment activation' USING ERRCODE='23514', CONSTRAINT='assignment_entitlement_periods_grant_required';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER assignment_entitlement_periods_payment_grant_required
  AFTER INSERT ON assignment_entitlement_period_events DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assignment_entitlement_period_has_grant_guard();
