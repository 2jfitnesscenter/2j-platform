-- Web Push infrastructure (decisions D152, D176, D199, D209, D211, D248, D255; defaults E14). Additive; off unless PUSH_ENABLED=true.
-- Numbered 0044 on purpose: 0039-0043 are taken by the open SSO stack (#64-#67), so this migration cannot collide with it.

-- Consent is an append-only history: the latest event is the current state.
CREATE TABLE platform_push_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('granted','revoked')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_push_consent_person_idx ON platform_push_consent_events(person_id, occurred_at DESC, id DESC);

-- One row per browser/device endpoint. The endpoint is a capability (whoever holds it can push to that device), so it is unique and moves to the
-- person who authenticated last when a shared device switches accounts.
CREATE TABLE platform_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  endpoint text NOT NULL CHECK (char_length(endpoint) BETWEEN 20 AND 2048 AND endpoint ~ '^https://'),
  endpoint_hash char(64) NOT NULL UNIQUE CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),
  p256dh text NOT NULL CHECK (char_length(p256dh) BETWEEN 20 AND 200),
  auth text NOT NULL CHECK (char_length(auth) BETWEEN 8 AND 100),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','invalid')),
  invalidated_reason text CHECK (invalidated_reason IS NULL OR char_length(invalidated_reason) <= 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz
);
CREATE INDEX platform_push_subscriptions_person_idx ON platform_push_subscriptions(person_id) WHERE status='active';

-- What Platform modules ask for. `dedupe_key` makes enqueueing idempotent per person (a retried business transaction cannot push twice).
-- The text is shown on a lock screen: it never carries health data, amounts owed or other sensitive content (checked by the application).
CREATE TABLE platform_push_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.-]{2,59}$'),
  category text NOT NULL CHECK (category IN ('essential','regular')),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  url text CHECK (url IS NULL OR (url ~ '^/[^/\\]' AND char_length(url) <= 300)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped_no_consent','skipped_no_subscription','expired')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT platform_push_intent_unique UNIQUE (person_id, dedupe_key),
  CONSTRAINT platform_push_intent_finished_check CHECK ((status='pending') = (finished_at IS NULL))
);
CREATE INDEX platform_push_intents_due_idx ON platform_push_intents(next_attempt_at, created_at) WHERE status='pending';

-- Every attempt is logged (E14: "se registra el intento"), including ones that discard a dead token.
CREATE TABLE platform_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES platform_push_intents(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES platform_push_subscriptions(id) ON DELETE RESTRICT,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 10),
  status text NOT NULL CHECK (status IN ('sent','retry','failed','gone')),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 40),
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_push_deliveries_intent_idx ON platform_push_deliveries(intent_id, attempted_at);

-- History tables are never edited or deleted.
CREATE FUNCTION platform_push_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000'; END $$;
CREATE TRIGGER platform_push_consent_append_only BEFORE UPDATE OR DELETE ON platform_push_consent_events FOR EACH ROW EXECUTE FUNCTION platform_push_append_only();
CREATE TRIGGER platform_push_deliveries_append_only BEFORE UPDATE OR DELETE ON platform_push_deliveries FOR EACH ROW EXECUTE FUNCTION platform_push_append_only();
