CREATE TRIGGER communication_messages_no_update BEFORE UPDATE OR DELETE ON communication_messages FOR EACH ROW EXECUTE FUNCTION communications_history_no_delete();
