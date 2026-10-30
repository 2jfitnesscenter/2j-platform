-- Store settings remain optional at the UI boundary while preserving the current catalog behavior (3 units).
CREATE TABLE store_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_key text NOT NULL UNIQUE CHECK (center_key = '2j'),
  low_stock_threshold integer NOT NULL DEFAULT 3 CHECK (low_stock_threshold BETWEEN 0 AND 100000),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO store_settings(center_key) VALUES ('2j');

ALTER TABLE store_audit_events DROP CONSTRAINT store_audit_events_action_check;
ALTER TABLE store_audit_events ADD CONSTRAINT store_audit_events_action_check CHECK (action IN ('product.created','product.updated','product.activated','product.deactivated','variant.created','variant.updated','variant.price_changed','variant.activated','variant.deactivated','inventory.opening','inventory.restocked','inventory.adjusted','sale.created','sale.voided','product.media_added','product.media_reordered','product.media_deleted','store.settings.updated'));
ALTER TABLE store_audit_events DROP CONSTRAINT store_audit_events_resource_type_check;
ALTER TABLE store_audit_events ADD CONSTRAINT store_audit_events_resource_type_check CHECK (resource_type IN ('product','variant','sale','store_settings'));
