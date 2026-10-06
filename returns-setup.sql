-- Run once in Supabase SQL Editor for an existing Refad database.
-- Supports customer sales returns and returns to suppliers with atomic stock updates.

INSERT INTO permissions (code, name_ar, module)
VALUES
  ('sales.return', 'مرتجع مبيعات', 'sales'),
  ('purchases.return', 'مرتجع مشتريات', 'purchases')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN role_permissions existing ON existing.role_id = r.id
JOIN permissions scope ON scope.id = existing.permission_id
JOIN permissions p ON p.code = CASE
  WHEN scope.code = 'sales.view' THEN 'sales.return'
  WHEN scope.code = 'purchases.receive' THEN 'purchases.return'
END
WHERE r.company_id IS NOT NULL
  AND scope.code IN ('sales.view', 'purchases.receive')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS inventory_returns (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  return_number VARCHAR(40) UNIQUE,
  return_type VARCHAR(20) NOT NULL CHECK (return_type IN ('sales', 'purchase')),
  reference_invoice_id BIGINT REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  reference_receipt_id BIGINT REFERENCES receipts(id) ON DELETE RESTRICT,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason VARCHAR(150) NOT NULL,
  notes VARCHAR(500),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (return_type = 'sales' AND reference_invoice_id IS NOT NULL AND reference_receipt_id IS NULL)
    OR
    (return_type = 'purchase' AND reference_receipt_id IS NOT NULL AND reference_invoice_id IS NULL)
  )
);

UPDATE inventory_returns
SET return_number = CASE
  WHEN return_type = 'sales' THEN 'SRET-' || TO_CHAR(COALESCE(return_date, CURRENT_DATE), 'YYYYMMDD') || '-' || LPAD(CAST(id AS TEXT), 6, '0')
  ELSE 'PRET-' || TO_CHAR(COALESCE(return_date, CURRENT_DATE), 'YYYYMMDD') || '-' || LPAD(CAST(id AS TEXT), 6, '0')
END
WHERE return_number IS NULL OR BTRIM(return_number) = '';

ALTER TABLE inventory_returns
  ALTER COLUMN return_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_returns_return_number_unique
  ON inventory_returns(return_number);

CREATE INDEX IF NOT EXISTS idx_inventory_returns_company_date
  ON inventory_returns(company_id, return_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_returns_invoice
  ON inventory_returns(reference_invoice_id) WHERE reference_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_returns_receipt
  ON inventory_returns(reference_receipt_id) WHERE reference_receipt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_return_items (
  id BIGSERIAL PRIMARY KEY,
  return_id BIGINT NOT NULL REFERENCES inventory_returns(id) ON DELETE CASCADE,
  source_item_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  batch_id BIGINT NOT NULL REFERENCES batches(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,4) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE (return_id, source_item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_return_items_source
  ON inventory_return_items(source_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_return_items_batch
  ON inventory_return_items(batch_id);

CREATE OR REPLACE FUNCTION process_inventory_return(
  p_company_id BIGINT,
  p_return_type TEXT,
  p_reference_id BIGINT,
  p_return_date DATE,
  p_reason TEXT,
  p_notes TEXT,
  p_user_id BIGINT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_return_id BIGINT;
  v_return_number TEXT;
  v_source RECORD;
  v_item RECORD;
  v_item_id BIGINT;
  v_product_id BIGINT;
  v_batch_id BIGINT;
  v_quantity INTEGER;
  v_source_quantity INTEGER;
  v_returned_quantity INTEGER;
  v_unit_price NUMERIC(14,4);
  v_unit_cost NUMERIC(14,4);
  v_line_total NUMERIC(14,2);
  v_total NUMERIC(14,2) := 0;
  v_balance NUMERIC(14,2);
  v_customer_id BIGINT;
  v_supplier_id BIGINT;
  v_user_company_id BIGINT;
  v_user_role_id BIGINT;
  v_return_date DATE := COALESCE(p_return_date, CURRENT_DATE);
BEGIN
  IF p_return_type IS NULL OR p_return_type NOT IN ('sales', 'purchase') THEN
    RAISE EXCEPTION 'نوع المرتجع غير صحيح';
  END IF;
  IF COALESCE(NULLIF(BTRIM(p_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'سبب المرتجع مطلوب';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'أضف كمية مرتجعة لصنف واحد على الأقل';
  END IF;
  SELECT company_id, role_id INTO v_user_company_id, v_user_role_id
  FROM users WHERE id = p_user_id AND is_active = TRUE;
  IF NOT FOUND OR v_user_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'المستخدم غير نشط أو لا يتبع الشركة الحالية';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_user_role_id
      AND p.code = CASE
        WHEN p_return_type = 'sales' THEN 'sales.view'
        ELSE 'purchases.receive'
      END
  ) THEN
    RAISE EXCEPTION 'المستخدم لا يملك صلاحية تسجيل هذا النوع من المرتجعات';
  END IF;

  IF p_return_type = 'sales' THEN
    SELECT * INTO v_source
    FROM sales_invoices
    WHERE id = p_reference_id AND company_id = p_company_id
      AND invoice_type = 'sale' AND status <> 'cancelled'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة البيع الأصلية غير موجودة أو ملغاة'; END IF;
    v_customer_id := v_source.customer_id;
    v_supplier_id := v_source.supplier_id;
  ELSE
    SELECT * INTO v_source
    FROM receipts
    WHERE id = p_reference_id AND company_id = p_company_id AND status <> 'cancelled'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'فاتورة الاستلام الأصلية غير موجودة أو ملغاة'; END IF;
    v_customer_id := NULL;
    v_supplier_id := v_source.supplier_id;
  END IF;

  v_return_id := nextval(pg_get_serial_sequence('public.inventory_returns', 'id')::regclass);
  v_return_number := CASE WHEN p_return_type = 'sales' THEN 'SRET-' ELSE 'PRET-' END
    || TO_CHAR(v_return_date, 'YYYYMMDD') || '-' || LPAD(v_return_id::TEXT, 6, '0');

  INSERT INTO inventory_returns (
    id, company_id, return_number, return_type, reference_invoice_id, reference_receipt_id,
    customer_id, supplier_id, return_date, reason, notes, created_by
  ) VALUES (
    v_return_id, p_company_id, v_return_number, p_return_type,
    CASE WHEN p_return_type = 'sales' THEN p_reference_id ELSE NULL END,
    CASE WHEN p_return_type = 'purchase' THEN p_reference_id ELSE NULL END,
    v_customer_id, v_supplier_id,
    v_return_date, BTRIM(p_reason), NULLIF(BTRIM(p_notes), ''), p_user_id
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item.value->>'source_item_id', '')::BIGINT;
    v_quantity := NULLIF(v_item.value->>'quantity', '')::INTEGER;
    IF v_item_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'بيانات صنف المرتجع غير صحيحة';
    END IF;

    IF p_return_type = 'sales' THEN
      SELECT id, product_id, batch_id, quantity,
        COALESCE(NULLIF(total, 0) / NULLIF(quantity, 0), unit_price)::NUMERIC(14,4),
        COALESCE(cost_price, 0)::NUMERIC(14,4)
      INTO v_item_id, v_product_id, v_batch_id, v_source_quantity, v_unit_price, v_unit_cost
      FROM sales_invoice_items
      WHERE id = NULLIF(v_item.value->>'source_item_id', '')::BIGINT
        AND invoice_id = p_reference_id
      FOR UPDATE;
    ELSE
      SELECT ri.id, ri.product_id, b.id AS batch_id, ri.quantity,
        COALESCE(NULLIF(ri.total, 0) / NULLIF(ri.quantity, 0), ri.unit_price)::NUMERIC(14,4)
      INTO v_item_id, v_product_id, v_batch_id, v_source_quantity, v_unit_price
      FROM receipt_items ri
      JOIN batches b
        ON b.receipt_id = ri.receipt_id
       AND b.product_id = ri.product_id
       AND COALESCE(b.batch_number, '') = COALESCE(ri.batch_number, '')
       AND b.company_id = p_company_id
      WHERE ri.id = NULLIF(v_item.value->>'source_item_id', '')::BIGINT
        AND ri.receipt_id = p_reference_id
      FOR UPDATE OF ri, b;
    END IF;

    IF NOT FOUND THEN RAISE EXCEPTION 'صنف غير موجود في المستند الأصلي أو لا توجد تشغيلة مرتبطة به'; END IF;
    IF p_return_type = 'purchase' THEN
      v_unit_cost := v_unit_price;
    END IF;
    IF p_return_type = 'sales' AND v_batch_id IS NULL THEN
      RAISE EXCEPTION 'لا يمكن إرجاع صنف فاتورته الأصلية غير مرتبطة بتشغيلة';
    END IF;

    SELECT COALESCE(SUM(ri.quantity), 0)::INTEGER INTO v_returned_quantity
    FROM inventory_return_items ri
    JOIN inventory_returns r ON r.id = ri.return_id
    WHERE r.return_type = p_return_type
      AND ri.source_item_id = v_item_id
      AND ((p_return_type = 'sales' AND r.reference_invoice_id = p_reference_id)
        OR (p_return_type = 'purchase' AND r.reference_receipt_id = p_reference_id));

    IF v_quantity + v_returned_quantity > v_source_quantity THEN
      RAISE EXCEPTION 'الكمية المرتجعة تتجاوز الكمية المتبقية في المستند الأصلي';
    END IF;

    IF p_return_type = 'purchase' THEN
      UPDATE batches
      SET quantity_left = quantity_left - v_quantity
      WHERE id = v_batch_id AND company_id = p_company_id AND quantity_left >= v_quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'الكمية المتاحة في التشغيلة أقل من كمية المرتجع'; END IF;
    ELSE
      UPDATE batches
      SET quantity_left = quantity_left + v_quantity
      WHERE id = v_batch_id AND company_id = p_company_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'تشغيلة الصنف غير موجودة'; END IF;
    END IF;

    v_line_total := ROUND(v_quantity * v_unit_price, 2);
    INSERT INTO inventory_return_items (
      return_id, source_item_id, product_id, batch_id, quantity, unit_price, total
    ) VALUES (
      v_return_id, v_item_id, v_product_id, v_batch_id, v_quantity, v_unit_price, v_line_total
    );
    v_total := v_total + v_line_total;

    INSERT INTO inventory_movements (
      company_id, product_id, batch_id, movement_type, reference_type, reference_id,
      quantity, unit_cost, notes, user_id
    ) VALUES (
      p_company_id, v_product_id, v_batch_id,
      CASE WHEN p_return_type = 'sales' THEN 'return' ELSE 'out' END,
      'return', v_return_id, v_quantity, v_unit_cost,
      CASE WHEN p_return_type = 'sales' THEN 'مرتجع مبيعات ' || v_return_number
           ELSE 'مرتجع مشتريات ' || v_return_number END,
      p_user_id
    );
  END LOOP;

  UPDATE inventory_returns SET total_amount = v_total WHERE id = v_return_id;

  IF p_return_type = 'sales' THEN
    IF v_customer_id IS NOT NULL THEN
      UPDATE customers SET balance = COALESCE(balance, 0) - v_total
      WHERE id = v_customer_id AND company_id = p_company_id;
    ELSIF v_supplier_id IS NOT NULL THEN
      UPDATE suppliers SET balance = COALESCE(balance, 0) + v_total
      WHERE id = v_supplier_id AND company_id = p_company_id
      RETURNING balance INTO v_balance;
      INSERT INTO supplier_transactions (
        supplier_id, company_id, type, amount, balance_after, reference_id, notes, user_id
      ) VALUES (
        v_supplier_id, p_company_id, 'return', v_total, v_balance, v_return_id,
        'مرتجع فاتورة بيع ' || v_return_number, p_user_id
      );
    END IF;
  ELSIF v_supplier_id IS NOT NULL THEN
    UPDATE suppliers
    SET balance = COALESCE(balance, 0) - v_total
    WHERE id = v_supplier_id AND company_id = p_company_id
    RETURNING balance INTO v_balance;

    INSERT INTO supplier_transactions (
      supplier_id, company_id, type, amount, balance_after, reference_id, notes, user_id
    ) VALUES (
      v_supplier_id, p_company_id, 'return', v_total, v_balance, v_return_id,
      'مرتجع مشتريات ' || v_return_number, p_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_return_id,
    'return_number', v_return_number,
    'return_type', p_return_type,
    'total_amount', v_total
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION process_inventory_return(BIGINT, TEXT, BIGINT, DATE, TEXT, TEXT, BIGINT, JSONB)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
