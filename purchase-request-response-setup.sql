-- Run this once on an existing Refad database to enable requested discounts
-- and a supplier response history on shared purchase requests.

ALTER TABLE purchase_request_items
  ADD COLUMN IF NOT EXISTS requested_discount REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_price REAL,
  ADD COLUMN IF NOT EXISTS supplier_discount REAL,
  ADD COLUMN IF NOT EXISTS supplier_response_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS purchase_request_responses (
  id              BIGSERIAL PRIMARY KEY,
  request_id      BIGINT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_price  REAL,
  supplier_discount REAL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prr_request
  ON purchase_request_responses(request_id, submitted_at DESC);

NOTIFY pgrst, 'reload schema';
