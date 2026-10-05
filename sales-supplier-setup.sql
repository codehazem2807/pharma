-- Run once in Supabase SQL Editor to enable selling to suppliers.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL;

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_orders_supplier_id_fkey'
      AND conrelid = 'sales_orders'::regclass
  ) THEN
    ALTER TABLE sales_orders
      ADD CONSTRAINT sales_orders_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_invoices_supplier_id_fkey'
      AND conrelid = 'sales_invoices'::regclass
  ) THEN
    ALTER TABLE sales_invoices
      ADD CONSTRAINT sales_invoices_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_so_supplier ON sales_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_si_supplier ON sales_invoices(supplier_id);

NOTIFY pgrst, 'reload schema';
