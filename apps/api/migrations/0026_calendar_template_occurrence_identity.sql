ALTER TABLE calendar_sessions ADD COLUMN template_occurrence_date date;

WITH ranked AS (
  SELECT id, template_id, (starts_at AT TIME ZONE 'Atlantic/Canary')::date AS occurrence_date,
    row_number() OVER (
      PARTITION BY template_id, (starts_at AT TIME ZONE 'Atlantic/Canary')::date
      ORDER BY created_at, id
    ) AS occurrence_rank
  FROM calendar_sessions
  WHERE template_id IS NOT NULL
)
UPDATE calendar_sessions AS session
SET template_occurrence_date = ranked.occurrence_date
FROM ranked
WHERE session.id = ranked.id AND ranked.occurrence_rank = 1;

ALTER TABLE calendar_sessions
  ADD CONSTRAINT calendar_sessions_template_occurrence_date_consistency
  CHECK (template_occurrence_date IS NULL OR template_id IS NOT NULL);

CREATE UNIQUE INDEX calendar_sessions_template_occurrence_date_unique
  ON calendar_sessions(template_id, template_occurrence_date)
  WHERE template_occurrence_date IS NOT NULL;
