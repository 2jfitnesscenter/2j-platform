-- Product photos (2J-098D, product level only). Binary data lives in object storage; this table keeps the metadata.
-- Position 0 is the primary image; at most 6 images per product (positions 0-5).
CREATE TABLE store_product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE RESTRICT,
  object_key text NOT NULL UNIQUE CHECK (char_length(object_key) BETWEEN 1 AND 200),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 5),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  CONSTRAINT store_product_media_position_unique UNIQUE (product_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT store_product_media_primary_is_first CHECK (is_primary = (position = 0))
);
CREATE INDEX store_product_media_product_idx ON store_product_media(product_id, position);

-- The audit trail records photo changes with its own actions.
ALTER TABLE store_audit_events DROP CONSTRAINT store_audit_events_action_check;
ALTER TABLE store_audit_events ADD CONSTRAINT store_audit_events_action_check CHECK (action IN ('product.created','product.updated','product.activated','product.deactivated','variant.created','variant.updated','variant.price_changed','variant.activated','variant.deactivated','inventory.opening','inventory.restocked','inventory.adjusted','sale.created','sale.voided','product.media_added','product.media_reordered','product.media_deleted'));
