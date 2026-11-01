-- A81 slice 1 (seguimiento): una sesión abierta de un día anterior se cierra como abandonada al cambiar de día.
-- Nunca se reanuda. La sesión abandonada no tiene finished_at y no aparece en el historial.

ALTER TABLE training_sessions DROP CONSTRAINT training_sessions_status_allowed;
ALTER TABLE training_sessions DROP CONSTRAINT training_sessions_finished_consistent;
ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_status_allowed CHECK (status IN ('in_progress','finished','abandoned'));
ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_finished_consistent CHECK ((status = 'finished') = (finished_at IS NOT NULL));
