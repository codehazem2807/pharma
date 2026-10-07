-- ============================================================
-- Refad ERP - Purchase Intelligence Functions
-- شغّله مرة واحدة
-- ============================================================

BEGIN;

-- 1) دالة: معلومات المورد الشاملة
CREATE OR REPLACE FUNCTION get_supplier_full_profile(
  p_supplier_id BIGINT,
  p_company_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_supplier RECORD;
  v_stats RECORD;
  v_month_stats RECORD;
  v_top_products JSONB;
BEGIN
  SELECT id, name, phone, email, address, tax_number, balance, is_active, created_at
  INTO v_supplier
  FROM suppliers
  WHERE id = p_supplier_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  SELECT
    COUNT(*)::INTEGER AS total_receipts,
    COALESCE(SUM(total_amount), 0)::NUMERIC AS total_purchased,
    COALESCE(SUM(paid_amount), 0)::NUMERIC AS total_paid,
    COALESCE(AVG(total_amount), 0)::NUMERIC AS avg_receipt,
    MAX(receipt_date) AS last_receipt_date,
    MIN(receipt_date) AS first_receipt_date,
    COUNT(DISTINCT receipt_date) AS active_days
  INTO v_stats
  FROM receipts
  WHERE supplier_id = p_supplier_id
    AND company_id = p_company_id
    AND status <> 'cancelled';

  -- آخر 30 يوم
  SELECT
    COUNT(*)::INTEGER AS count_30d,
    COALESCE(SUM(total_amount), 0)::NUMERIC AS sum_30d
  INTO v_month_stats
  FROM receipts
  WHERE supplier_id = p_supplier_id
    AND company_id = p_company_id
    AND status <> 'cancelled'
    AND receipt_date >= CURRENT_DATE - INTERVAL '30 days';

  -- أفضل الأصناف الموردة
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', t.product_id,
    'product_name', t.product_name,
    'total_qty', t.total_qty,
    'avg_price', t.avg_price,
    'last_price', t.last_price,
    'best_discount', t.best_discount
  ))
  INTO v_top_products
  FROM (
    SELECT
      ri.product_id,
      p.name AS product_name,
      SUM(ri.quantity)::INTEGER AS total_qty,
      ROUND(AVG(ri.unit_price)::NUMERIC, 2) AS avg_price,
      (SELECT unit_price FROM receipt_items ri2
       JOIN receipts r2 ON r2.id = ri2.receipt_id
       WHERE ri2.product_id = ri.product_id
         AND r2.supplier_id = p_supplier_id
         AND r2.company_id = p_company_id
       ORDER BY r2.receipt_date DESC LIMIT 1) AS last_price,
      MAX(ri.purchase_discount) AS best_discount
    FROM receipt_items ri
    JOIN receipts r ON r.id = ri.receipt_id
    JOIN products p ON p.id = ri.product_id
    WHERE r.supplier_id = p_supplier_id
      AND r.company_id = p_company_id
      AND r.status <> 'cancelled'
    GROUP BY ri.product_id, p.name
    ORDER BY SUM(ri.quantity) DESC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'found', TRUE,
    'supplier', jsonb_build_object(
      'id', v_supplier.id,
      'name', v_supplier.name,
      'phone', v_supplier.phone,
      'email', v_supplier.email,
      'address', v_supplier.address,
      'tax_number', v_supplier.tax_number,
      'balance', v_supplier.balance,
      'is_active', v_supplier.is_active,
      'member_since', v_supplier.created_at
    ),
    'stats', jsonb_build_object(
      'total_receipts', v_stats.total_receipts,
      'total_purchased', v_stats.total_purchased,
      'total_paid', v_stats.total_paid,
      'remaining', v_stats.total_purchased - v_stats.total_paid,
      'avg_receipt', ROUND(v_stats.avg_receipt, 2),
      'last_receipt_date', v_stats.last_receipt_date,
      'first_receipt_date', v_stats.first_receipt_date,
      'active_days', v_stats.active_days,
      'count_30d', v_month_stats.count_30d,
      'sum_30d', v_month_stats.sum_30d
    ),
    'top_products', COALESCE(v_top_products, '[]'::JSONB)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_supplier_full_profile(BIGINT, BIGINT) TO anon, authenticated;

-- 2) دالة: مقارنة الأسعار بين الموردين لصنف معين
CREATE OR REPLACE FUNCTION compare_product_prices(
  p_product_id BIGINT,
  p_company_id BIGINT,
  p_days INTEGER DEFAULT 365
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'supplier_id', t.supplier_id,
    'supplier_name', t.supplier_name,
    'last_price', t.last_price,
    'last_discount', t.last_discount,
    'best_price', t.best_price,
    'best_discount', t.best_discount,
    'avg_price', t.avg_price,
    'net_price', t.net_price,
    'total_qty', t.total_qty,
    'last_date', t.last_date
  ) ORDER BY t.net_price ASC)
  INTO v_result
  FROM (
    SELECT
      s.id AS supplier_id,
      s.name AS supplier_name,
      (SELECT ri2.unit_price FROM receipt_items ri2
       JOIN receipts r2 ON r2.id = ri2.receipt_id
       WHERE ri2.product_id = p_product_id
         AND r2.supplier_id = s.id
         AND r2.company_id = p_company_id
       ORDER BY r2.receipt_date DESC LIMIT 1) AS last_price,
      (SELECT ri2.purchase_discount FROM receipt_items ri2
       JOIN receipts r2 ON r2.id = ri2.receipt_id
       WHERE ri2.product_id = p_product_id
         AND r2.supplier_id = s.id
         AND r2.company_id = p_company_id
       ORDER BY r2.receipt_date DESC LIMIT 1) AS last_discount,
      MIN(ri.unit_price) AS best_price,
      MAX(ri.purchase_discount) AS best_discount,
      ROUND(AVG(ri.unit_price)::NUMERIC, 2) AS avg_price,
      ROUND(AVG(ri.unit_price * (1 - COALESCE(ri.purchase_discount,0)/100))::NUMERIC, 2) AS net_price,
      SUM(ri.quantity)::INTEGER AS total_qty,
      MAX(r.receipt_date) AS last_date
    FROM receipt_items ri
    JOIN receipts r ON r.id = ri.receipt_id
    JOIN suppliers s ON s.id = r.supplier_id
    WHERE ri.product_id = p_product_id
      AND r.company_id = p_company_id
      AND r.status <> 'cancelled'
      AND r.receipt_date >= CURRENT_DATE - (p_days || ' days')::INTERVAL
    GROUP BY s.id, s.name
  ) t;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION compare_product_prices(BIGINT, BIGINT, INTEGER) TO anon, authenticated;

-- 3) دالة: تحليل كامل للمنتج للشراء
CREATE OR REPLACE FUNCTION get_product_purchase_analysis(
  p_product_id BIGINT,
  p_company_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_stock INTEGER;
  v_sales_30 INTEGER;
  v_sales_90 INTEGER;
  v_sales_180 INTEGER;
  v_avg_cost NUMERIC;
  v_last_cost NUMERIC;
  v_abc VARCHAR(1);
  v_total_sold_value NUMERIC;
  v_company_total NUMERIC;
BEGIN
  SELECT id, name, name_en, form, unit, default_price, reorder_level, min_order_qty, category
  INTO v_product
  FROM products
  WHERE id = p_product_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', FALSE);
  END IF;

  -- المخزون الحالي
  SELECT COALESCE(SUM(quantity_left), 0)::INTEGER INTO v_stock
  FROM batches
  WHERE product_id = p_product_id AND company_id = p_company_id;

  -- المبيعات
  SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_sales_30
  FROM sales_invoice_items sii
  JOIN sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.product_id = p_product_id
    AND si.company_id = p_company_id
    AND si.invoice_date >= CURRENT_DATE - INTERVAL '30 days'
    AND si.status <> 'cancelled';

  SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_sales_90
  FROM sales_invoice_items sii
  JOIN sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.product_id = p_product_id
    AND si.company_id = p_company_id
    AND si.invoice_date >= CURRENT_DATE - INTERVAL '90 days'
    AND si.status <> 'cancelled';

  SELECT COALESCE(SUM(quantity), 0)::INTEGER INTO v_sales_180
  FROM sales_invoice_items sii
  JOIN sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.product_id = p_product_id
    AND si.company_id = p_company_id
    AND si.invoice_date >= CURRENT_DATE - INTERVAL '180 days'
    AND si.status <> 'cancelled';

  -- آخر سعر شراء
  SELECT unit_price INTO v_last_cost
  FROM receipt_items ri
  JOIN receipts r ON r.id = ri.receipt_id
  WHERE ri.product_id = p_product_id AND r.company_id = p_company_id
  ORDER BY r.receipt_date DESC LIMIT 1;

  -- متوسط سعر الشراء
  SELECT ROUND(AVG(unit_price)::NUMERIC, 2) INTO v_avg_cost
  FROM receipt_items ri
  JOIN receipts r ON r.id = ri.receipt_id
  WHERE ri.product_id = p_product_id
    AND r.company_id = p_company_id
    AND r.receipt_date >= CURRENT_DATE - INTERVAL '180 days';

  -- ABC Analysis
  SELECT COALESCE(SUM(sii.quantity * sii.unit_price), 0)
  INTO v_total_sold_value
  FROM sales_invoice_items sii
  JOIN sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.product_id = p_product_id
    AND si.company_id = p_company_id
    AND si.invoice_date >= CURRENT_DATE - INTERVAL '365 days';

  SELECT COALESCE(SUM(sii.quantity * sii.unit_price), 0)
  INTO v_company_total
  FROM sales_invoice_items sii
  JOIN sales_invoices si ON si.id = sii.invoice_id
  WHERE si.company_id = p_company_id
    AND si.invoice_date >= CURRENT_DATE - INTERVAL '365 days';

  IF v_company_total > 0 THEN
    IF v_total_sold_value / v_company_total >= 0.05 THEN v_abc := 'A';
    ELSIF v_total_sold_value / v_company_total >= 0.01 THEN v_abc := 'B';
    ELSE v_abc := 'C';
    END IF;
  ELSE
    v_abc := 'C';
  END IF;

  RETURN jsonb_build_object(
    'found', TRUE,
    'product', jsonb_build_object(
      'id', v_product.id,
      'name', v_product.name,
      'form', v_product.form,
      'unit', v_product.unit,
      'default_price', v_product.default_price,
      'reorder_level', v_product.reorder_level,
      'min_order_qty', v_product.min_order_qty,
      'category', v_product.category
    ),
    'stock', v_stock,
    'sales', jsonb_build_object(
      'last_30', v_sales_30,
      'last_90', v_sales_90,
      'last_180', v_sales_180,
      'daily_rate', ROUND(v_sales_90::NUMERIC / 90, 2),
      'monthly_rate', ROUND(v_sales_90::NUMERIC / 3, 0)
    ),
    'cost', jsonb_build_object(
      'last_cost', v_last_cost,
      'avg_cost_180d', v_avg_cost
    ),
    'abc_class', v_abc,
    'revenue_value', ROUND(v_total_sold_value, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_product_purchase_analysis(BIGINT, BIGINT) TO anon, authenticated;

-- 4) دالة: أصناف تحتاج شراء عاجل
CREATE OR REPLACE FUNCTION get_urgent_purchase_items(
  p_company_id BIGINT,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', t.id,
    'name', t.name,
    'form', t.form,
    'unit', t.unit,
    'current_stock', t.current_stock,
    'reorder_level', t.reorder_level,
    'daily_rate', t.daily_rate,
    'days_remaining', t.days_remaining,
    'urgency', t.urgency,
    'last_cost', t.last_cost
  ) ORDER BY t.days_remaining ASC NULLS LAST)
  INTO v_result
  FROM (
    SELECT
      p.id, p.name, p.form, p.unit, p.reorder_level,
      COALESCE((SELECT SUM(quantity_left) FROM batches WHERE product_id = p.id AND company_id = p_company_id AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)), 0)::INTEGER AS current_stock,
      COALESCE((SELECT SUM(quantity) FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id WHERE sii.product_id = p.id AND si.company_id = p_company_id AND si.invoice_date >= CURRENT_DATE - INTERVAL '90 days' AND si.status <> 'cancelled'), 0)::NUMERIC / 90 AS daily_rate,
      CASE
        WHEN COALESCE((SELECT SUM(quantity) FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id WHERE sii.product_id = p.id AND si.company_id = p_company_id AND si.invoice_date >= CURRENT_DATE - INTERVAL '90 days' AND si.status <> 'cancelled'), 0) > 0
        THEN FLOOR(
          COALESCE((SELECT SUM(quantity_left) FROM batches WHERE product_id = p.id AND company_id = p_company_id AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)), 0)::NUMERIC /
          NULLIF(COALESCE((SELECT SUM(quantity) FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id WHERE sii.product_id = p.id AND si.company_id = p_company_id AND si.invoice_date >= CURRENT_DATE - INTERVAL '90 days' AND si.status <> 'cancelled'), 0) / 90, 0)
        )::INTEGER
        ELSE NULL
      END AS days_remaining,
      CASE
        WHEN COALESCE((SELECT SUM(quantity_left) FROM batches WHERE product_id = p.id AND company_id = p_company_id AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)), 0) <= p.reorder_level THEN 'critical'
        WHEN FLOOR(COALESCE((SELECT SUM(quantity_left) FROM batches WHERE product_id = p.id AND company_id = p_company_id AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)), 0)::NUMERIC / NULLIF(COALESCE((SELECT SUM(quantity) FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id WHERE sii.product_id = p.id AND si.company_id = p_company_id AND si.invoice_date >= CURRENT_DATE - INTERVAL '90 days' AND si.status <> 'cancelled'), 0) / 90, 0)) <= 15 THEN 'urgent'
        WHEN FLOOR(COALESCE((SELECT SUM(quantity_left) FROM batches WHERE product_id = p.id AND company_id = p_company_id AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)), 0)::NUMERIC / NULLIF(COALESCE((SELECT SUM(quantity) FROM sales_invoice_items sii JOIN sales_invoices si ON si.id = sii.invoice_id WHERE sii.product_id = p.id AND si.company_id = p_company_id AND si.invoice_date >= CURRENT_DATE - INTERVAL '90 days' AND si.status <> 'cancelled'), 0) / 90, 0)) <= 30 THEN 'soon'
        ELSE 'ok'
      END AS urgency,
      (SELECT unit_price FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id WHERE ri.product_id = p.id AND r.company_id = p_company_id ORDER BY r.receipt_date DESC LIMIT 1) AS last_cost
    FROM products p
    WHERE p.company_id = p_company_id AND p.is_active = true
      AND COALESCE((SELECT SUM(quantity_left) FROM batches WHERE product_id = p.id AND company_id = p_company_id AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)), 0) <= COALESCE(p.reorder_level, 10) * 2
    ORDER BY days_remaining ASC NULLS LAST
    LIMIT p_limit
  ) t;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

GRANT EXECUTE ON FUNCTION get_urgent_purchase_items(BIGINT, INTEGER) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';