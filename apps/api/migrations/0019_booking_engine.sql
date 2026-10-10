-- 2J-074: persistent booking-to-entitlement links and explicit cancellation policy.
-- Existing reservations remain historical rows and are not retroactively charged.

ALTER TABLE services
  ADD COLUMN cancellation_window_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN late_cancellation_policy text NOT NULL DEFAULT 'restore';
ALTER TABLE services ADD CONSTRAINT services_cancellation_window_range
  CHECK (cancellation_window_minutes BETWEEN 0 AND 10080);
ALTER TABLE services ADD CONSTRAINT services_late_cancellation_policy
  CHECK (late_cancellation_policy IN ('restore','consume'));

ALTER TABLE calendar_reservations
  ADD COLUMN entitlement_assignment_id uuid,
  ADD COLUMN idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by text;
ALTER TABLE calendar_reservations ADD CONSTRAINT calendar_reservations_assignment_fk
  FOREIGN KEY (entitlement_assignment_id,client_id)
  REFERENCES client_plan_assignments(id,client_id) ON DELETE RESTRICT;
ALTER TABLE calendar_reservations ADD CONSTRAINT calendar_reservations_cancel_actor
  CHECK (cancelled_by IS NULL OR char_length(cancelled_by) BETWEEN 1 AND 120);
CREATE UNIQUE INDEX calendar_reservations_idempotency_unique ON calendar_reservations(idempotency_key);
CREATE INDEX calendar_reservations_client_conflict_idx ON calendar_reservations(client_id,status,session_id);

ALTER TABLE calendar_reservations DROP CONSTRAINT calendar_reservations_status;
ALTER TABLE calendar_reservations ADD CONSTRAINT calendar_reservations_status
  CHECK (status IN ('reserved','attended','no_show','cancelled','cancelled_late','cancelled_by_center'));
DROP INDEX calendar_reservations_client_active_unique;
CREATE UNIQUE INDEX calendar_reservations_client_active_unique ON calendar_reservations(session_id,client_id)
  WHERE status IN ('reserved','attended','no_show','cancelled_late');

ALTER TABLE calendar_waitlist_entries
  ADD COLUMN idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN entitlement_assignment_id uuid,
  ADD COLUMN promoted_reservation_id uuid;
ALTER TABLE calendar_waitlist_entries ADD CONSTRAINT calendar_waitlist_assignment_fk
  FOREIGN KEY (entitlement_assignment_id,client_id) REFERENCES client_plan_assignments(id,client_id) ON DELETE RESTRICT;
ALTER TABLE calendar_waitlist_entries ADD CONSTRAINT calendar_waitlist_promoted_reservation_fk
  FOREIGN KEY (promoted_reservation_id) REFERENCES calendar_reservations(id) ON DELETE RESTRICT;
ALTER TABLE calendar_waitlist_entries DROP CONSTRAINT calendar_waitlist_status;
ALTER TABLE calendar_waitlist_entries ADD CONSTRAINT calendar_waitlist_status
  CHECK (status IN ('waiting','cancelled','cancelled_by_center','promoted'));
CREATE UNIQUE INDEX calendar_waitlist_idempotency_unique ON calendar_waitlist_entries(idempotency_key);

CREATE TABLE calendar_reservation_rights (
  reservation_id uuid NOT NULL CONSTRAINT calendar_reservation_rights_reservation_fk REFERENCES calendar_reservations(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL,
  client_id uuid NOT NULL,
  right_id uuid NOT NULL CONSTRAINT calendar_reservation_rights_right_fk REFERENCES plan_rights(id) ON DELETE RESTRICT,
  right_type text NOT NULL CONSTRAINT calendar_reservation_rights_type CHECK (right_type IN ('service_access','sessions_quota','period_quota')),
  ledger_entry_id uuid REFERENCES client_entitlement_ledger(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id,right_id),
  FOREIGN KEY (assignment_id,client_id) REFERENCES client_plan_assignments(id,client_id) ON DELETE RESTRICT,
  CONSTRAINT calendar_reservation_rights_ledger CHECK ((right_type='sessions_quota') = (ledger_entry_id IS NOT NULL))
);
CREATE INDEX calendar_reservation_rights_period_idx ON calendar_reservation_rights(right_id,assignment_id,reservation_id);

CREATE TABLE calendar_booking_operations (
  idempotency_key uuid PRIMARY KEY,
  operation text NOT NULL CONSTRAINT calendar_booking_operations_operation CHECK (operation IN ('reserve','cancel','waitlist_join','waitlist_leave','waitlist_promote','center_cancel')),
  request_hash char(64) NOT NULL CONSTRAINT calendar_booking_operations_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL CONSTRAINT calendar_booking_operations_response CHECK (jsonb_typeof(response)='object'),
  actor_id text NOT NULL CONSTRAINT calendar_booking_operations_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_booking_operations_created_idx ON calendar_booking_operations(created_at);

ALTER TABLE calendar_audit_events DROP CONSTRAINT calendar_audit_action;
ALTER TABLE calendar_audit_events ADD CONSTRAINT calendar_audit_action CHECK (action IN (
  'session.created','session.generated','session.cancelled','session.reassigned','session.availability_override','template.created','template.archived',
  'reservation.created','reservation.cancelled','reservation.cancelled_late','reservation.overbooked','reservation.attendance_changed','reservation.cancelled_by_center',
  'reservation.debt_override','reservation.document_override','reservation.entitlement_consumed','reservation.entitlement_restored','reservation.override_used',
  'waitlist.entered','waitlist.cancelled','waitlist.cancelled_by_center','waitlist.promoted','waitlist.promotion_skipped'
));
