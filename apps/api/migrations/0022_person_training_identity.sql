-- Shared identity boundary. Platform facets remain local; no client/staff fields are copied to Training.
CREATE TABLE platform_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_persons_status_check CHECK (status IN ('active','revoked')),
  CONSTRAINT platform_persons_actor_check CHECK (char_length(created_by) BETWEEN 1 AND 120)
);

CREATE TABLE platform_person_clients (
  person_id uuid NOT NULL,
  client_id uuid NOT NULL,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, client_id),
  CONSTRAINT platform_person_clients_client_unique UNIQUE (client_id),
  CONSTRAINT platform_person_clients_person_unique UNIQUE (person_id),
  CONSTRAINT platform_person_clients_person_id_platform_persons_id_fk FOREIGN KEY (person_id) REFERENCES platform_persons(id) ON DELETE RESTRICT,
  CONSTRAINT platform_person_clients_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT platform_person_clients_actor_check CHECK (char_length(linked_by) BETWEEN 1 AND 120)
);

CREATE TABLE platform_person_staff (
  person_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, professional_id),
  CONSTRAINT platform_person_staff_professional_unique UNIQUE (professional_id),
  CONSTRAINT platform_person_staff_person_unique UNIQUE (person_id),
  CONSTRAINT platform_person_staff_person_id_platform_persons_id_fk FOREIGN KEY (person_id) REFERENCES platform_persons(id) ON DELETE RESTRICT,
  CONSTRAINT platform_person_staff_professional_id_staff_professionals_id_fk FOREIGN KEY (professional_id) REFERENCES staff_professionals(id) ON DELETE RESTRICT,
  CONSTRAINT platform_person_staff_actor_check CHECK (char_length(linked_by) BETWEEN 1 AND 120)
);

-- `training_user_id` is an opaque remote identifier, never a central client/staff id.
CREATE TABLE training_account_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  person_id uuid NOT NULL,
  training_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  method text NOT NULL,
  link_version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT training_account_links_status_check CHECK (status IN ('active','revoked')),
  CONSTRAINT training_account_links_person_id_platform_persons_id_fk FOREIGN KEY (person_id) REFERENCES platform_persons(id) ON DELETE RESTRICT,
  CONSTRAINT training_account_links_method_check CHECK (method IN ('explicit_admin','user_confirmed','migration')),
  CONSTRAINT training_account_links_version_check CHECK (link_version > 0),
  CONSTRAINT training_account_links_user_id_check CHECK (char_length(btrim(training_user_id)) BETWEEN 1 AND 200),
  CONSTRAINT training_account_links_revoked_check CHECK ((status='revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT training_account_links_actor_check CHECK (char_length(created_by) BETWEEN 1 AND 120 AND char_length(updated_by) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX training_account_links_one_active_person ON training_account_links(person_id) WHERE status='active';
CREATE UNIQUE INDEX training_account_links_one_active_user ON training_account_links(training_user_id) WHERE status='active';

CREATE TABLE platform_identity_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_identity_audit_actor_check CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  CONSTRAINT platform_identity_audit_person_id_platform_persons_id_fk FOREIGN KEY (person_id) REFERENCES platform_persons(id) ON DELETE RESTRICT,
  CONSTRAINT platform_identity_audit_action_check CHECK (action IN ('person.created','person.client_linked','person.staff_linked','training.linked','training.link_revoked')),
  CONSTRAINT platform_identity_audit_details_check CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX platform_identity_audit_person_timeline_idx ON platform_identity_audit_events(person_id, occurred_at DESC, id DESC);

CREATE FUNCTION prevent_platform_identity_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'identity audit is append-only' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER platform_identity_audit_immutable BEFORE UPDATE OR DELETE ON platform_identity_audit_events FOR EACH ROW EXECUTE FUNCTION prevent_platform_identity_audit_mutation();
CREATE TRIGGER platform_identity_audit_no_truncate BEFORE TRUNCATE ON platform_identity_audit_events FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();

CREATE FUNCTION protect_platform_person_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'personId is immutable' USING ERRCODE='55000'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'person identity is retained' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER platform_person_id_immutable BEFORE UPDATE OR DELETE ON platform_persons FOR EACH ROW EXECUTE FUNCTION protect_platform_person_identity();
CREATE TRIGGER platform_person_no_truncate BEFORE TRUNCATE ON platform_persons FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();

CREATE FUNCTION protect_platform_person_facet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'person facet history is retained' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER platform_person_clients_immutable BEFORE UPDATE OR DELETE ON platform_person_clients FOR EACH ROW EXECUTE FUNCTION protect_platform_person_facet();
CREATE TRIGGER platform_person_clients_no_truncate BEFORE TRUNCATE ON platform_person_clients FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();
CREATE TRIGGER platform_person_staff_immutable BEFORE UPDATE OR DELETE ON platform_person_staff FOR EACH ROW EXECUTE FUNCTION protect_platform_person_facet();
CREATE TRIGGER platform_person_staff_no_truncate BEFORE TRUNCATE ON platform_person_staff FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();

CREATE FUNCTION protect_training_account_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'training link history is retained' USING ERRCODE='55000'; END IF;
  IF NEW.link_id IS DISTINCT FROM OLD.link_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.training_user_id IS DISTINCT FROM OLD.training_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'training link identity is immutable' USING ERRCODE='55000';
  END IF;
  IF OLD.status='revoked' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'revoked training link is final' USING ERRCODE='55000'; END IF;
  IF OLD.status='active' AND NEW.status='revoked' THEN NEW.revoked_at=coalesce(NEW.revoked_at,now()); NEW.link_version=OLD.link_version+1; END IF;
  IF OLD.status='active' AND NEW.status='active' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'active training link changes require revocation and a new link' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER training_account_link_protection BEFORE UPDATE OR DELETE ON training_account_links FOR EACH ROW EXECUTE FUNCTION protect_training_account_link();
CREATE TRIGGER training_account_link_no_truncate BEFORE TRUNCATE ON training_account_links FOR EACH STATEMENT EXECUTE FUNCTION prevent_platform_identity_audit_mutation();
