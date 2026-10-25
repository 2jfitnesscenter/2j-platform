-- Stable, immutable per-plan-version Training access classification and
-- durable replay protection for signed internal service requests.
ALTER TABLE plan_rights ADD COLUMN training_access_level text;
ALTER TABLE plan_rights DROP CONSTRAINT plan_rights_type_allowed;
ALTER TABLE plan_rights ADD CONSTRAINT plan_rights_type_allowed
  CHECK (right_type IN ('service_access','sessions_quota','period_quota','training_access'));
ALTER TABLE plan_rights DROP CONSTRAINT plan_rights_type_fields;
ALTER TABLE plan_rights ADD CONSTRAINT plan_rights_type_fields CHECK (
  (right_type='service_access' AND training_access_level IS NULL AND quantity IS NULL AND quota_scope IS NULL AND period IS NULL AND period_mode IS NULL AND timezone IS NULL) OR
  (right_type='sessions_quota' AND training_access_level IS NULL AND quantity IS NOT NULL AND quota_scope IS NOT NULL AND period IS NULL AND period_mode IS NULL AND timezone IS NULL) OR
  (right_type='period_quota' AND training_access_level IS NULL AND quantity IS NOT NULL AND quota_scope IS NOT NULL AND
    ((period='plan_period' AND period_mode IS NULL AND timezone IS NULL) OR
     (period IN ('week','month') AND period_mode IN ('calendar','rolling') AND timezone IS NOT NULL AND char_length(timezone) BETWEEN 1 AND 80))) OR
  (right_type='training_access' AND service_id IS NULL AND training_access_level IN ('full','autonomous') AND quota_scope IS NULL AND quantity IS NULL AND weekly_frequency IS NULL AND period IS NULL AND period_mode IS NULL AND timezone IS NULL AND valid_days IS NULL AND valid_days_start_rule IS NULL)
);
CREATE UNIQUE INDEX plan_rights_training_access_unique
  ON plan_rights(plan_id,plan_version) WHERE right_type='training_access';

CREATE TABLE platform_service_request_replays (
  request_id uuid PRIMARY KEY,
  key_id text NOT NULL CONSTRAINT platform_service_request_replays_key_id CHECK (key_id ~ '^[A-Za-z0-9._-]{1,80}$'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT platform_service_request_replays_expiry CHECK (expires_at > received_at)
);
CREATE INDEX platform_service_request_replays_expiry_idx ON platform_service_request_replays(expires_at);
