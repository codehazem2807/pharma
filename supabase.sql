
-- ============================================================
-- Refad ERP System - Complete Database Schema
-- Version: 1.0
-- No RLS, No Auth, Plain Text Passwords
-- Space-Optimized: BIGSERIAL, SMALLINT, REAL, VARCHAR(n)
-- ============================================================

-- تنظيف كامل (احتياطي)
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- ============================================================
-- 1) الجداول الأساسية: الشركات، الأدوار، الصلاحيات، المستخدمين
-- ============================================================

-- الشركات
CREATE TABLE companies (
  id              BIGSERIAL PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  logo_url        VARCHAR(255),
  phone           VARCHAR(30),
  email           VARCHAR(120),
  address         VARCHAR(255),
  tax_number      VARCHAR(50),
  is_active       BOOLEAN DEFAULT TRUE,
  subscription_end DATE,
  notes           VARCHAR(255),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- الأدوار
CREATE TABLE roles (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  name            VARCHAR(60) NOT NULL,
  name_ar         VARCHAR(60),
  description     VARCHAR(200),
  is_system       BOOLEAN DEFAULT FALSE,
  is_owner        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_roles_company ON roles(company_id);

-- الصلاحيات (Action-Level)
CREATE TABLE permissions (
  id              BIGSERIAL PRIMARY KEY,
  code            VARCHAR(60) UNIQUE NOT NULL,
  name_ar         VARCHAR(100) NOT NULL,
  module          VARCHAR(40) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_permissions_module ON permissions(module);

-- ربط الأدوار بالصلاحيات
CREATE TABLE role_permissions (
  role_id         BIGINT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id   BIGINT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- المستخدمين
CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  role_id         BIGINT REFERENCES roles(id) ON DELETE SET NULL,
  username        VARCHAR(50) UNIQUE NOT NULL,
  password        VARCHAR(100) NOT NULL,  -- نص عادي
  full_name       VARCHAR(120) NOT NULL,
  phone           VARCHAR(30),
  email           VARCHAR(120),
  avatar_url      VARCHAR(255),
  is_active       BOOLEAN DEFAULT TRUE,
  has_device      BOOLEAN DEFAULT TRUE,  -- موظف بجهاز أو عامل
  theme           VARCHAR(10) DEFAULT 'light',  -- light/dark
  failed_attempts SMALLINT DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login      TIMESTAMPTZ,
  salary          REAL DEFAULT 0,
  hire_date       DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_username ON users(username);

-- ============================================================
-- 2) الأصناف والباركود والخصومات
-- ============================================================

-- الأصناف
CREATE TABLE products (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  name_en         VARCHAR(200),
  form            VARCHAR(30),  -- شراب/أقراص/كبسولات/أمبولات/مرهم
  unit            VARCHAR(30),  -- علبة/شريط/زجاجة
  category        VARCHAR(80),
  min_order_qty   SMALLINT DEFAULT 1,
  reorder_level   SMALLINT DEFAULT 10,
  default_price   REAL DEFAULT 0,
  notes           VARCHAR(255),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_products_company ON products(company_id);
CREATE INDEX idx_products_name ON products(name);

-- باركود الأصناف (يدعم أكثر من باركود لكل صنف)
CREATE TABLE product_barcodes (
  id              BIGSERIAL PRIMARY KEY,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  barcode         VARCHAR(50) UNIQUE NOT NULL,
  is_primary      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_barcodes_product ON product_barcodes(product_id);
CREATE INDEX idx_barcodes_code ON product_barcodes(barcode);

-- خصومات الأصناف (شراء + بيع)
CREATE TABLE product_discounts (
  id                    BIGSERIAL PRIMARY KEY,
  product_id            BIGINT REFERENCES products(id) ON DELETE CASCADE UNIQUE,
  -- خصومات الشراء
  last_purchase_discount  REAL DEFAULT 0,
  max_purchase_discount   REAL DEFAULT 0,
  min_purchase_discount   REAL DEFAULT 0,
  -- خصومات البيع
  last_sale_discount      REAL DEFAULT 0,
  max_sale_discount       REAL DEFAULT 0,
  min_sale_discount       REAL DEFAULT 0,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3) الموردين والعملاء
-- ============================================================

CREATE TABLE suppliers (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  phone           VARCHAR(30),
  email           VARCHAR(120),
  address         VARCHAR(255),
  tax_number      VARCHAR(50),
  balance         REAL DEFAULT 0,  -- + له / - عليه
  notes           VARCHAR(255),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_suppliers_company ON suppliers(company_id);

CREATE TABLE supplier_transactions (
  id              BIGSERIAL PRIMARY KEY,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE CASCADE,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  type            VARCHAR(20) NOT NULL,  -- payment/invoice/adjustment
  amount          REAL NOT NULL,
  balance_after   REAL,
  reference_id    BIGINT,
  notes           VARCHAR(255),
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_supplier_trans_supplier ON supplier_transactions(supplier_id);

CREATE TABLE customers (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  phone           VARCHAR(30),
  email           VARCHAR(120),
  address         VARCHAR(255),
  balance         REAL DEFAULT 0,
  notes           VARCHAR(255),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_customers_company ON customers(company_id);

-- ============================================================
-- 4) طلبات الشراء
-- ============================================================

CREATE TABLE purchase_requests (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  request_number  VARCHAR(30) NOT NULL,
  status          VARCHAR(20) DEFAULT 'draft',  -- draft/sent/partial/received/cancelled
  total_amount    REAL DEFAULT 0,
  notes           VARCHAR(500),
  share_token     VARCHAR(64) UNIQUE,
  share_expires   TIMESTAMPTZ,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pr_company ON purchase_requests(company_id);
CREATE INDEX idx_pr_status ON purchase_requests(status);
CREATE INDEX idx_pr_token ON purchase_requests(share_token);

CREATE TABLE purchase_request_items (
  id              BIGSERIAL PRIMARY KEY,
  request_id      BIGINT REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  requested_qty   INTEGER NOT NULL DEFAULT 0,
  received_qty    INTEGER DEFAULT 0,
  avg_sale_rate   REAL DEFAULT 0,
  last_discount   REAL DEFAULT 0,
  requested_discount REAL DEFAULT 0,
  supplier_price  REAL,
  supplier_discount REAL,
  supplier_response_at TIMESTAMPTZ,
  notes           VARCHAR(255)
);
CREATE INDEX idx_pri_request ON purchase_request_items(request_id);
CREATE INDEX idx_pri_product ON purchase_request_items(product_id);

CREATE TABLE purchase_request_responses (
  id              BIGSERIAL PRIMARY KEY,
  request_id      BIGINT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_price  REAL,
  supplier_discount REAL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_prr_request ON purchase_request_responses(request_id, submitted_at DESC);

-- ============================================================
-- 5) الاستلامات (Receipts) والتشغيلات (Batches)
-- ============================================================

CREATE TABLE receipts (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  request_id      BIGINT REFERENCES purchase_requests(id) ON DELETE SET NULL,
  receipt_number  VARCHAR(30) NOT NULL,
  invoice_number  VARCHAR(50),
  total_amount    REAL DEFAULT 0,
  paid_amount     REAL DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'completed',
  notes           VARCHAR(500),
  received_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  receipt_date    DATE DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_receipts_company ON receipts(company_id);
CREATE INDEX idx_receipts_supplier ON receipts(supplier_id);

CREATE TABLE receipt_items (
  id              BIGSERIAL PRIMARY KEY,
  receipt_id      BIGINT REFERENCES receipts(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL DEFAULT 0,
  unit_price      REAL DEFAULT 0,
  discount        REAL DEFAULT 0,
  purchase_discount REAL DEFAULT 0,
  expiry_date     DATE,
  batch_number    VARCHAR(50),
  total           REAL DEFAULT 0
);
CREATE INDEX idx_ri_receipt ON receipt_items(receipt_id);
CREATE INDEX idx_ri_product ON receipt_items(product_id);

-- التشغيلات (Batches) — تُنشأ تلقائياً من الاستلام
CREATE TABLE batches (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  receipt_id      BIGINT REFERENCES receipts(id) ON DELETE SET NULL,
  batch_number    VARCHAR(50),
  quantity_in     INTEGER NOT NULL DEFAULT 0,
  quantity_left   INTEGER NOT NULL DEFAULT 0,
  cost_price      REAL DEFAULT 0,
  sale_price      REAL DEFAULT 0,
  purchase_discount REAL DEFAULT 0,
  expiry_date     DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_batches_product ON batches(product_id);
CREATE INDEX idx_batches_expiry ON batches(expiry_date);
CREATE INDEX idx_batches_company ON batches(company_id);

-- ============================================================
-- 6) المبيعات والفواتير
-- ============================================================

CREATE TABLE sales_orders (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  customer_id     BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  order_number    VARCHAR(30) NOT NULL,
  status          VARCHAR(20) DEFAULT 'draft',  -- draft/confirmed/invoiced/cancelled
  total_amount    REAL DEFAULT 0,
  total_profit    REAL DEFAULT 0,
  notes           VARCHAR(500),
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_so_company ON sales_orders(company_id);
CREATE INDEX idx_so_status ON sales_orders(status);
CREATE INDEX idx_so_supplier ON sales_orders(supplier_id);

CREATE TABLE sales_order_items (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  batch_id        BIGINT REFERENCES batches(id) ON DELETE SET NULL,
  quantity        INTEGER NOT NULL DEFAULT 0,
  unit_price      REAL DEFAULT 0,
  discount        REAL DEFAULT 0,
  sale_discount   REAL DEFAULT 0,
  cost_price      REAL DEFAULT 0,
  profit          REAL DEFAULT 0,
  total           REAL DEFAULT 0
);
CREATE INDEX idx_soi_order ON sales_order_items(order_id);

CREATE TABLE sales_invoices (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  customer_id     BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  order_id        BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL,
  invoice_number  VARCHAR(30) NOT NULL,
  invoice_type    VARCHAR(20) DEFAULT 'sale',  -- sale/return
  payment_type    VARCHAR(20) DEFAULT 'cash',  -- cash/credit
  subtotal        REAL DEFAULT 0,
  discount_total  REAL DEFAULT 0,
  tax_total       REAL DEFAULT 0,
  grand_total     REAL DEFAULT 0,
  total_profit    REAL DEFAULT 0,
  paid_amount     REAL DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'paid',  -- paid/partial/unpaid/cancelled
  notes           VARCHAR(500),
  cashier_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  invoice_date    DATE DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_si_company ON sales_invoices(company_id);
CREATE INDEX idx_si_customer ON sales_invoices(customer_id);
CREATE INDEX idx_si_supplier ON sales_invoices(supplier_id);
CREATE INDEX idx_si_date ON sales_invoices(invoice_date);

CREATE TABLE sales_invoice_items (
  id              BIGSERIAL PRIMARY KEY,
  invoice_id      BIGINT REFERENCES sales_invoices(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  batch_id        BIGINT REFERENCES batches(id) ON DELETE SET NULL,
  quantity        INTEGER NOT NULL DEFAULT 0,
  unit_price      REAL DEFAULT 0,
  discount        REAL DEFAULT 0,
  sale_discount   REAL DEFAULT 0,
  cost_price      REAL DEFAULT 0,
  profit          REAL DEFAULT 0,
  total           REAL DEFAULT 0
);
CREATE INDEX idx_sii_invoice ON sales_invoice_items(invoice_id);
CREATE INDEX idx_sii_product ON sales_invoice_items(product_id);

-- ============================================================
-- 7) حركات المخزون والتسويات والجرد
-- ============================================================

CREATE TABLE inventory_movements (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  batch_id        BIGINT REFERENCES batches(id) ON DELETE SET NULL,
  movement_type   VARCHAR(20) NOT NULL,  -- in/out/adjust/loss/return
  reference_type  VARCHAR(30),  -- receipt/invoice/adjustment/stocktake
  reference_id    BIGINT,
  quantity        INTEGER NOT NULL,
  unit_cost       REAL DEFAULT 0,
  balance_after   INTEGER DEFAULT 0,
  notes           VARCHAR(255),
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_im_company ON inventory_movements(company_id);
CREATE INDEX idx_im_product ON inventory_movements(product_id);
CREATE INDEX idx_im_type ON inventory_movements(movement_type);
CREATE INDEX idx_im_date ON inventory_movements(created_at);

CREATE TABLE stock_adjustments (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  adjustment_number VARCHAR(30) NOT NULL,
  type            VARCHAR(20) NOT NULL,  -- damage/loss/count_diff/expiry
  status          VARCHAR(20) DEFAULT 'pending',  -- pending/approved
  notes           VARCHAR(500),
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sa_company ON stock_adjustments(company_id);

CREATE TABLE stock_adjustment_items (
  id              BIGSERIAL PRIMARY KEY,
  adjustment_id   BIGINT REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  product_id      BIGINT REFERENCES products(id) ON DELETE CASCADE,
  batch_id        BIGINT REFERENCES batches(id) ON DELETE SET NULL,
  system_qty      INTEGER DEFAULT 0,
  actual_qty      INTEGER DEFAULT 0,
  difference      INTEGER DEFAULT 0,
  unit_cost       REAL DEFAULT 0,
  notes           VARCHAR(255)
);

-- ============================================================
-- 8) الحضور والرواتب
-- ============================================================

CREATE TABLE attendance (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  att_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in        TIMESTAMPTZ,
  check_out       TIMESTAMPTZ,
  work_hours      REAL DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'present',  -- present/absent/late/leave
  notes           VARCHAR(255),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, att_date)
);
CREATE INDEX idx_att_company ON attendance(company_id);
CREATE INDEX idx_att_date ON attendance(att_date);

CREATE TABLE payroll (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  month           SMALLINT NOT NULL,  -- 1-12
  year            SMALLINT NOT NULL,
  basic_salary    REAL DEFAULT 0,
  deductions      REAL DEFAULT 0,
  bonuses         REAL DEFAULT 0,
  overtime        REAL DEFAULT 0,
  net_salary      REAL DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'pending',  -- pending/paid
  paid_at         TIMESTAMPTZ,
  notes           VARCHAR(255),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month, year)
);
CREATE INDEX idx_payroll_company ON payroll(company_id);

CREATE TABLE deductions (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  amount          REAL NOT NULL,
  reason          VARCHAR(200),
  ded_date        DATE DEFAULT CURRENT_DATE,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE bonuses (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  amount          REAL NOT NULL,
  reason          VARCHAR(200),
  bonus_date      DATE DEFAULT CURRENT_DATE,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9) المصاريف
-- ============================================================

CREATE TABLE expenses (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  category        VARCHAR(50) NOT NULL,  -- rent/salary/utilities/transport/other
  amount          REAL NOT NULL,
  description     VARCHAR(255),
  expense_date    DATE DEFAULT CURRENT_DATE,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_exp_company ON expenses(company_id);
CREATE INDEX idx_exp_date ON expenses(expense_date);

-- ============================================================
-- 10) الشات
-- ============================================================

CREATE TABLE chat_conversations (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  type            VARCHAR(20) DEFAULT 'direct',  -- direct/group/inter_company
  title           VARCHAR(150),
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cc_company ON chat_conversations(company_id);

CREATE TABLE chat_participants (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  content         VARCHAR(2000),
  message_type    VARCHAR(20) DEFAULT 'text',  -- text/file/image
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cm_conv ON chat_messages(conversation_id);
CREATE INDEX idx_cm_created ON chat_messages(created_at);

CREATE TABLE chat_files (
  id              BIGSERIAL PRIMARY KEY,
  message_id      BIGINT REFERENCES chat_messages(id) ON DELETE CASCADE,
  file_url        VARCHAR(255) NOT NULL,
  file_name       VARCHAR(150),
  file_size       INTEGER,
  file_type       VARCHAR(50)
);

-- ============================================================
-- 11) الإشعارات وسجل النشاط
-- ============================================================

CREATE TABLE notifications (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(150) NOT NULL,
  body            VARCHAR(500),
  type            VARCHAR(30),  -- expiry/low_stock/invoice/message/system
  reference_id    BIGINT,
  is_read         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notif_user ON notifications(user_id);
CREATE INDEX idx_notif_read ON notifications(is_read);
CREATE INDEX idx_notif_created ON notifications(created_at);

CREATE TABLE activity_log (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(60) NOT NULL,
  module          VARCHAR(40),
  reference_id    BIGINT,
  details         VARCHAR(500),
  ip_address      VARCHAR(45),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_al_company ON activity_log(company_id);
CREATE INDEX idx_al_user ON activity_log(user_id);
CREATE INDEX idx_al_created ON activity_log(created_at);

-- ============================================================
-- 12) روابط المشاركة + مدفوعات الأدمن + إعدادات النظام
-- ============================================================

CREATE TABLE share_links (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  token           VARCHAR(64) UNIQUE NOT NULL,
  resource_type   VARCHAR(30) NOT NULL,  -- purchase_request/invoice
  resource_id     BIGINT NOT NULL,
  expires_at      TIMESTAMPTZ,
  views           INTEGER DEFAULT 0,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sl_token ON share_links(token);

CREATE TABLE admin_payments (
  id              BIGSERIAL PRIMARY KEY,
  company_id      BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  amount          REAL NOT NULL,
  payment_date    DATE DEFAULT CURRENT_DATE,
  due_date        DATE,
  status          VARCHAR(20) DEFAULT 'pending',  -- pending/paid/overdue
  method          VARCHAR(30),  -- cash/transfer/vodafone
  notes           VARCHAR(255),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ap_company ON admin_payments(company_id);

CREATE TABLE system_settings (
  id              BIGSERIAL PRIMARY KEY,
  key             VARCHAR(60) UNIQUE NOT NULL,
  value           VARCHAR(500),
  description     VARCHAR(255),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 13) Triggers لتحديث updated_at تلقائياً
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'updated_at' AND table_schema = 'public'
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================
-- 14) Trigger لخصم الكمية من التشغيلة عند البيع
-- ============================================================

CREATE OR REPLACE FUNCTION decrement_batch_qty()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.batch_id IS NOT NULL THEN
    UPDATE batches
    SET quantity_left = quantity_left - NEW.quantity
    WHERE id = NEW.batch_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sii_decrement
AFTER INSERT ON sales_invoice_items
FOR EACH ROW EXECUTE FUNCTION decrement_batch_qty();

-- ============================================================
-- 15) Trigger لحذف الإشعارات الأقدم من 30 يوم
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS void AS $$
BEGIN
  DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 16) بيانات أولية: الصلاحيات
-- ============================================================

INSERT INTO permissions (code, name_ar, module) VALUES
-- الأصناف
('products.view',    'عرض الأصناف',       'products'),
('products.create',  'إضافة صنف',         'products'),
('products.edit',    'تعديل صنف',         'products'),
('products.delete',  'حذف صنف',           'products'),
-- المشتريات
('purchases.view',   'عرض المشتريات',     'purchases'),
('purchases.create', 'إنشاء طلب شراء',    'purchases'),
('purchases.edit',   'تعديل مشتريات',     'purchases'),
('purchases.receive','استلام مشتريات',    'purchases'),
-- المبيعات
('sales.view',       'عرض المبيعات',      'sales'),
('sales.create',     'إنشاء فاتورة',      'sales'),
('sales.pos',        'استخدام نقطة البيع','sales'),
('sales.return',     'مرتجع مبيعات',      'sales'),
-- المخزون
('inventory.view',   'عرض المخزون',       'inventory'),
('inventory.adjust', 'تسويات المخزون',    'inventory'),
('inventory.stocktake','الجرد',           'inventory'),
-- الموردين
('suppliers.view',   'عرض الموردين',      'suppliers'),
('suppliers.create', 'إضافة مورد',        'suppliers'),
('suppliers.edit',   'تعديل مورد',        'suppliers'),
-- العملاء
('customers.view',   'عرض العملاء',       'customers'),
('customers.create', 'إضافة عميل',        'customers'),
-- الموظفين
('employees.view',   'عرض الموظفين',      'employees'),
('employees.create', 'إضافة موظف',        'employees'),
('employees.edit',   'تعديل موظف',        'employees'),
('permissions.manage','إدارة الصلاحيات',  'employees'),
-- الحضور
('attendance.view',  'عرض الحضور',        'attendance'),
('attendance.manage','إدارة الحضور',      'attendance'),
-- الرواتب
('payroll.view',     'عرض الرواتب',       'payroll'),
('payroll.manage',   'إدارة الرواتب',     'payroll'),
-- المصاريف
('expenses.view',    'عرض المصاريف',      'expenses'),
('expenses.manage',  'إدارة المصاريف',    'expenses'),
-- التقارير
('reports.view',     'عرض التقارير',      'reports'),
('reports.export',   'تصدير التقارير',    'reports'),
('notifications.view','عرض الإشعارات',    'notifications'),
-- الشات
('chat.use',         'استخدام الشات',     'chat'),
-- الإعدادات
('settings.view',    'عرض الإعدادات',     'settings'),
('settings.manage',  'إدارة الإعدادات',   'settings'),
-- الأدمن
('admin.full',       'صلاحيات المطور',    'admin');

-- ============================================================
-- 17) بيانات أولية: الشركة الافتراضية + دور المدير + المستخدم admin
-- ============================================================

INSERT INTO companies (id, name, phone, email, address, is_active)
VALUES (1, 'شركة رفاد التجريبية', '01000000000', 'info@refad.com', 'القاهرة، مصر', TRUE);

INSERT INTO roles (id, company_id, name, name_ar, description, is_system, is_owner)
VALUES (1, 1, 'admin', 'صاحب الشركة', 'مدير الشركة', TRUE, TRUE);

-- صلاحيات الشركة لا تتضمن صلاحية إدارة كل الشركات
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions WHERE code <> 'admin.full';

INSERT INTO users (id, company_id, role_id, username, password, full_name, is_active, has_device)
VALUES (1, 1, 1, 'admin', '22446688', 'صاحب الشركة', TRUE, TRUE);

INSERT INTO roles (id, company_id, name, name_ar, description, is_system, is_owner)
VALUES (2, NULL, 'superadmin', 'مدير الشركات', 'إدارة جميع الشركات', TRUE, FALSE);

INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, id FROM permissions;

INSERT INTO users (id, company_id, role_id, username, password, full_name, is_active, has_device)
VALUES (2, NULL, 2, 'superadmin', '22446688', 'مدير الشركات', TRUE, TRUE);

SELECT setval(pg_get_serial_sequence('roles', 'id'), (SELECT MAX(id) FROM roles), TRUE);
SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users), TRUE);

-- ============================================================
-- 18) إعدادات النظام الافتراضية
-- ============================================================

INSERT INTO system_settings (key, value, description) VALUES
('system_name',        'رفاد',            'اسم النظام'),
('system_version',     '1.0.0',           'إصدار النظام'),
('default_currency',   'EGP',             'العملة الافتراضية'),
('session_hours',      '8',               'مدة الجلسة بالساعات'),
('idle_timeout_min',   '30',              'مدة الخمول قبل الخروج'),
('max_login_attempts', '5',               'عدد محاولات الدخول'),
('lock_duration_min',  '15',              'مدة القفل بالدقائق'),
('notif_retention_days','30',             'الاحتفاظ بالإشعارات بالأيام'),
('chat_retention_msgs','500',             'الاحتفاظ برسائل الشات'),
('expiry_alert_days',  '90',              'تنبيه الصلاحية قبل أيام');

-- ============================================================
-- 19) فهارس إضافية لتحسين الأداء
-- ============================================================

CREATE INDEX idx_batches_qty_left ON batches(quantity_left) WHERE quantity_left > 0;
CREATE INDEX idx_invoices_status ON sales_invoices(status);
CREATE INDEX idx_receipts_date ON receipts(receipt_date);
CREATE INDEX idx_im_ref ON inventory_movements(reference_type, reference_id);

DO $realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$realtime$;

-- ============================================================
-- ✅ انتهى الملف
-- ============================================================
-- ملاحظات ما بعد التنفيذ:
-- 1. شغّل هذا الملف كاملاً في Supabase SQL Editor
-- 2. تأكد من نجاح كل الأوامر بدون أخطاء
-- 3. حساب الشركة: admin / 22446688، ومدير الشركات: superadmin / 22446688
-- 4. في قاعدة موجودة، شغّل superadmin-setup.sql بدلاً من إعادة تشغيل هذا الملف.
-- 5. لتفعيل الحذف الدوري للإشعارات (اختياري):
--    SELECT cron.schedule('cleanup_notifs','0 3 * * *',
--      $$SELECT cleanup_old_notifications()$$);
-- ============================================================

-- 1) أضف عمود currency للجدول (لو مش موجود)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency VARCHAR(5) DEFAULT 'EGP';

-- 2) أنشئ bucket للشعارات
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- 3) سياسات bucket للقراءة والرفع
DROP POLICY IF EXISTS "Public read logos" ON storage.objects;
DROP POLICY IF EXISTS "Public upload logos" ON storage.objects;

CREATE POLICY "Public read logos" ON storage.objects
  FOR SELECT USING (bucket_id = 'logos');

CREATE POLICY "Public upload logos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'logos');

CREATE POLICY "Public update logos" ON storage.objects
  FOR UPDATE USING (bucket_id = 'logos');

CREATE POLICY "Public delete logos" ON storage.objects
  FOR DELETE USING (bucket_id = 'logos');

  -- إنشاء bucket للشات (public)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-files',
  'chat-files',
  true,
  10485760,  -- 10 MB
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain','application/zip','application/x-rar-compressed']
)
ON CONFLICT (id) DO NOTHING;

-- سياسات مفتوحة (لأن RLS معطّل على الجداول)
-- ملاحظة: Storage له RLS منفصل
CREATE POLICY "Public chat-files access"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-files');

CREATE POLICY "Anyone can upload chat-files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-files');

CREATE POLICY "Anyone can update chat-files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'chat-files');

CREATE POLICY "Anyone can delete chat-files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'chat-files');