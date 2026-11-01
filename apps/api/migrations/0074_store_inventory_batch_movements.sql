DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='store_inventory_movements'::regclass
      AND contype='c'
      AND (pg_get_constraintdef(oid) LIKE '%movement_type%' OR pg_get_constraintdef(oid) LIKE '%quantity_delta%')
  LOOP
    EXECUTE format('ALTER TABLE store_inventory_movements DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END $$;

ALTER TABLE store_inventory_movements
  ADD CONSTRAINT store_inventory_quantity_nonzero CHECK (quantity_delta <> 0),
  ADD CONSTRAINT store_inventory_movement_type_allowed CHECK (movement_type IN (
    'opening','restock','adjustment_in','adjustment_out','sale','sale_reversal','shrinkage','return'
  )),
  ADD CONSTRAINT store_inventory_movement_sign CHECK (
    (movement_type IN ('opening','restock','adjustment_in','sale_reversal','return') AND quantity_delta > 0)
    OR (movement_type IN ('adjustment_out','sale','shrinkage') AND quantity_delta < 0)
  );

ALTER TABLE store_audit_events DROP CONSTRAINT store_audit_events_action_check;
ALTER TABLE store_audit_events ADD CONSTRAINT store_audit_events_action_check CHECK (action IN (
  'product.created','product.updated','product.activated','product.deactivated','variant.created','variant.updated',
  'variant.price_changed','variant.activated','variant.deactivated','inventory.opening','inventory.restocked',
  'inventory.adjusted','sale.created','sale.voided','product.media_added','product.media_reordered',
  'product.media_deleted','store.settings.updated','inventory.batch_recorded'
));
