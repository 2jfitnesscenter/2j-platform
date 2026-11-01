-- A77 replaces the one-session-per-register-per-day rule. Keep the separate
-- partial unique index that allows only one open session per register.
DROP INDEX IF EXISTS economic_cash_one_session_per_register_day;
