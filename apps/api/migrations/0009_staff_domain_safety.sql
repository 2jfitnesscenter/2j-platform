CREATE FUNCTION staff_block_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'staff records use status transitions and cannot be deleted' USING ERRCODE='55000'; END;
$$;
CREATE FUNCTION staff_block_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'staff records cannot be truncated' USING ERRCODE='55000'; END;
$$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['staff_professionals','staff_schedule_slots','staff_exceptions','staff_substitutions'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION staff_block_hard_delete()', table_name||'_no_delete', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION staff_block_truncate()', table_name||'_no_truncate', table_name);
  END LOOP;
END $$;
ALTER TABLE staff_timeclock_corrections ADD COLUMN revision bigint;
ALTER TABLE staff_timeclock_corrections DISABLE TRIGGER staff_timeclock_corrections_immutable;
WITH ranked AS (
  SELECT id,row_number() OVER (PARTITION BY event_id ORDER BY created_at,id) AS revision
  FROM staff_timeclock_corrections
)
UPDATE staff_timeclock_corrections c SET revision=ranked.revision FROM ranked WHERE c.id=ranked.id;
ALTER TABLE staff_timeclock_corrections ENABLE TRIGGER staff_timeclock_corrections_immutable;
ALTER TABLE staff_timeclock_corrections ALTER COLUMN revision SET NOT NULL;
CREATE UNIQUE INDEX staff_timeclock_corrections_event_revision_unique ON staff_timeclock_corrections(event_id,revision);
