ALTER TABLE clients ADD COLUMN birth_date date;

ALTER TABLE client_events DROP CONSTRAINT client_events_type_allowed;
ALTER TABLE client_events ADD CONSTRAINT client_events_type_allowed CHECK (event_type IN (
  'client.created','client.archived','client.profile_updated','client.plan_assigned','client.plan_paused',
  'client.plan_resumed','client.plan_cancelled','client.plan_renewed','client.plan_changed'
));
