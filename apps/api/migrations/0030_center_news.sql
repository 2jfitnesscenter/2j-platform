CREATE TABLE center_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_key text NOT NULL DEFAULT '2j',
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  CONSTRAINT center_news_center_key CHECK (char_length(center_key) BETWEEN 1 AND 80),
  CONSTRAINT center_news_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT center_news_body CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  CONSTRAINT center_news_status CHECK (status IN ('draft','published','withdrawn')),
  CONSTRAINT center_news_featured_published CHECK (NOT featured OR status='published'),
  CONSTRAINT center_news_published_at_state CHECK (
    (status='draft' AND published_at IS NULL) OR
    (status IN ('published','withdrawn') AND published_at IS NOT NULL)
  ),
  CONSTRAINT center_news_created_by CHECK (char_length(created_by) BETWEEN 1 AND 120),
  CONSTRAINT center_news_updated_by CHECK (char_length(updated_by) BETWEEN 1 AND 120)
);
CREATE INDEX center_news_admin_listing_idx ON center_news(center_key,status,updated_at DESC,id DESC);
CREATE INDEX center_news_published_listing_idx ON center_news(center_key,published_at DESC,id DESC) WHERE status='published';
CREATE INDEX center_news_featured_listing_idx ON center_news(center_key,published_at DESC,id DESC) WHERE status='published' AND featured;

CREATE TABLE center_news_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_key text NOT NULL,
  news_id uuid NOT NULL REFERENCES center_news(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT center_news_audit_center_key CHECK (char_length(center_key) BETWEEN 1 AND 80),
  CONSTRAINT center_news_audit_actor CHECK (char_length(actor_id) BETWEEN 1 AND 120),
  CONSTRAINT center_news_audit_action CHECK (action IN ('news.created','news.updated','news.published','news.withdrawn','news.featured','news.unfeatured')),
  CONSTRAINT center_news_audit_details CHECK (jsonb_typeof(details)='object')
);
CREATE INDEX center_news_audit_timeline_idx ON center_news_audit_events(center_key,news_id,occurred_at DESC,id DESC);

CREATE FUNCTION center_news_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'center news history is append only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER center_news_no_delete BEFORE DELETE ON center_news FOR EACH ROW EXECUTE FUNCTION center_news_history_guard();
CREATE TRIGGER center_news_no_truncate BEFORE TRUNCATE ON center_news FOR EACH STATEMENT EXECUTE FUNCTION center_news_history_guard();
CREATE TRIGGER center_news_audit_no_change BEFORE UPDATE OR DELETE ON center_news_audit_events FOR EACH ROW EXECUTE FUNCTION center_news_history_guard();
CREATE TRIGGER center_news_audit_no_truncate BEFORE TRUNCATE ON center_news_audit_events FOR EACH STATEMENT EXECUTE FUNCTION center_news_history_guard();
REVOKE DELETE, TRUNCATE ON center_news,center_news_audit_events FROM PUBLIC;
