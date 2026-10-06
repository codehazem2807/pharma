-- Run once in Supabase SQL Editor to enable receipt and batch barcode linking
-- on databases created before these columns were added to supabase.sql.
ALTER TABLE receipt_items
  ADD COLUMN IF NOT EXISTS batch_barcode VARCHAR(50);

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS batch_barcode VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_batches_company_batch_barcode
  ON batches(company_id, batch_barcode)
  WHERE batch_barcode IS NOT NULL;
