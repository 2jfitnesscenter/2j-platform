ALTER TABLE client_events DROP CONSTRAINT client_events_actor_role_allowed;
ALTER TABLE client_events ADD CONSTRAINT client_events_actor_role_allowed
  CHECK (actor_role IS NULL OR actor_role IN ('admin', 'trainer', 'reception-management', 'accountant', 'member'));
