ALTER TABLE calendar_reservations DROP CONSTRAINT calendar_reservations_status;
ALTER TABLE calendar_reservations ADD CONSTRAINT calendar_reservations_status CHECK (status IN ('reserved','attended','no_show','cancelled','cancelled_by_center'));
ALTER TABLE calendar_waitlist_entries DROP CONSTRAINT calendar_waitlist_status;
ALTER TABLE calendar_waitlist_entries ADD CONSTRAINT calendar_waitlist_status CHECK (status IN ('waiting','cancelled','cancelled_by_center'));
ALTER TABLE calendar_sessions ADD CONSTRAINT calendar_sessions_individual_capacity CHECK (individual_client_id IS NULL OR capacity=1);
ALTER TABLE calendar_audit_events DROP CONSTRAINT calendar_audit_action;
ALTER TABLE calendar_audit_events ADD CONSTRAINT calendar_audit_action CHECK (action IN ('session.created','session.generated','session.cancelled','template.archived','reservation.created','reservation.cancelled','reservation.overbooked','reservation.attendance_changed','reservation.cancelled_by_center','waitlist.entered','waitlist.cancelled','waitlist.cancelled_by_center'));

CREATE FUNCTION calendar_enforce_individual_client() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE intended_client uuid;
BEGIN
  SELECT individual_client_id INTO intended_client FROM calendar_sessions WHERE id=NEW.session_id FOR KEY SHARE;
  IF intended_client IS NOT NULL AND intended_client <> NEW.client_id THEN
    RAISE EXCEPTION 'client does not match individual session' USING ERRCODE='23514', CONSTRAINT='calendar_individual_client_match';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calendar_reservation_individual_client BEFORE INSERT OR UPDATE OF session_id,client_id ON calendar_reservations FOR EACH ROW EXECUTE FUNCTION calendar_enforce_individual_client();
CREATE TRIGGER calendar_waitlist_individual_client BEFORE INSERT OR UPDATE OF session_id,client_id ON calendar_waitlist_entries FOR EACH ROW EXECUTE FUNCTION calendar_enforce_individual_client();

CREATE FUNCTION protect_calendar_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.individual_client_id IS DISTINCT FROM OLD.individual_client_id THEN
    RAISE EXCEPTION 'individual session client is immutable' USING ERRCODE='55000', CONSTRAINT='calendar_session_individual_client_immutable';
  END IF;
  IF OLD.status='cancelled' AND NEW.status<>'cancelled' THEN
    RAISE EXCEPTION 'cancelled sessions cannot be reopened' USING ERRCODE='55000', CONSTRAINT='calendar_session_cancelled_terminal';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calendar_session_identity_immutable BEFORE UPDATE OF individual_client_id,status ON calendar_sessions FOR EACH ROW EXECUTE FUNCTION protect_calendar_session_identity();

CREATE FUNCTION calendar_service_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE local_today date := (now() AT TIME ZONE 'Atlantic/Canary')::date;
BEGIN
  IF NEW.status='archived' AND OLD.status<>'archived' AND (
    EXISTS (SELECT 1 FROM calendar_sessions WHERE service_id=OLD.id AND status='scheduled' AND starts_at > now()) OR
    EXISTS (SELECT 1 FROM recurring_session_templates WHERE service_id=OLD.id AND status='active' AND (ends_on IS NULL OR ends_on >= local_today))
  ) THEN
    RAISE EXCEPTION 'service has future active calendar items' USING ERRCODE='23514', CONSTRAINT='services_future_calendar_items';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER services_future_calendar_archive_guard BEFORE UPDATE OF status ON services FOR EACH ROW EXECUTE FUNCTION calendar_service_archive_guard();

CREATE FUNCTION calendar_area_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE local_today date := (now() AT TIME ZONE 'Atlantic/Canary')::date;
BEGIN
  IF NEW.status='archived' AND OLD.status<>'archived' AND (
    EXISTS (SELECT 1 FROM calendar_sessions WHERE area_id=OLD.id AND status='scheduled' AND starts_at > now()) OR
    EXISTS (SELECT 1 FROM recurring_session_templates WHERE area_id=OLD.id AND status='active' AND (ends_on IS NULL OR ends_on >= local_today))
  ) THEN
    RAISE EXCEPTION 'area has future active calendar items' USING ERRCODE='23514', CONSTRAINT='areas_future_calendar_items';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER areas_future_calendar_archive_guard BEFORE UPDATE OF status ON areas FOR EACH ROW EXECUTE FUNCTION calendar_area_archive_guard();
