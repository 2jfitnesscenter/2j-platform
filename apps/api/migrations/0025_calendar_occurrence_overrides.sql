ALTER TABLE calendar_audit_events DROP CONSTRAINT calendar_audit_action;
ALTER TABLE calendar_audit_events ADD CONSTRAINT calendar_audit_action CHECK (action IN (
  'session.created','session.generated','session.cancelled','session.reassigned','session.availability_override','session.occurrence_overridden','template.created','template.archived',
  'reservation.created','reservation.cancelled','reservation.cancelled_late','reservation.overbooked','reservation.attendance_changed','reservation.cancelled_by_center',
  'reservation.debt_override','reservation.document_override','reservation.entitlement_consumed','reservation.entitlement_restored','reservation.override_used',
  'waitlist.entered','waitlist.cancelled','waitlist.cancelled_by_center','waitlist.promoted','waitlist.promotion_skipped'
));
