CREATE TABLE domain_events_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_key text NOT NULL DEFAULT '2j' CHECK (center_key = '2j'),
  event_type text NOT NULL CHECK (event_type IN ('booking.confirmed','booking.cancelled','waitlist.joined','waitlist.promoted','message.created','reminder.booking','entitlement.expiring','entitlement.low_balance','document.pending','staff.substitution','staff.transfer_pending','staff.timeclock_update')),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  recipient_client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,
  recipient_staff_actor_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  CHECK (recipient_client_id IS NOT NULL OR recipient_staff_actor_id IS NOT NULL OR event_type='message.created')
);
CREATE INDEX domain_events_outbox_dispatch_idx ON domain_events_outbox(status, available_at, occurred_at) WHERE status IN ('pending','processing');
CREATE INDEX domain_events_outbox_client_idx ON domain_events_outbox(recipient_client_id, occurred_at DESC) WHERE recipient_client_id IS NOT NULL;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('client','staff')),
  recipient_id text NOT NULL,
  event_id uuid REFERENCES domain_events_outbox(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('booking_confirmed','booking_cancelled','waitlist_joined','waitlist_promoted','message_received','booking_reminder','entitlement_expiring','entitlement_low_balance','document_pending','staff_substitution','staff_transfer_pending','staff_timeclock_update')),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 240),
  deeplink text NOT NULL CHECK (deeplink ~ '^/(bookings|messages|agenda|profile|economics|team)(/[a-zA-Z0-9-]+)?$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  dedupe_key text NOT NULL,
  UNIQUE(recipient_kind, recipient_id, dedupe_key)
);
CREATE INDEX notifications_recipient_page_idx ON notifications(recipient_kind, recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications(recipient_kind, recipient_id) WHERE read_at IS NULL;

CREATE TABLE notification_settings (
  center_key text PRIMARY KEY DEFAULT '2j' CHECK (center_key = '2j'),
  booking_reminders_enabled boolean NOT NULL DEFAULT true,
  booking_reminder_minutes integer NOT NULL DEFAULT 120 CHECK (booking_reminder_minutes BETWEEN 15 AND 10080),
  entitlement_expiry_enabled boolean NOT NULL DEFAULT true,
  entitlement_expiry_days integer NOT NULL DEFAULT 7 CHECK (entitlement_expiry_days BETWEEN 1 AND 90),
  low_balance_enabled boolean NOT NULL DEFAULT true,
  low_balance_threshold integer NOT NULL DEFAULT 2 CHECK (low_balance_threshold BETWEEN 0 AND 100),
  document_reminders_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO notification_settings(center_key) VALUES ('2j') ON CONFLICT DO NOTHING;
