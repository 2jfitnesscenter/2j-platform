CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_key text NOT NULL DEFAULT '2j',
  category text NOT NULL CHECK (category IN ('nutrition','merchandising')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  UNIQUE (center_key,id)
);
CREATE INDEX store_products_active_catalog_idx ON store_products(center_key,category,lower(name),id) WHERE active;

CREATE TABLE store_product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE RESTRICT,
  sku text UNIQUE,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  size text CHECK (size IS NULL OR char_length(size) <= 40),
  flavor text CHECK (flavor IS NULL OR char_length(flavor) <= 80),
  price_cents bigint NOT NULL CHECK (price_cents BETWEEN 0 AND 100000000000),
  active boolean NOT NULL DEFAULT true,
  stock_tracked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL
);
CREATE INDEX store_variants_product_idx ON store_product_variants(product_id,active,label,id);

CREATE TABLE store_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_key text NOT NULL DEFAULT '2j',
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  payment_state text NOT NULL CHECK (payment_state IN ('paid','pending')),
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('cash','card','transfer','other')),
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  voided_at timestamptz,
  voided_by text,
  UNIQUE (center_key,idempotency_key),
  CHECK ((status='completed' AND voided_at IS NULL AND voided_by IS NULL) OR (status='voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL))
);
CREATE INDEX store_sales_client_history_idx ON store_sales(client_id,created_at DESC,id DESC);

CREATE TABLE store_sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES store_sales(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES store_product_variants(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  variant_label_snapshot text NOT NULL,
  sku_snapshot text,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total_cents bigint NOT NULL CHECK (line_total_cents = unit_price_cents * quantity)
);
CREATE INDEX store_sale_lines_sale_idx ON store_sale_lines(sale_id,id);

CREATE TABLE store_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES store_product_variants(id) ON DELETE RESTRICT,
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  movement_type text NOT NULL CHECK (movement_type IN ('opening','restock','adjustment_in','adjustment_out','sale','sale_reversal')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 300),
  actor_id text NOT NULL,
  sale_id uuid REFERENCES store_sales(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((movement_type IN ('opening','restock','adjustment_in','sale_reversal') AND quantity_delta > 0) OR (movement_type IN ('adjustment_out','sale') AND quantity_delta < 0))
);
CREATE INDEX store_inventory_variant_timeline_idx ON store_inventory_movements(variant_id,occurred_at DESC,id DESC);
CREATE INDEX store_inventory_sale_idx ON store_inventory_movements(sale_id) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX store_inventory_single_opening_idx ON store_inventory_movements(variant_id) WHERE movement_type='opening';

CREATE TABLE store_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('product.created','product.updated','product.activated','product.deactivated','variant.created','variant.updated','variant.price_changed','variant.activated','variant.deactivated','inventory.opening','inventory.restocked','inventory.adjusted','sale.created','sale.voided')),
  resource_type text NOT NULL CHECK (resource_type IN ('product','variant','sale')),
  resource_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_audit_timeline_idx ON store_audit_events(resource_type,resource_id,occurred_at DESC,id DESC);

CREATE FUNCTION store_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'store_history_immutable' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER store_inventory_movements_immutable BEFORE UPDATE OR DELETE ON store_inventory_movements FOR EACH ROW EXECUTE FUNCTION store_reject_history_mutation();
CREATE TRIGGER store_sale_lines_immutable BEFORE UPDATE OR DELETE ON store_sale_lines FOR EACH ROW EXECUTE FUNCTION store_reject_history_mutation();
CREATE TRIGGER store_audit_events_immutable BEFORE UPDATE OR DELETE ON store_audit_events FOR EACH ROW EXECUTE FUNCTION store_reject_history_mutation();

CREATE FUNCTION store_guard_sale_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='voided' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.center_key IS DISTINCT FROM OLD.center_key OR NEW.client_id IS DISTINCT FROM OLD.client_id OR
     NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents OR NEW.total_cents IS DISTINCT FROM OLD.total_cents OR
     NEW.payment_state IS DISTINCT FROM OLD.payment_state OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.note IS DISTINCT FROM OLD.note OR
     NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR
     NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'store_sale_immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='completed' AND NEW.status='voided') THEN
    RAISE EXCEPTION 'store_sale_invalid_transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_sales_immutable_guard BEFORE UPDATE ON store_sales FOR EACH ROW EXECUTE FUNCTION store_guard_sale_update();
