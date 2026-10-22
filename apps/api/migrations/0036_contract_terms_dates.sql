-- F1-A: additive contract metadata and immutable contract-term facts.
ALTER TABLE plan_versions
  ADD COLUMN term_kind text,
  ADD COLUMN term_months integer,
  ADD COLUMN max_span_days integer,
  ADD COLUMN payment_rule text,
  ADD COLUMN payment_block text;

ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_term_kind_allowed
  CHECK (term_kind IS NULL OR term_kind IN ('natural_month','custom_range','rolling_months','pack','one_off'));
ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_term_months_range
  CHECK (term_months IS NULL OR term_months IN (3,6,12));
ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_max_span_days_range
  CHECK (max_span_days IS NULL OR max_span_days BETWEEN 1 AND 3660);
ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_payment_rule_allowed
  CHECK (payment_rule IS NULL OR payment_rule IN ('monthly_day10_v1','grace_from_assignment_v1','on_payment_v1'));
ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_payment_block_allowed
  CHECK (payment_block IS NULL OR payment_block IN ('enforce','off'));
ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_contract_metadata_coherent CHECK (
  COALESCE((term_kind IS NULL AND term_months IS NULL AND max_span_days IS NULL AND payment_rule IS NULL AND payment_block IS NULL)
  OR (term_kind='natural_month' AND kind='recurring' AND term_months IS NULL AND max_span_days IS NULL AND renewal_cadence IS NOT NULL AND renewal_cadence='monthly' AND payment_rule IS NOT NULL AND payment_rule='monthly_day10_v1' AND payment_block IS NOT NULL AND payment_block IN ('enforce','off'))
  OR (term_kind='custom_range' AND kind='recurring' AND term_months IS NULL AND payment_rule IS NOT NULL AND payment_rule='grace_from_assignment_v1' AND payment_block IS NOT NULL AND payment_block IN ('enforce','off'))
  OR (term_kind='rolling_months' AND kind='recurring' AND term_months IS NOT NULL AND term_months IN (3,6,12) AND max_span_days IS NULL AND payment_rule IS NOT NULL AND payment_rule='grace_from_assignment_v1' AND payment_block IS NOT NULL AND payment_block IN ('enforce','off'))
  OR (term_kind='pack' AND kind='session_pack' AND term_months IS NULL AND max_span_days IS NULL AND payment_rule IS NOT NULL AND payment_rule='on_payment_v1' AND payment_block IS NOT NULL AND payment_block='off')
  OR (term_kind='one_off' AND kind='session_pack' AND term_months IS NULL AND max_span_days IS NULL AND payment_rule IS NOT NULL AND payment_rule='on_payment_v1' AND payment_block IS NOT NULL AND payment_block='off'), FALSE)
);

CREATE FUNCTION contract_end_v1(start_date date, term_months integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  target_index integer;
  target_year integer;
  target_month integer;
  target_last_day integer;
  start_last_day integer;
  anniversary_day integer;
BEGIN
  IF term_months NOT IN (3,6,12) THEN
    RAISE EXCEPTION 'unsupported contract term length' USING ERRCODE='22023';
  END IF;
  target_index := EXTRACT(YEAR FROM start_date)::integer * 12 + EXTRACT(MONTH FROM start_date)::integer - 1 + term_months;
  target_year := target_index / 12;
  IF target_year < 1 OR target_year > 9999 THEN
    RAISE EXCEPTION 'calculated contract end exceeds supported YYYY date range' USING ERRCODE='22008';
  END IF;
  target_month := target_index % 12 + 1;
  target_last_day := CASE
    WHEN target_month IN (4,6,9,11) THEN 30
    WHEN target_month = 2 THEN CASE WHEN target_year % 400 = 0 OR (target_year % 4 = 0 AND target_year % 100 <> 0) THEN 29 ELSE 28 END
    ELSE 31
  END;
  start_last_day := CASE
    WHEN EXTRACT(MONTH FROM start_date)::integer IN (4,6,9,11) THEN 30
    WHEN EXTRACT(MONTH FROM start_date)::integer = 2 THEN CASE WHEN EXTRACT(YEAR FROM start_date)::integer % 400 = 0 OR (EXTRACT(YEAR FROM start_date)::integer % 4 = 0 AND EXTRACT(YEAR FROM start_date)::integer % 100 <> 0) THEN 29 ELSE 28 END
    ELSE 31
  END;
  IF EXTRACT(DAY FROM start_date)::integer = start_last_day THEN
    RETURN make_date(target_year,target_month,target_last_day);
  END IF;
  anniversary_day := LEAST(EXTRACT(DAY FROM start_date)::integer,target_last_day);
  RETURN make_date(target_year,target_month,anniversary_day) - 1;
END;
$$;

CREATE TABLE assignment_contract_terms (
  assignment_id uuid CONSTRAINT assignment_contract_terms_assignment_id_pk PRIMARY KEY,
  term_kind text NOT NULL CONSTRAINT assignment_contract_terms_kind CHECK (term_kind IN ('natural_month','custom_range','rolling_months','pack','one_off')),
  contract_start date,
  contract_end date,
  term_months integer,
  payment_rule text NOT NULL CONSTRAINT assignment_contract_terms_payment_rule CHECK (payment_rule IN ('monthly_day10_v1','grace_from_assignment_v1','on_payment_v1')),
  payment_block text NOT NULL CONSTRAINT assignment_contract_terms_payment_block CHECK (payment_block IN ('enforce','off')),
  deadline_computation jsonb NOT NULL,
  assigned_local_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_contract_terms_deadline_object CHECK (
    jsonb_typeof(deadline_computation)='object'
    AND deadline_computation ?& ARRAY['rule','assignedLocalDate','dueOn']
    AND deadline_computation->>'rule'=payment_rule
    AND jsonb_typeof(deadline_computation->'inputs')='object'
    AND deadline_computation->>'assignedLocalDate' ~ '^\d{4}-\d{2}-\d{2}$'
    AND deadline_computation->>'dueOn' ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  CONSTRAINT assignment_contract_terms_months_range CHECK (term_months IS NULL OR term_months IN (3,6,12)),
  CONSTRAINT assignment_contract_terms_dates_coherent CHECK (
    COALESCE((term_kind='natural_month' AND contract_start IS NOT NULL AND contract_end IS NOT NULL AND term_months IS NULL
      AND EXTRACT(DAY FROM contract_start)=1 AND EXTRACT(YEAR FROM contract_start)=EXTRACT(YEAR FROM contract_end)
      AND EXTRACT(MONTH FROM contract_start)=EXTRACT(MONTH FROM contract_end)
      AND EXTRACT(DAY FROM contract_end)=CASE WHEN EXTRACT(MONTH FROM contract_end) IN (4,6,9,11) THEN 30
        WHEN EXTRACT(MONTH FROM contract_end)=2 THEN CASE WHEN EXTRACT(YEAR FROM contract_end)::integer % 400=0 OR (EXTRACT(YEAR FROM contract_end)::integer % 4=0 AND EXTRACT(YEAR FROM contract_end)::integer % 100<>0) THEN 29 ELSE 28 END
        ELSE 31 END AND contract_start>=assigned_local_date AND payment_rule IS NOT NULL AND payment_rule='monthly_day10_v1')
    OR (term_kind='custom_range' AND contract_start IS NOT NULL AND contract_end IS NOT NULL AND term_months IS NULL
      AND contract_end>=contract_start AND contract_start>=assigned_local_date AND payment_rule IS NOT NULL AND payment_rule='grace_from_assignment_v1')
    OR (term_kind='rolling_months' AND contract_start IS NOT NULL AND contract_end IS NOT NULL AND term_months IS NOT NULL AND term_months IN (3,6,12)
      AND contract_start>=assigned_local_date AND contract_end=contract_end_v1(contract_start,term_months) AND payment_rule IS NOT NULL AND payment_rule='grace_from_assignment_v1')
    OR (term_kind='pack' AND contract_start IS NULL AND contract_end IS NULL AND term_months IS NULL AND payment_rule IS NOT NULL AND payment_rule='on_payment_v1' AND payment_block='off')
    OR (term_kind='one_off' AND contract_start IS NULL AND contract_end IS NULL AND term_months IS NULL AND payment_rule IS NOT NULL AND payment_rule='on_payment_v1' AND payment_block='off'), FALSE)
  ),
  CONSTRAINT assignment_contract_terms_deadline_assignment CHECK (deadline_computation->>'assignedLocalDate'=assigned_local_date::text)
);
ALTER TABLE assignment_contract_terms ADD CONSTRAINT assignment_contract_terms_assignment_fk
  FOREIGN KEY (assignment_id) REFERENCES client_plan_assignments(id) ON DELETE RESTRICT;
CREATE INDEX assignment_contract_terms_kind_idx ON assignment_contract_terms(term_kind,assigned_local_date,assignment_id);

CREATE FUNCTION validate_assignment_contract_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  assignment_row record;
  plan_row record;
BEGIN
  SELECT a.starts_on,a.ends_on,a.charge_id,a.plan_id,a.plan_version,c.due_on
    INTO assignment_row
    FROM client_plan_assignments a JOIN economic_charges c ON c.id=a.charge_id
    WHERE a.id=NEW.assignment_id FOR SHARE OF a,c;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment contract reference is unavailable' USING ERRCODE='23503'; END IF;
  SELECT term_kind,term_months,max_span_days,payment_rule,payment_block,frozen_at
    INTO plan_row FROM plan_versions WHERE plan_id=assignment_row.plan_id AND version=assignment_row.plan_version;
  IF NOT FOUND OR plan_row.frozen_at IS NULL OR plan_row.term_kind IS DISTINCT FROM NEW.term_kind OR plan_row.term_months IS DISTINCT FROM NEW.term_months
    OR plan_row.payment_rule IS DISTINCT FROM NEW.payment_rule OR plan_row.payment_block IS DISTINCT FROM NEW.payment_block THEN
    RAISE EXCEPTION 'assignment contract terms must snapshot the referenced plan version' USING ERRCODE='23514';
  END IF;
  IF NEW.term_kind IN ('natural_month','custom_range','rolling_months')
    AND (assignment_row.starts_on IS DISTINCT FROM NEW.contract_start OR assignment_row.ends_on IS DISTINCT FROM NEW.contract_end) THEN
    RAISE EXCEPTION 'assignment dates must match its contract terms' USING ERRCODE='23514';
  END IF;
  IF NEW.term_kind='custom_range' AND plan_row.max_span_days IS NOT NULL
    AND NEW.contract_end-NEW.contract_start+1 > plan_row.max_span_days THEN
    RAISE EXCEPTION 'custom contract range exceeds plan maximum span' USING ERRCODE='23514';
  END IF;
  IF NEW.deadline_computation->>'dueOn' IS DISTINCT FROM assignment_row.due_on::text THEN
    RAISE EXCEPTION 'deadline snapshot must match the assignment charge due date' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_contract_terms_validate BEFORE INSERT ON assignment_contract_terms
  FOR EACH ROW EXECUTE FUNCTION validate_assignment_contract_terms();

CREATE FUNCTION reject_assignment_contract_terms_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'assignment contract terms are immutable historical facts' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER assignment_contract_terms_immutable BEFORE UPDATE OR DELETE ON assignment_contract_terms
  FOR EACH ROW EXECUTE FUNCTION reject_assignment_contract_terms_mutation();
CREATE TRIGGER assignment_contract_terms_no_truncate BEFORE TRUNCATE ON assignment_contract_terms
  FOR EACH STATEMENT EXECUTE FUNCTION reject_assignment_contract_terms_mutation();
