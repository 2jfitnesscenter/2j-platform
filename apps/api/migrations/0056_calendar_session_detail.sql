-- Persist staff-only session notes without overloading client conversations.
CREATE TABLE calendar_session_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES calendar_sessions(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_session_notes_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 3000),
  CONSTRAINT calendar_session_notes_actor CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 120)
);
CREATE INDEX calendar_session_notes_timeline_idx ON calendar_session_notes(session_id,created_at DESC,id DESC);
CREATE TRIGGER calendar_session_notes_no_change BEFORE UPDATE OR DELETE ON calendar_session_notes FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
CREATE TRIGGER calendar_session_notes_no_truncate BEFORE TRUNCATE ON calendar_session_notes FOR EACH STATEMENT EXECUTE FUNCTION communications_history_no_delete();
REVOKE DELETE, TRUNCATE ON calendar_session_notes FROM PUBLIC;

ALTER TABLE calendar_audit_events DROP CONSTRAINT calendar_audit_action;
ALTER TABLE calendar_audit_events ADD CONSTRAINT calendar_audit_action CHECK (action IN (
  'session.created','session.generated','session.cancelled','session.reassigned','session.availability_override','session.occurrence_overridden','session.note_added','template.created','template.archived',
  'reservation.created','reservation.cancelled','reservation.cancelled_late','reservation.overbooked','reservation.attendance_changed','reservation.cancelled_by_center',
  'reservation.debt_override','reservation.document_override','reservation.entitlement_consumed','reservation.entitlement_restored','reservation.override_used',
  'waitlist.entered','waitlist.cancelled','waitlist.cancelled_by_center','waitlist.promoted','waitlist.promotion_skipped'
));
