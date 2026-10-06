-- Run once in Supabase SQL Editor to enable invoice settlements with sales representatives.

CREATE TABLE IF NOT EXISTS representative_settlements (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  representative_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invoice_id BIGINT NOT NULL REFERENCES sales_invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes VARCHAR(255),
  received_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_settlements_company_date
  ON representative_settlements(company_id, settlement_date DESC);
CREATE INDEX IF NOT EXISTS idx_rep_settlements_invoice
  ON representative_settlements(invoice_id);
CREATE INDEX IF NOT EXISTS idx_rep_settlements_representative
  ON representative_settlements(representative_id, settlement_date DESC);

CREATE OR REPLACE FUNCTION settle_representative_invoice(
  p_company_id BIGINT,
  p_user_id BIGINT,
  p_invoice_id BIGINT,
  p_representative_id BIGINT,
  p_amount NUMERIC,
  p_settlement_date DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_user_company_id BIGINT;
  v_is_owner BOOLEAN;
  v_invoice sales_invoices%ROWTYPE;
  v_representative_company_id BIGINT;
  v_due NUMERIC(14,2);
  v_paid NUMERIC(14,2);
  v_settlement_id BIGINT;
  v_status VARCHAR(20);
BEGIN
  SELECT u.company_id, r.is_owner
    INTO v_user_company_id, v_is_owner
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id AND r.company_id = p_company_id
  WHERE u.id = p_user_id AND u.is_active = TRUE;

  IF NOT FOUND OR v_user_company_id IS DISTINCT FROM p_company_id OR v_is_owner IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'تسجيل التسويات متاح لصاحب الشركة فقط';
  END IF;

  SELECT company_id INTO v_representative_company_id
  FROM users
  WHERE id = p_representative_id;
  IF NOT FOUND OR v_representative_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'المندوب لا يتبع الشركة الحالية';
  END IF;

  SELECT * INTO v_invoice
  FROM sales_invoices
  WHERE id = p_invoice_id
    AND company_id = p_company_id
    AND cashier_id = p_representative_id
    AND (invoice_type IS NULL OR invoice_type = 'sale')
    AND status <> 'cancelled'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة أو غير مرتبطة بهذا المندوب أو ملغاة';
  END IF;

  v_due := ROUND(COALESCE(v_invoice.grand_total, 0)::NUMERIC - COALESCE(v_invoice.paid_amount, 0)::NUMERIC, 2);
  IF v_due <= 0 THEN
    RAISE EXCEPTION 'الفاتورة مسددة بالفعل';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR ROUND(p_amount, 2) > v_due THEN
    RAISE EXCEPTION 'مبلغ التحصيل يجب أن يكون أكبر من صفر ولا يتجاوز المتبقي %', v_due;
  END IF;

  v_paid := ROUND(COALESCE(v_invoice.paid_amount, 0)::NUMERIC + ROUND(p_amount, 2), 2);
  v_status := CASE
    WHEN v_paid >= COALESCE(v_invoice.grand_total, 0)::NUMERIC THEN 'paid'
    WHEN v_paid > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  INSERT INTO representative_settlements (
    company_id, representative_id, invoice_id, amount, settlement_date, notes, received_by
  ) VALUES (
    p_company_id, p_representative_id, p_invoice_id, ROUND(p_amount, 2),
    COALESCE(p_settlement_date, CURRENT_DATE), NULLIF(BTRIM(p_notes), ''), p_user_id
  ) RETURNING id INTO v_settlement_id;

  UPDATE sales_invoices
  SET paid_amount = v_paid,
      status = v_status,
      updated_at = NOW()
  WHERE id = p_invoice_id;

  IF v_invoice.customer_id IS NOT NULL THEN
    UPDATE customers
    SET balance = COALESCE(balance, 0) - ROUND(p_amount, 2),
        updated_at = NOW()
    WHERE id = v_invoice.customer_id AND company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object(
    'settlement_id', v_settlement_id,
    'invoice_id', p_invoice_id,
    'paid_amount', v_paid,
    'remaining_amount', GREATEST(0, ROUND(COALESCE(v_invoice.grand_total, 0)::NUMERIC - v_paid, 2)),
    'status', v_status
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION settle_representative_invoice(BIGINT, BIGINT, BIGINT, BIGINT, NUMERIC, DATE, TEXT)
  TO anon, authenticated;
