-- Persist the approved natural-day payment grace used by term contracts.
ALTER TABLE economic_settings
  ADD COLUMN grace_days smallint NOT NULL DEFAULT 5
  CONSTRAINT economic_settings_grace_days CHECK (grace_days BETWEEN 1 AND 60);
