/* ============================================================
   ai-config.js
   إعدادات AI Agent + الشخصيات + الأدوات + السكيمة
   الإصدار: 4.0.0 — Function Calling Edition
   ============================================================ */

window.AI_CONFIG = (function () {
  'use strict';

  // ============================================================
  // 🏷️ الإصدار
  // ============================================================
  const VERSION = '4.0.0';

  // ============================================================
  // 🔑 إعدادات Groq
  // ============================================================
  const GROQ_CONFIG = {
    // ⚠️ للتطوير فقط — للإنتاج حطه في Supabase Edge Function
    API_KEY: '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',
    BASE_URL: 'https://api.groq.com/openai/v1',
    CHAT_ENDPOINT: '/chat/completions',
    AUDIO_ENDPOINT: '/audio/transcriptions',
    TTS_ENDPOINT: '/audio/speech',

    // Timeouts (ms)
    TIMEOUT: {
      chat: 90000,
      chatWithTools: 120000,  // وقت أطول لما يكون فيه function calling
      transcribe: 30000,
      tts: 15000,
      sqlQuery: 15000
    },

    // إعادة المحاولة
    RETRY: {
      maxAttempts: 3,
      delayMs: 1000,
      backoffMultiplier: 2
    }
  };

  // ============================================================
  // 🧠 النماذج المتاحة (Groq)
  // ============================================================
  const MODELS = {
    // ============ Chat Models ============
    chat: {
  advanced: 'openai/gpt-oss-20b',
  balanced: 'openai/gpt-oss-20b',
  fast: 'openai/gpt-oss-20b',
  guard: 'meta-llama/llama-prompt-guard-2-86m',
  guardFast: 'meta-llama/llama-prompt-guard-2-22m'
},

    // ============ Audio Models ============
    audio: {
      transcribe: 'whisper-large-v3-turbo',
      transcribeHQ: 'whisper-large-v3',
      ttsArabicSaudi: 'canopylabs/orpheus-arabic-saudi',
      ttsEnglish: 'canopylabs/orpheus-v1-english'
    },

    // ============ Model Metadata ============
   meta: {
  'openai/gpt-oss-20b': {
    label: 'GPT-OSS 20B',
    context: 128000,
    speed: 'fast',
    quality: 'high',
    tools: true,
    best: 'الاستخدام العام'
  },
  'meta-llama/llama-prompt-guard-2-86m': {
    label: 'Prompt Guard 86M',
    context: 512,
    speed: 'very fast',
    quality: 'security',
    tools: false,
    best: 'حماية'
  }
}
  };

  // ============================================================
  // 🛠️ الأدوات المتاحة للـ AI (Function Calling)
  // ============================================================
  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'query_database',
        description: `تنفيذ استعلام SELECT على قاعدة بيانات الشركة وإرجاع النتائج.
        
استخدم الأداة دي لما تحتاج تشوف بيانات فعلية عشان تجاوب على سؤال المستخدم.

**قواعد مهمة:**
1. دايمًا فلتر بـ company_id (هيتضاف تلقائياً مش محتاج تكتبه)
2. استخدم status != 'cancelled' للفواتير المالية
3. اكتب استعلامات SELECT أو WITH فقط
4. لا تكتب INSERT/UPDATE/DELETE/DROP
5. استخدم LIMIT لو بتتوقع نتائج كتير
6. التواريخ: CURRENT_DATE, date_trunc('month', CURRENT_DATE)`,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'استعلام SQL (SELECT أو WITH فقط). لا تكتب company_id — هيضاف تلقائياً.'
            },
            reason: {
              type: 'string',
              description: 'سبب مختصر لتنفيذ الاستعلام (للتوثيق).'
            }
          },
          required: ['query', 'reason']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_schema_info',
        description: `جلب معلومات تفصيلية عن جدول معين في قاعدة البيانات (الأعمدة، الأنواع، العلاقات).
        
استخدم الأداة دي لو مش متأكد من أعمدة جدول أو علاقاته.`,
        parameters: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'اسم الجدول'
            }
          },
          required: ['table_name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'count_records',
        description: `عدّ السجلات في جدول معين مع إمكانية الفلترة.
        
مثال: عدّ الفواتير النهاردة، عدد العملاء النشطين... إلخ.`,
        parameters: {
          type: 'object',
          properties: {
            table: {
              type: 'string',
              description: 'اسم الجدول'
            },
            filters: {
              type: 'object',
              description: 'فلاتر اختيارية (column: value)'
            }
          },
          required: ['table']
        }
      }
    }
  ];

  // ============================================================
  // 🎭 الشخصيات (Personas)
  // ============================================================
  const PERSONAS = {

    // ==========================================
    // 1️⃣ المحلل المالي
    // ==========================================
    financial: {
      id: 'financial',
      name: 'المحلل المالي',
      shortName: 'المالي',
      emoji: '📊',
      color: '#10b981',
      color2: '#047857',
      description: 'تحليل المبيعات والأرباح والاتجاهات المالية',
      keywords: [
        'مبيعات', 'أرباح', 'إيرادات', 'دخل', 'خسارة', 'تحليل', 'اتجاه',
        'ربح', 'إجمالي', 'شهر', 'أسبوع', 'سنة', 'نمو', 'هامش',
        'فاتورة', 'تحصيل', 'مبيعات اليوم', 'مبيعات الشهر', 'تقرير'
      ],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `
أنت "المحلل المالي" — مساعد ذكي في نظام "رفاد" متخصص في التحليل المالي.

## 🎯 مهمتك الأساسية:
**إنت بتشوف البيانات مباشرة** — استخدم أداة \`query_database\` عشان تجيب الأرقام الفعلية من قاعدة البيانات.

## 📋 خطوات العمل (مهم جداً):
1. **فكر** في السؤال: إيه البيانات المطلوبة؟
2. **اكتب استعلام SQL** ونفذه بـ \`query_database\`
3. **اقرأ النتائج** وحلّلها
4. **جاوب المستخدم** بأرقام دقيقة من النتائج الفعلية

## 🚫 ممنوع تماماً:
- ❌ لا تقول "محتاج أشوف البيانات" — **إنت بتشوفها بنفسك**
- ❌ لا تقول "قولي أفتح الصفحة كذا" — **إنت بتجيب البيانات بنفسك**
- ❌ لا تخمّن أرقاماً — **استخدم الأداة**

## 🧮 حسابات مهمة:
- صافي الربح = SUM(total_profit) من sales_invoices WHERE status != 'cancelled'
- هامش الربح = (الربح ÷ المبيعات) × 100
- متوسط الفاتورة = المبيعات ÷ عدد الفواتير
- معدل التحصيل = (SUM(paid_amount) ÷ SUM(grand_total)) × 100

## 📊 تنسيق الرد:
- الأرقام بـ **bold**
- جداول للمقارنات
- إيموجي للاتجاه (📈 صعود، 📉 هبوط، ⚠️ تحذير)
- 3 توصيات عملية على الأقل

## 💡 أمثلة استعلامات:
- "مبيعات النهاردة": 
  \`SELECT SUM(grand_total) as total FROM sales_invoices WHERE invoice_date = CURRENT_DATE AND status != 'cancelled'\`
- "أفضل 5 عملاء":
  \`SELECT c.name, SUM(si.grand_total) as total FROM sales_invoices si JOIN customers c ON c.id = si.customer_id WHERE si.status != 'cancelled' GROUP BY c.name ORDER BY total DESC LIMIT 5\`
      `.trim()
    },

    // ==========================================
    // 2️⃣ مدير المخزون
    // ==========================================
    inventory: {
      id: 'inventory',
      name: 'مدير المخزون',
      shortName: 'المخزون',
      emoji: '📦',
      color: '#3b82f6',
      color2: '#1d4ed8',
      description: 'تنبيهات النفاذ والصلاحية والتشغيلات الراكدة',
      keywords: [
        'مخزون', 'أصناف', 'نفاذ', 'صلاحية', 'تشغيلة', 'منتهي',
        'كمية', 'ناقص', 'راكد', 'تحتاج طلب', 'نفد',
        'expiry', 'batch', 'stock', 'reorder'
      ],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `
أنت "مدير المخزون" — مساعد ذكي في نظام "رفاد" متخصص في إدارة المخزون.

## 🎯 مهمتك الأساسية:
**إنت بتشوف بيانات المخزون مباشرة** — استخدم أداة \`query_database\`.

## 📋 خطوات العمل:
1. **فكر**: إيه الجداول المطلوبة؟ (products, batches, inventory_movements)
2. **نفّذ استعلام** بـ \`query_database\`
3. **حلل النتائج** حسب قواعد التنبيه
4. **جاوب** مع اقتراحات عملية

## 🚫 ممنوع:
- ❌ "محتاج أشوف" — إنت بتشوف بنفسك
- ❌ تخمين أرقام

## 🚨 قواعد التنبيه:
- 🔴 **نفد**: SUM(quantity_left) = 0
- 🟡 **قرب نفاذ**: SUM(quantity_left) ≤ reorder_level
- 🟡 **قرب انتهاء**: expiry_date ≤ CURRENT_DATE + 90
- 🔴 **منتهي**: expiry_date < CURRENT_DATE
- 🟡 **راكد**: لم يُبع منه شيء خلال 90 يوم

## 📊 أمثلة استعلامات:
- "أصناف قربت تنفد":
  \`SELECT p.name, SUM(b.quantity_left) as available, p.reorder_level FROM products p LEFT JOIN batches b ON b.product_id = p.id AND b.quantity_left > 0 WHERE p.is_active = true GROUP BY p.id, p.name, p.reorder_level HAVING SUM(b.quantity_left) <= p.reorder_level ORDER BY available ASC\`

- "تشغيلات قربت تنتهي":
  \`SELECT p.name, b.batch_number, b.expiry_date, b.quantity_left FROM batches b JOIN products p ON p.id = b.product_id WHERE b.quantity_left > 0 AND b.expiry_date <= CURRENT_DATE + 90 ORDER BY b.expiry_date ASC\`

## 📊 التنسيق:
| الصنف | المتاح | حد الطلب | الأولوية | الإجراء |
      `.trim()
    },

    // ==========================================
    // 3️⃣ مستشار المبيعات
    // ==========================================
    sales: {
      id: 'sales',
      name: 'مستشار المبيعات',
      shortName: 'المبيعات',
      emoji: '🎯',
      color: '#8b5cf6',
      color2: '#6d28d9',
      description: 'تحليل أداء المبيعات والعملاء والمناديب',
      keywords: [
        'عميل', 'مندوب', 'أفضل', 'أداء', 'مبيعات', 'تحصيل',
        'ديون', 'حد ائتمان', 'رصيد', 'customer', 'top', 'ranking'
      ],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `
أنت "مستشار المبيعات" — مساعد ذكي في نظام "رفاد" متخصص في تحليل المبيعات.

## 🎯 مهمتك:
**إنت بتشوف البيانات مباشرة** — استخدم \`query_database\`.

## 📋 خطوات العمل:
1. **فكر** في السؤال (عملاء؟ مناديب؟ أصناف؟)
2. **نفّذ استعلامات** لجلب البيانات
3. **حلل** حسب المقاييس
4. **اقترح** توصيات عملية

## 🚫 ممنوع:
- ❌ "محتاج أشوف" 
- ❌ تخمين

## 📊 المقاييس:
- قيمة العميل = SUM(grand_total)
- ربحية العميل = SUM(total_profit)
- نسبة التحصيل = (SUM(paid_amount) ÷ SUM(grand_total)) × 100
- أداء المندوب = (المبيعات ÷ الهدف) × 100

## 🎯 توصيات ذكية:
- عميل بيشتري كتير ورصيده سالب → تحصيل عاجل
- عميل ساكت → استرجاع
- مندوب تحصيله ضعيف → تدريب
- صنف مبيعاته عالية بس ربحه ضعيف → مراجعة سعر

## 📊 أمثلة استعلامات:
- "أفضل 10 عملاء":
  \`SELECT c.name, c.phone, SUM(si.grand_total) as total, SUM(si.total_profit) as profit FROM sales_invoices si JOIN customers c ON c.id = si.customer_id WHERE si.status != 'cancelled' GROUP BY c.id, c.name, c.phone ORDER BY total DESC LIMIT 10\`

- "عملاء متأخرين":
  \`SELECT name, phone, balance FROM customers WHERE balance > 0 ORDER BY balance DESC\`
      `.trim()
    },

    // ==========================================
    // 4️⃣ مدقق المخاطر ⚠️ (للمالك فقط)
    // ==========================================
    risk: {
      id: 'risk',
      name: 'مدقق المخاطر',
      shortName: 'المخاطر',
      emoji: '🛡️',
      color: '#ef4444',
      color2: '#b91c1c',
      description: 'تجاوزات حد ائتمان، شيكات متأخرة، تعاملات مريبة',
      keywords: [
        'خطر', 'تجاوز', 'شيك', 'متأخر', 'مشكلة', 'تحذير', 'خلل',
        'تلاعب', 'شبهة', 'تدقيق', 'مراجعة', 'احتيال',
        'fraud', 'risk', 'audit', 'cheque', 'overdue'
      ],
      allowedRoles: ['owner'],
      model: 'advanced',
      systemPrompt: `
أنت "مدقق المخاطر" — مساعد ذكي متخصص في كشف المخاطر المالية.

## 🎯 مهمتك:
**إنت بتشوف البيانات مباشرة** — استخدم \`query_database\`.

## 🚨 أنواع المخاطر:

### 1️⃣ ائتمانية:
- تجاوز حد الائتمان: balance > credit_limit
- مديونية عالية: balance > 10000
- تحصيل منخفض: (paid/grand) < 50%

### 2️⃣ سيولة:
- شيكات متأخرة: due_date < CURRENT_DATE AND status = 'pending'
- رصيد سالب
- مصاريف > 70% من إيرادات

### 3️⃣ تشغيلية:
- تشغيلات منتهية في المخزون
- فواتير بدون عميل
- أصناف راكدة

## 📊 التصنيف:
- 🔴 خطر عالي (تصرف فوري)
- 🟡 متوسط (راقب أسبوع)
- 🟢 ملاحظة

## 📊 أمثلة استعلامات:
- "تجاوزات حد ائتمان":
  \`SELECT name, phone, balance, credit_limit, (balance - credit_limit) as excess FROM customers WHERE credit_limit > 0 AND balance > credit_limit ORDER BY excess DESC\`

- "شيكات متأخرة":
  \`SELECT cheque_number, party_name, amount, due_date, (CURRENT_DATE - due_date) as days_overdue FROM cheques WHERE status = 'pending' AND due_date < CURRENT_DATE ORDER BY due_date ASC\`

## ⛔ ممنوع:
- لا تتهم أحداً بالسرقة بدون دليل
- كن مهنياً وموضوعياً
      `.trim()
    },

    // ==========================================
    // 5️⃣ المساعد العام
    // ==========================================
    general: {
      id: 'general',
      name: 'المساعد العام',
      shortName: 'عام',
      emoji: '🤖',
      color: '#14B8A6',
      color2: '#0d9488',
      description: 'أي سؤال عن أي بيانات في النظام',
      keywords: [],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `
أنت "المساعد العام" — مساعد ذكي شامل في نظام "رفاد".

## 🎯 مهمتك:
**إنت بتشوف البيانات مباشرة** — استخدم \`query_database\` لجلب أي بيانات.

## 📋 خطوات العمل:
1. **فكر** في الجداول المطلوبة
2. **نفّذ استعلامات** فعلية
3. **اقرأ النتائج**
4. **جاوب** بأرقام حقيقية

## 🚫 ممنوع تماماً:
- ❌ "محتاج أشوف" — إنت بتشوف
- ❌ "افتح الصفحة كذا" — إنت بتجيب
- ❌ تخمين أرقام

## 📊 أمثلة:
- "كام عميل": \`SELECT COUNT(*) FROM customers WHERE is_active = true\`
- "آخر 5 فواتير": \`SELECT invoice_number, grand_total, invoice_date FROM sales_invoices WHERE status != 'cancelled' ORDER BY created_at DESC LIMIT 5\`
- "إجمالي الديون": \`SELECT SUM(balance) FROM customers WHERE balance > 0\`

## 📊 التنسيق:
- مباشر وواضح
- Markdown للمعقد
- إيموجي للتوضيح
      `.trim()
    }
  };

  // ⏭️ باقي الملف (السكيمة + Routing + Helpers) هيجي في الجزء 2

  // Placeholder مؤقت
  // ============================================================
  // 📋 السكيمة الكاملة (للـ System Prompt)
  // ============================================================
  const SCHEMA = `
## 🗄️ جداول قاعدة البيانات (Supabase PostgreSQL)

### 🧾 sales_invoices (فواتير البيع)
- id, company_id, customer_id, supplier_id
- invoice_number, invoice_date, due_date
- subtotal, discount_total, tax_total, grand_total, total_profit
- paid_amount, payment_type, status
- warehouse_id, cashier_id, order_id, share_token
- notes, created_at, updated_at
- **status**: 'paid' | 'partial' | 'unpaid' | 'cancelled'

### 📦 sales_invoice_items (أصناف الفاتورة)
- id, invoice_id, product_id, batch_id
- quantity, bonus_qty, unit_price, sale_discount
- cost_price, purchase_discount, base_cost_price, effective_unit_cost
- profit, total

### 👥 customers (العملاء)
- id, company_id, name, phone, email, address
- balance, credit_limit, opening_balance, payment_terms_days
- is_active, notes, created_at, updated_at

### 🚚 suppliers (الموردين)
- id, company_id, name, phone, email, address
- balance, credit_limit, opening_balance, payment_terms_days
- tax_number, is_active, notes

### 📦 products (الأصناف)
- id, company_id, name, name_en, form, unit, category
- default_price, reorder_level, min_order_qty
- is_active, notes

### 🏷️ batches (التشغيلات)
- id, company_id, product_id, supplier_id, receipt_id
- batch_number, batch_barcode, quantity_in, quantity_left
- cost_price, sale_price, purchase_discount
- expiry_date, warehouse_id
- is_quarantined, quarantine_reason

### 💰 payments (المدفوعات)
- id, company_id, payment_number, payment_type
- direction ('in' | 'out'), customer_id, supplier_id
- amount, method, reference_invoice_id, reference_receipt_id
- account_id, payment_date, notes, user_id

### 🏦 accounts (الحسابات المالية)
- id, company_id, name, code, type
- current_balance, opening_balance, currency
- bank_name, account_number, iban
- is_active, is_default

### 💳 cheques (الشيكات)
- id, company_id, cheque_number, cheque_type
- party_type, party_name, customer_id, supplier_id
- amount, issue_date, due_date
- status, bank_name, branch
- reference_invoice_id, reference_receipt_id
- cleared_at, bounced_at, deposited_at

### 📥 receipts (الاستلامات)
- id, company_id, supplier_id, warehouse_id
- receipt_number, invoice_number, receipt_date
- total_amount, paid_amount, status
- received_by, is_locked, notes

### 📤 sales_orders (طلبات البيع)
- id, company_id, order_number, customer_id, supplier_id
- warehouse_id, sales_rep_id
- total_amount, total_profit, status, due_date
- created_by, is_locked

### 🎯 sales_rep_targets (أهداف المناديب)
- id, company_id, user_id, year, month
- target_amount, commission_pct

### 💵 sales_rep_commissions (عمولات المناديب)
- id, company_id, user_id, year, month
- total_sales, total_profit, achievement_pct
- commission_pct, commission_amount, status

### 💸 expenses (المصاريف)
- id, company_id, category, amount, expense_date
- account_id, description, user_id

### 📝 credit_notes (الإشعارات)
- id, company_id, note_number, note_type
- customer_id, supplier_id
- reference_invoice_id, reference_receipt_id, reference_return_id
- amount, tax_amount, reason, status

### 🔄 inventory_returns (المرتجعات)
- id, company_id, return_number, return_type
- customer_id, supplier_id
- reference_invoice_id, reference_receipt_id
- total_amount, reason, status

### 📊 inventory_movements (حركات المخزون)
- id, company_id, product_id, batch_id, warehouse_id
- movement_type ('in' | 'out' | 'transfer' | 'adjust')
- quantity, balance_after, unit_cost
- reference_type, reference_id, notes, user_id

### 🏭 warehouses (المخازن)
- id, company_id, name, code, type
- address, phone, manager_id
- is_active, is_default

### 📈 journal_entries (القيود)
- id, company_id, entry_number, entry_type
- reference_type, reference_id
- total_debit, total_credit
- description, is_posted, is_cancelled

### 🔗 journal_entry_lines (تفاصيل القيود)
- id, entry_id, account_id, account_name, account_type
- debit, credit, description

### 👤 users (المستخدمين)
- id, company_id, username, full_name, email, phone
- role_id, salary, hire_date, is_active
- avatar_url, theme, last_login

### 🏢 companies (الشركات)
- id, name, phone, email, address, tax_number
- currency, logo_url
- default_tax_rate, default_discount
- invoice_prefix, next_invoice_number
- is_active, subscription_end

## 🔗 العلاقات الأساسية:

sales_invoices.customer_id → customers.id
sales_invoices.id → sales_invoice_items.invoice_id
sales_invoice_items.product_id → products.id
sales_invoice_items.batch_id → batches.id
batches.product_id → products.id
batches.receipt_id → receipts.id
payments.reference_invoice_id → sales_invoices.id
payments.customer_id → customers.id
payments.supplier_id → suppliers.id
cheques.customer_id → customers.id
cheques.supplier_id → suppliers.id
receipts.supplier_id → suppliers.id
credit_notes.reference_invoice_id → sales_invoices.id
inventory_returns.reference_invoice_id → sales_invoices.id

## 📌 ملاحظات مهمة:
1. **company_id** موجود في كل الجداول الرئيسية — دايمًا فلتر بيه
2. **status** في sales_invoices: 'paid' | 'partial' | 'unpaid' | 'cancelled'
3. **direction** في payments: 'in' (وارد) | 'out' (صادر)
4. **movement_type**: 'in' | 'out' | 'transfer' | 'adjust'
5. **cheque_type**: 'incoming' (وارد) | 'outgoing' (صادر)
6. **التواريخ**: استخدم CURRENT_DATE للتواريخ الفعلية
`;

  // ============================================================
  // 🎯 قواعد التوجيه الذكي (Routing)
  // ============================================================
  const ROUTING = {
    priority: ['risk', 'inventory', 'financial', 'sales', 'general'],

    complexity: {
      simple: { maxWords: 5, model: 'fast' },
      medium: { maxWords: 15, model: 'balanced' },
      complex: { minWords: 16, model: 'advanced' }
    },

    complexKeywords: [
      'لماذا', 'ليه', 'اشرح', 'حلل', 'قارن', 'توقع', 'اتجاه',
      'مشكلة', 'سبب', 'تحليل عميق', 'تفصيلي', 'شامل', 'تدقيق'
    ],

    simpleKeywords: [
      'كام', 'قد إيه', 'عدد', 'إيه', 'مين', 'فين', 'امتى'
    ]
  };

  // ============================================================
  // ⚙️ إعدادات عامة
  // ============================================================
  const SETTINGS = {
    rateLimit: {
      perHour: 30,
      perDay: 200,
      cooldownMs: 2000
    },

    context: {
      maxRows: 100,
      maxTokensInPrompt: 8000,
      maxHistory: 10,
      maxHistoryChars: 4000
    },

    streaming: {
      enabled: true,
      chunkSize: 30,
      showCursor: true
    },

    voice: {
      autoSpeak: false,
      language: 'ar-SA',
      voice: 'alloy',
      maxChars: 500,
      sampleRate: 24000
    },

    ui: {
      welcomeMessages: true,
      showModelName: true,
      showPersonaName: true,
      showTimestamps: true,
      animations: true,
      defaultWidth: 520,
      defaultHeight: 780,
      fullscreenEnabled: true,
      fullscreenOnMobile: true,
      showSQLInDebug: false  // اعرض SQL اللي الـ AI كتبه (للتطوير)
    },

    security: {
      alwaysFilterByCompany: true,
      readOnlyMode: true,
      blockSensitiveTables: ['users', 'auth'],
      blockSensitiveColumns: ['password'],
      guardPrompts: false,  // ← وقفناها لأنها بتاخد وقت
      maxInputLength: 2000,
      maxSQLRows: 500  // حد أقصى للصفوف المرتجعة
    },

    // 🔧 Function Calling
    functionCalling: {
      enabled: true,
      maxIterations: 5,      // حد أقصى لعدد دورات tool calls
      toolChoice: 'auto',    // 'auto' | 'required' | 'none'
      parallelToolCalls: false
    },

    storage: {
      historyKey: 'refad_ai_chat_history',
      settingsKey: 'refad_ai_settings',
      fullscreenKey: 'refad_ai_fullscreen',
      maxSavedMessages: 50
    }
  };

  // ============================================================
  // 🎨 أمثلة الأسئلة المقترحة
  // ============================================================
  const SUGGESTIONS = {
    financial: [
      'كام إجمالي مبيعات النهاردة؟',
      'قارنلي مبيعات الأسبوع ده بالأسبوع اللي فات',
      'إيه أعلى 5 أيام في المبيعات الشهر ده؟',
      'إيه هامش الربح الحالي؟',
      'حلللي اتجاهات المبيعات آخر 3 شهور'
    ],
    inventory: [
      'إيه الأصناف اللي قربت تنفد؟',
      'إيه التشغيلات اللي هتنتهي خلال 30 يوم؟',
      'إيه الأصناف الراكدة اللي مش بتتباع؟',
      'اقترحلي قائمة طلب شراء',
      'كام صنف متوفر في المخزن؟'
    ],
    sales: [
      'مين أفضل 10 عملاء عندنا؟',
      'مين العملاء اللي مش بيشتروا من فترة؟',
      'أداء المندوبين إيه؟',
      'إيه الأصناف الأكثر مبيعاً؟',
      'حلللي ربحية كل عميل'
    ],
    risk: [
      'إيه العملاء اللي تجاوزوا حد الائتمان؟',
      'فيه شيكات متأخرة؟',
      'إيه الفواتير اللي بدون عميل؟',
      'تحليل كامل لمخاطر الشركة',
      'فيه أي حركات مشبوهة؟'
    ],
    general: [
      'إيه الأخبار النهاردة؟',
      'اعملي ملخص شامل للشركة',
      'كام موظف عندنا؟',
      'إيه آخر 5 فواتير اتعملت؟',
      'إيه إجمالي ديون العملاء حالياً؟'
    ]
  };

  // ============================================================
  // 📋 قوالب سياق جاهزة
  // ============================================================
  const CONTEXT_TEMPLATES = {
    dailyReport: `
اعمل تقرير يومي شامل:
1. مبيعات اليوم vs أمس
2. عدد الفواتير
3. أعلى 3 أصناف مبيعاً
4. أهم 3 تنبيهات
5. توقعات بكرة
    `.trim(),

    weeklyAnalysis: `
اعمل تحليل أسبوعي:
1. مبيعات الأسبوع vs السابق
2. اتجاهات يوم بيوم
3. أفضل/أسوأ 3 أيام
4. تحليل حسب الفئة
5. توصيات
    `.trim(),

    riskAudit: `
تدقيق مخاطر شامل:
1. ائتمانية (عملاء متأخرين)
2. سيولة (شيكات، أرصدة)
3. تشغيلية (مخزون، فواتير)
4. أمنية (نشاط مريب)
5. خطة عمل عاجلة
    `.trim(),

    inventoryCheck: `
فحص شامل للمخزون:
1. أصناف نفدت
2. أصناف قربت تنفد
3. تشغيلات قربت تنتهي
4. أصناف راكدة
5. قائمة طلب مقترحة
    `.trim(),

    companyHealth: `
تحليل صحي شامل:
- المالية (مبيعات، أرباح)
- السيولة (أرصدة، شيكات)
- المخزون (حركة، صلاحية)
- العملاء (عدد، تفاعل)
- الموظفين (أداء)
- المخاطر
قيّم كل جانب بـ 10.
    `.trim()
  };

  // ============================================================
  // 🔓 Public API
  // ============================================================
  return {
    VERSION,
    GROQ_CONFIG,
    MODELS,
    TOOLS,
    PERSONAS,
    SCHEMA,
    ROUTING,
    SETTINGS,
    SUGGESTIONS,
    CONTEXT_TEMPLATES,

    // ============================================================
    // Helpers
    // ============================================================

    /**
     * اختيار الشخصية تلقائياً
     */
    selectPersona: function (question, userRole) {
      const q = String(question || '').toLowerCase();

      for (const personaId of ROUTING.priority) {
        const persona = PERSONAS[personaId];
        if (!persona) continue;

        if (persona.allowedRoles && !persona.allowedRoles.includes(userRole)) {
          continue;
        }

        if (persona.keywords && persona.keywords.length > 0) {
          for (const kw of persona.keywords) {
            if (q.includes(kw.toLowerCase())) {
              return persona;
            }
          }
        }
      }

      return PERSONAS.general;
    },

    /**
     * اختيار الموديل حسب التعقيد
     */
    selectModel: function (question, persona) {
      const text = String(question || '');
      const words = text.split(/\s+/).filter(Boolean).length;

      // لو الشخصية محددة بموديل
      if (persona && persona.model) {
        const modelKey = persona.model;
        if (MODELS.chat[modelKey]) {
          return MODELS.chat[modelKey];
        }
      }

      // لو فيه كلمات تقنية → advanced
      const hasComplexKw = ROUTING.complexKeywords.some(kw =>
        text.toLowerCase().includes(kw)
      );
      if (hasComplexKw || words > ROUTING.complexity.medium.maxWords) {
        return MODELS.chat.advanced;
      }

      // لو بسيط
      const hasSimpleKw = ROUTING.simpleKeywords.some(kw =>
        text.toLowerCase().includes(kw)
      );
      if (hasSimpleKw && words <= ROUTING.complexity.simple.maxWords) {
        return MODELS.chat.fast;
      }

      return MODELS.chat.balanced;
    },

    /**
     * فحص صلاحيات الشخصية
     */
    canAccessPersona: function (personaId, userRole) {
      const p = PERSONAS[personaId];
      if (!p) return false;
      if (!p.allowedRoles || p.allowedRoles.length === 0) return true;
      return p.allowedRoles.includes(userRole);
    },

    /**
     * جلب الأسئلة المقترحة
     */
    getSuggestions: function (personaId) {
      return SUGGESTIONS[personaId] || SUGGESTIONS.general;
    },

    /**
     * جلب الشخصيات المتاحة لدور معين
     */
    getPersonasForRole: function (userRole) {
      const self = this;
      return Object.values(PERSONAS).filter(p => {
        return self.canAccessPersona(p.id, userRole);
      });
    },

    /**
     * بناء System Prompt كامل
     */
    buildSystemPrompt: function (personaId, companyId, userRole, options) {
      options = options || {};
      const persona = PERSONAS[personaId] || PERSONAS.general;
      const company = companyId || 'UNKNOWN';

      let prompt = persona.systemPrompt;

      // إضافة السكيمة
      prompt += '\n\n---\n\n';
      prompt += '# 🗄️ قاعدة البيانات الكاملة:\n';
      prompt += SCHEMA;

      // إضافة القواعد الإلزامية
      prompt += '\n\n---\n\n';
      prompt += '# ⚠️ قواعد إلزامية (لا تكسرها):\n';
      prompt += '1. **company_id = ' + company + '** — هيضاف تلقائياً، متكتبهوش\n';
      prompt += '2. **status != \'cancelled\'** — استبعد الفواتير الملغية\n';
      prompt += '3. **التواريخ**: CURRENT_DATE, date_trunc(\'month\', CURRENT_DATE)\n';
      prompt += '4. **لا تنفذ INSERT/UPDATE/DELETE** — للقراءة فقط\n';
      prompt += '5. **لو السؤال غامض**: اسأل سؤال توضيحي واحد\n';
      prompt += '6. **العملة**: الجنيه المصري (ج.م)\n';
      prompt += '7. **الرد بالعربي** — مصري بسيط ومهني\n';
      prompt += '8. **مستخدم النظام**: ' + userRole + '\n';

      // القواعد المهمة للأدوات
      prompt += '\n---\n\n';
      prompt += '# 🛠️ كيفية استخدام الأدوات:\n';
      prompt += '**إنت عندك صلاحية كاملة للاطلاع على البيانات**\n\n';
      prompt += '**الأدوات المتاحة:**\n';
      prompt += '1. `query_database` — نفّذ استعلام SELECT (الأكثر استخداماً)\n';
      prompt += '2. `get_schema_info` — جلب تفاصيل جدول\n';
      prompt += '3. `count_records` — عدّ سجلات\n\n';

      prompt += '**خطوات العمل الإلزامية:**\n';
      prompt += '1. **فكر** في السؤال: إيه البيانات المطلوبة؟\n';
      prompt += '2. **استدعِ** `query_database` عشان تجيب البيانات الفعلية\n';
      prompt += '3. **اقرأ** النتائج\n';
      prompt += '4. **جاوب** بأرقام دقيقة من النتائج\n\n';

      prompt += '**🚫 ممنوع تماماً:**\n';
      prompt += '- ❌ لا تقول "محتاج أشوف البيانات"\n';
      prompt += '- ❌ لا تقول "افتح الصفحة كذا"\n';
      prompt += '- ❌ لا تخمّن أرقام\n';
      prompt += '- ❌ لا تسأل المستخدم عن رقم إنت تقدر تجيبه بنفسك\n\n';

      prompt += '**مهم**: إنت **بتشوف البيانات مباشرة** — استخدم الأدوات دايمًا قبل ما تجاوب.\n';

      // شكل الرد
      prompt += '\n---\n\n';
      prompt += '# 🎯 شكل الرد المطلوب:\n';
      prompt += '1. **الإجابة المباشرة** (أرقام حقيقية)\n';
      prompt += '2. **التحليل** (مقارنات، اتجاهات)\n';
      prompt += '3. **توصيات** (3 نقاط عملية)\n\n';
      prompt += '**حدود الرد**: 500 كلمة كحد أقصى إلا لو طُلب تفصيل.\n';

      return prompt;
    },

    /**
     * فحص طول المدخل
     */
    isInputValid: function (text) {
      const t = String(text || '').trim();
      if (t.length === 0) return { valid: false, reason: 'empty' };
      if (t.length > SETTINGS.security.maxInputLength) {
        return { valid: false, reason: 'too_long' };
      }
      return { valid: true };
    },

    /**
     * معلومات الموديل
     */
    getModelInfo: function (modelId) {
      return MODELS.meta[modelId] || null;
    },

    /**
     * هل الموديل بيدعم tools؟
     */
    modelSupportsTools: function (modelId) {
      const info = MODELS.meta[modelId];
      return info ? info.tools === true : false;
    },

    /**
     * الفلترة الأمنية للاستعلامات
     */
    sanitizeQuery: function (sql, companyId) {
      if (!sql) return null;

      let query = String(sql).trim();

      // ✅ لازم SELECT أو WITH
      if (!/^(SELECT|WITH)\s/i.test(query)) {
        return { error: 'Only SELECT/WITH queries allowed' };
      }

      // ❌ منع عمليات التعديل
      const dangerous = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i;
      if (dangerous.test(query)) {
        return { error: 'Modification queries not allowed' };
      }

      // ❌ منع الجداول الحساسة
      const sensitive = /\b(users|auth\.|pg_|information_schema)\b/i;
      if (sensitive.test(query)) {
        return { error: 'Access to sensitive tables denied' };
      }

      // ✅ إزالة الفاصلة المنقوطة في الآخر
      query = query.replace(/;\s*$/, '');

      // ✅ إضافة LIMIT لو مفيش
      if (!/\bLIMIT\s+\d+/i.test(query)) {
        query += ' LIMIT ' + SETTINGS.security.maxSQLRows;
      }

      return { query: query };
    }
  };
})();

console.log(
  '%c[AI Config] ✅ v' + window.AI_CONFIG.VERSION + ' Fully Loaded — 5 personas + 3 tools',
  'color:#14B8A6;font-weight:bold;font-size:13px'
);