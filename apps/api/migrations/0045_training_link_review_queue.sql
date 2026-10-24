-- Manual review queue for people who cannot complete the Training link with their own proof (decisions D142, D143, A20 -> A26).
-- Linking itself is unchanged: the normal way is the owner's passkey proof from Home (training-link-transactions). This queue is for the rest
-- (lost passkey, no access to the Training account, repeated failures). Only administrators resolve a case, always with an identity check and a record.
-- Additive. A case never links anything by itself: approving records the decision and the verification; the link still goes through the audited admin link path.
CREATE TABLE training_link_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES platform_persons(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN ('lost_passkey','no_access_to_training_account','proof_failed','other')),
  member_note text CHECK (member_note IS NULL OR char_length(member_note) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','dismissed')),
  training_user_id text CHECK (training_user_id IS NULL OR char_length(training_user_id) BETWEEN 1 AND 200),
  verification_method text CHECK (verification_method IS NULL OR verification_method IN ('in_person','other_verified')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(btrim(resolution_note)) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text CHECK (resolved_by IS NULL OR char_length(resolved_by) BETWEEN 1 AND 120),
  CONSTRAINT training_link_review_resolved_check CHECK ((status = 'open') = (resolved_at IS NULL AND resolved_by IS NULL)),
  CONSTRAINT training_link_review_approval_check CHECK (status <> 'approved' OR (training_user_id IS NOT NULL AND verification_method IS NOT NULL AND resolution_note IS NOT NULL)),
  CONSTRAINT training_link_review_rejection_check CHECK (status NOT IN ('rejected','dismissed') OR resolution_note IS NOT NULL)
);
-- One open case per person.
CREATE UNIQUE INDEX training_link_review_one_open_idx ON training_link_review_cases(person_id) WHERE status = 'open';
CREATE INDEX training_link_review_status_idx ON training_link_review_cases(status, created_at);

-- Append-only history of what happened to a case (who, what, when). No personal data beyond ids.
CREATE TABLE training_link_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES training_link_review_cases(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('opened','approved','rejected','dismissed')),
  actor text NOT NULL CHECK (char_length(actor) BETWEEN 1 AND 120),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_link_review_events_case_idx ON training_link_review_events(case_id, occurred_at);

CREATE FUNCTION training_link_review_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'training_link_review_events' THEN RAISE EXCEPTION 'training_link_review_events is append-only' USING ERRCODE='55000'; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'review cases are retained' USING ERRCODE='55000'; END IF;
  IF OLD.status <> 'open' THEN RAISE EXCEPTION 'a resolved review case is final' USING ERRCODE='55000'; END IF;
  IF NEW.id <> OLD.id OR NEW.person_id <> OLD.person_id OR NEW.reason <> OLD.reason OR NEW.created_at <> OLD.created_at OR NEW.member_note IS DISTINCT FROM OLD.member_note THEN
    RAISE EXCEPTION 'the origin of a review case is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER training_link_review_cases_protect BEFORE UPDATE OR DELETE ON training_link_review_cases FOR EACH ROW EXECUTE FUNCTION training_link_review_protect();
CREATE TRIGGER training_link_review_events_protect BEFORE UPDATE OR DELETE ON training_link_review_events FOR EACH ROW EXECUTE FUNCTION training_link_review_protect();
