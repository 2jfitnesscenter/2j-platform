-- A71-3: keep scheduled entitlement bookings provisional through the charge
-- deadline, then preserve their history when membership coverage expires.
ALTER TABLE calendar_reservations DROP CONSTRAINT calendar_reservations_status;
ALTER TABLE calendar_reservations ADD CONSTRAINT calendar_reservations_status
  CHECK (status IN ('reserved','attended','no_show','cancelled','cancelled_late','cancelled_by_center','cancelled_by_membership'));
DROP INDEX calendar_reservations_client_active_unique;
CREATE UNIQUE INDEX calendar_reservations_client_active_unique ON calendar_reservations(session_id,client_id)
  WHERE status IN ('reserved','attended','no_show','cancelled_late');

ALTER TABLE calendar_audit_events DROP CONSTRAINT calendar_audit_action;
ALTER TABLE calendar_audit_events ADD CONSTRAINT calendar_audit_action CHECK (action IN (
  'session.created','session.generated','session.cancelled','session.reassigned','session.availability_override','session.occurrence_overridden','session.note_added','template.created','template.archived',
  'reservation.created','reservation.cancelled','reservation.cancelled_late','reservation.overbooked','reservation.attendance_changed','reservation.cancelled_by_center','reservation.cancelled_by_membership',
  'reservation.debt_override','reservation.document_override','reservation.entitlement_consumed','reservation.entitlement_restored','reservation.override_used',
  'waitlist.entered','waitlist.cancelled','waitlist.cancelled_by_center','waitlist.promoted','waitlist.promotion_skipped'
));

ALTER TABLE domain_events_outbox DROP CONSTRAINT domain_events_outbox_event_type_check;
ALTER TABLE domain_events_outbox ADD CONSTRAINT domain_events_outbox_event_type_check CHECK (event_type IN (
  'booking.confirmed','booking.cancelled','booking.cancelled_by_membership','waitlist.joined','waitlist.promoted','message.created','reminder.booking',
  'entitlement.expiring','entitlement.low_balance','entitlement.payment_due','document.pending','staff.substitution','staff.transfer_pending',
  'staff.timeclock_update','staff.cash_legacy_resolved'
));

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'booking_confirmed','booking_cancelled','booking_cancelled_by_membership','waitlist_joined','waitlist_promoted','message_received','booking_reminder',
  'entitlement_expiring','entitlement_low_balance','entitlement_payment_due','document_pending','staff_substitution','staff_transfer_pending',
  'staff_timeclock_update','staff_cash_legacy_resolved'
));

-- Permit provisional reservation consumption while the linked period's charge
-- is within its deadline. The booking API validates that the session belongs
-- to the period; this trigger keeps the immutable ledger consistent with it.
CREATE OR REPLACE FUNCTION client_entitlement_balance_nonnegative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE existing_balance integer;
DECLARE selected_right_id uuid;
BEGIN
  IF NEW.entitlement_period_id IS NULL THEN
    PERFORM 1 FROM client_plan_assignments WHERE id=NEW.assignment_id FOR UPDATE;
    SELECT COALESCE(sum(quantity),0)::int INTO existing_balance FROM client_entitlement_ledger
      WHERE assignment_id=NEW.assignment_id AND right_key=NEW.right_key AND entitlement_period_id IS NULL;
  ELSE
    SELECT right_id INTO selected_right_id FROM assignment_entitlement_periods WHERE id=NEW.entitlement_period_id FOR UPDATE;
    IF selected_right_id IS NULL OR NEW.right_key<>selected_right_id::text THEN
      RAISE EXCEPTION 'ledger right does not match entitlement period' USING ERRCODE='23514',CONSTRAINT='client_entitlement_ledger_period_right_match';
    END IF;
    SELECT COALESCE(sum(quantity),0)::int INTO existing_balance FROM client_entitlement_ledger
      WHERE entitlement_period_id=NEW.entitlement_period_id AND right_key=NEW.right_key;
    IF existing_balance+NEW.quantity<0 AND NEW.entry_type='consume' AND (
      EXISTS (SELECT 1 FROM assignment_entitlement_periods p
        JOIN assignment_entitlement_period_events linked ON linked.period_id=p.id AND linked.event_type='charge_linked'
        JOIN economic_charges c ON c.id=linked.charge_id
        LEFT JOIN LATERAL(SELECT COALESCE(sum(CASE WHEN t.kind='payment' THEN t.amount_cents ELSE -t.amount_cents END),0) AS net FROM economic_transactions t WHERE t.charge_id=c.id) paid ON true
        WHERE p.id=NEW.entitlement_period_id AND c.state='pending'
          AND c.due_on>=(now() AT TIME ZONE 'Atlantic/Canary')::date
          AND COALESCE(paid.net,0)<c.amount_cents
          AND NOT EXISTS(SELECT 1 FROM assignment_entitlement_period_events e WHERE e.period_id=p.id AND e.event_type='payment_validated'))
      OR EXISTS (SELECT 1 FROM assignment_entitlement_periods p WHERE p.id=NEW.entitlement_period_id
        AND (now() AT TIME ZONE 'Atlantic/Canary')::date BETWEEN p.period_start AND LEAST(p.period_end,date_trunc('month',p.period_start)::date+9)
        AND NOT EXISTS(SELECT 1 FROM assignment_entitlement_period_events e WHERE e.period_id=p.id AND e.event_type='payment_validated')
        AND (SELECT e.enabled FROM assignment_recurrence_events e WHERE e.assignment_id=p.assignment_id AND e.effective_on<=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY e.effective_on DESC,e.created_at DESC,e.id DESC LIMIT 1) IS TRUE)
    ) THEN RETURN NEW; END IF;
    IF existing_balance+NEW.quantity<0 AND NEW.entry_type='grant' AND existing_balance<0 THEN RETURN NEW; END IF;
  END IF;
  IF existing_balance+NEW.quantity<0 THEN
    RAISE EXCEPTION 'entitlement balance cannot be negative' USING ERRCODE='23514',CONSTRAINT='client_entitlement_balance_nonnegative';
  END IF;
  RETURN NEW;
END $$;
