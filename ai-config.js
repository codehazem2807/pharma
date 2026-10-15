/* ============================================================
   ai-config.js
   إعدادات AI Agent + الشخصيات + الأدوات + السكيمة
   الإصدار: 4.1.0 — Rate-Limit Optimized Edition
   ============================================================ */

window.AI_CONFIG = (function () {
  'use strict';

  // ============================================================
  // 🏷️ الإصدار
  // ============================================================
  const VERSION = '4.1.0';

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

    // ⏱️ Timeouts (ms) — مُحسّنة
    TIMEOUT: {
      chat: 60000,
      chatWithTools: 90000,
      transcribe: 30000,
      tts: 15000,
      sqlQuery: 15000
    },

    // 🔄 إعادة المحاولة
    RETRY: {
      maxAttempts: 3,
      baseDelayMs: 5000,       // 5 ثواني أساسي
      maxDelayMs: 45000,       // 45 ثانية كحد أقصى
      backoffMultiplier: 2,    // 5 → 10 → 20 ثانية
      retryOn429: true
    },

    // 🛡️ Rate Limiting (Free Tier على Groq)
    RATE_LIMIT: {
      // Groq Free Tier: 8000 tokens/minute للـ gpt-oss-20b
      maxTokensPerMinute: 7000,     // أقل بـ 1000 للأمان
      windowMs: 60000,               // نافذة دقيقة
      minIntervalBetweenCalls: 3000, // 3 ثواني على الأقل بين كل طلب
      warningThreshold: 0.8          // نبّه عند 80%
    }
  };

  // ============================================================
  // 🧠 النماذج المتاحة
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
        tokensPerMinute: 8000,
        best: 'الاستخدام العام'
      },
      'meta-llama/llama-prompt-guard-2-86m': {
        label: 'Prompt Guard 86M',
        context: 512,
        speed: 'very fast',
        quality: 'security',
        tools: false,
        tokensPerMinute: 30000,
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
        description: 'تنفيذ استعلام SELECT على قاعدة بيانات الشركة. لا تكتب company_id — هيضاف تلقائياً.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'استعلام SQL (SELECT أو WITH فقط)'
            },
            reason: {
              type: 'string',
              description: 'سبب مختصر للتوثيق'
            }
          },
          required: ['query', 'reason']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'count_records',
        description: 'عدّ السجلات في جدول معين مع إمكانية الفلترة.',
        parameters: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'اسم الجدول' },
            filters: { type: 'object', description: 'فلاتر اختيارية' }
          },
          required: ['table']
        }
      }
    }
  ];

  // ============================================================
  // 🎭 الشخصيات — مبسّطة لتقليل الـ tokens
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
        'فاتورة', 'تحصيل', 'تقرير'
      ],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `أنت "المحلل المالي" في نظام "رفاد".

## مهمتك:
إنت **بتشوف البيانات مباشرة** — استخدم \`query_database\` لجلب الأرقام الفعلية.

## قواعد أساسية:
1. **إستدعِ \`query_database\`** قبل أي إجابة عن بيانات
2. لا تقول "محتاج أشوف" — إنت **بتشوف بنفسك**
3. لا تخمّن أرقام
4. استخدم \`status != 'cancelled'\` للفواتير
5. التواريخ: CURRENT_DATE, date_trunc('month', CURRENT_DATE)

## حسابات:
- صافي الربح = SUM(total_profit)
- هامش الربح = (الربح ÷ المبيعات) × 100
- معدل التحصيل = (SUM(paid_amount) ÷ SUM(grand_total)) × 100

## التنسيق:
- الأرقام **bold**
- إيموجي للاتجاه 📈 📉 ⚠️
- 3 توصيات عملية`
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
        'كمية', 'ناقص', 'راكد', 'تحتاج طلب', 'نفد', 'batch', 'stock'
      ],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `أنت "مدير المخزون" في نظام "رفاد".

## مهمتك:
إنت **بتشوف بيانات المخزون مباشرة** — استخدم \`query_database\`.

## قواعد أساسية:
1. **إستدعِ \`query_database\`** قبل أي إجابة
2. لا تقول "محتاج أشوف"
3. لا تخمّن

## قواعد التنبيه:
- 🔴 نفد: SUM(quantity_left) = 0
- 🟡 قرب نفاذ: المتاح ≤ reorder_level
- 🟡 قرب انتهاء: expiry_date ≤ CURRENT_DATE + 90
- 🔴 منتهي: expiry_date < CURRENT_DATE

## التنسيق:
| الصنف | المتاح | حد الطلب | الأولوية |`
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
        'ديون', 'حد ائتمان', 'رصيد', 'customer', 'top'
      ],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `أنت "مستشار المبيعات" في نظام "رفاد".

## مهمتك:
إنت **بتشوف البيانات مباشرة** — استخدم \`query_database\`.

## قواعد أساسية:
1. **إستدعِ \`query_database\`** قبل أي إجابة
2. لا تقول "محتاج أشوف"
3. لا تخمّن

## مقاييس:
- قيمة العميل = SUM(grand_total)
- ربحية العميل = SUM(total_profit)
- نسبة التحصيل = (SUM(paid_amount) ÷ SUM(grand_total)) × 100

## توصيات:
- عميل رصيده كبير → تحصيل عاجل
- عميل ساكت → استرجاع
- صنف ربحه ضعيف → مراجعة سعر`
    },

    // ==========================================
    // 4️⃣ مدقق المخاطر (للمالك فقط)
    // ==========================================
    risk: {
      id: 'risk',
      name: 'مدقق المخاطر',
      shortName: 'المخاطر',
      emoji: '🛡️',
      color: '#ef4444',
      color2: '#b91c1c',
      description: 'تجاوزات، شيكات متأخرة، تعاملات مريبة',
      keywords: [
        'خطر', 'تجاوز', 'شيك', 'متأخر', 'مشكلة', 'تحذير',
        'تدقيق', 'احتيال', 'risk', 'cheque', 'overdue'
      ],
      allowedRoles: ['owner'],
      model: 'balanced',
      systemPrompt: `أنت "مدقق المخاطر" في نظام "رفاد".

## مهمتك:
إنت **بتشوف البيانات مباشرة** — استخدم \`query_database\`.

## مخاطر تراقبها:
### ائتمانية:
- balance > credit_limit
- balance > 10000

### سيولة:
- شيكات متأخرة: due_date < CURRENT_DATE
- رصيد سالب

### تشغيلية:
- تشغيلات منتهية
- فواتير بدون عميل

## التصنيف:
🔴 عالي (فوري) / 🟡 متوسط / 🟢 ملاحظة

## ⛔ ممنوع:
لا تتهم أحداً بدون دليل`
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
      description: 'أي سؤال عن أي بيانات',
      keywords: [],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `أنت "المساعد العام" في نظام "رفاد".

## مهمتك:
إنت **بتشوف البيانات مباشرة** — استخدم \`query_database\`.

## قواعد أساسية:
1. **إستدعِ \`query_database\`** قبل أي إجابة
2. لا تقول "محتاج أشوف"
3. لا تقول "افتح الصفحة كذا"
4. لا تخمّن أرقام

## أمثلة:
- كام عميل → SELECT COUNT(*) FROM customers WHERE is_active = true
- آخر فواتير → SELECT ... FROM sales_invoices ORDER BY created_at DESC LIMIT 5

## التنسيق:
مباشر وواضح — Markdown للمعقد`
    }
  };

  // ⏭️ الجزء 2 (SCHEMA + ROUTING + SETTINGS) هيتحط هنا

    // ============================================================
  // 📋 السكيمة المختصرة (لـ System Prompt)
  // ✅ مُختصرة من ~3500 token لـ ~900 token
  // ============================================================
  const SCHEMA = `
## الجداول الرئيسية:

**sales_invoices** (فواتير بيع):
id, company_id, customer_id, invoice_number, invoice_date, grand_total, total_profit, paid_amount, status ('paid'|'partial'|'unpaid'|'cancelled'), warehouse_id

**sales_invoice_items** (أصناف الفاتورة):
id, invoice_id, product_id, batch_id, quantity, bonus_qty, unit_price, sale_discount, cost_price, profit, total

**customers** (عملاء):
id, company_id, name, phone, balance, credit_limit, payment_terms_days, is_active

**suppliers** (موردين):
id, company_id, name, phone, balance, credit_limit, is_active

**products** (أصناف):
id, company_id, name, form, unit, category, default_price, reorder_level, is_active

**batches** (تشغيلات):
id, company_id, product_id, batch_number, quantity_left, cost_price, sale_price, expiry_date, warehouse_id

**payments** (مدفوعات):
id, company_id, direction ('in'|'out'), customer_id, supplier_id, amount, reference_invoice_id, payment_date

**receipts** (استلامات):
id, company_id, supplier_id, receipt_number, receipt_date, total_amount, paid_amount, status

**cheques** (شيكات):
id, company_id, cheque_number, cheque_type, party_name, customer_id, supplier_id, amount, due_date, status

**accounts** (حسابات): id, company_id, name, current_balance, is_active
**expenses** (مصاريف): id, company_id, category, amount, expense_date
**warehouses** (مخازن): id, company_id, name, is_active, is_default

## العلاقات:
- sales_invoices.customer_id → customers.id
- sales_invoice_items.invoice_id → sales_invoices.id
- sales_invoice_items.product_id → products.id
- batches.product_id → products.id
- payments.reference_invoice_id → sales_invoices.id

## قواعد:
1. **company_id** في كل الجداول — الفلتر تلقائي
2. **status != 'cancelled'** للفواتير المالية
3. التواريخ: CURRENT_DATE, date_trunc('month', CURRENT_DATE)
4. **ممنوع** INSERT/UPDATE/DELETE — قراءة فقط
`;

  // ============================================================
  // 🎯 قواعد التوجيه الذكي
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

    simpleKeywords: ['كام', 'قد إيه', 'عدد', 'إيه', 'مين', 'فين', 'امتى']
  };

  // ============================================================
  // ⚙️ الإعدادات — محسّنة للـ Rate Limit
  // ============================================================
  const SETTINGS = {
    rateLimit: {
      perHour: 30,
      perDay: 200,
      cooldownMs: 3000       // ← زودناها من 2000 لـ 3000
    },

    context: {
      maxRows: 30,                    // ← قللناها من 100
      maxTokensInPrompt: 3000,        // ← قللناها من 8000
      maxHistory: 3,                  // ← قللناها من 10
      maxHistoryChars: 1000           // ← قللناها من 4000
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
      showSQLInDebug: false
    },

    security: {
      alwaysFilterByCompany: true,
      readOnlyMode: true,
      blockSensitiveTables: ['users', 'auth'],
      blockSensitiveColumns: ['password'],
      guardPrompts: false,
      maxInputLength: 2000,
      maxSQLRows: 200              // ← قللناها من 500
    },

    // 🔧 Function Calling
    functionCalling: {
      enabled: true,
      maxIterations: 5,            // ← قللناها من 5 لـ 3
      toolChoice: 'auto',
      parallelToolCalls: false,
      maxTokensPerCall:800      // ← جديد: 1000 بدل 2000
    },

    // ⏱️ Rate Limit (لمنع 429)
    rateLimitGuard: {
      enabled: true,
      maxTokensPerMinute: 7000,
      windowMs: 60000,
      minIntervalMs: 3000,
      warningThreshold: 0.8,
      retryOn429: true
    },

    storage: {
      historyKey: 'refad_ai_chat_history',
      settingsKey: 'refad_ai_settings',
      fullscreenKey: 'refad_ai_fullscreen',
      maxSavedMessages: 30           // ← قللناها من 50
    }
  };

  // ============================================================
  // 🎨 الأسئلة المقترحة
  // ============================================================
  const SUGGESTIONS = {
    financial: [
      'كام إجمالي مبيعات النهاردة؟',
      'قارنلي مبيعات الأسبوع ده بالأسبوع اللي فات',
      'إيه هامش الربح الحالي؟',
      'إيه أعلى 5 أيام في المبيعات الشهر ده؟'
    ],
    inventory: [
      'إيه الأصناف اللي قربت تنفد؟',
      'إيه التشغيلات اللي هتنتهي خلال 30 يوم؟',
      'اقترحلي قائمة طلب شراء',
      'كام صنف متوفر في المخزن؟'
    ],
    sales: [
      'مين أفضل 10 عملاء عندنا؟',
      'مين العملاء اللي مش بيشتروا من فترة؟',
      'أداء المندوبين إيه؟',
      'إيه الأصناف الأكثر مبيعاً؟'
    ],
    risk: [
      'إيه العملاء اللي تجاوزوا حد الائتمان؟',
      'فيه شيكات متأخرة؟',
      'إيه الفواتير اللي بدون عميل؟',
      'تحليل كامل لمخاطر الشركة'
    ],
    general: [
      'إيه الأخبار النهاردة؟',
      'اعملي ملخص شامل للشركة',
      'كام موظف عندنا؟',
      'إيه آخر 5 فواتير اتعملت؟'
    ]
  };

  // ============================================================
  // 📋 قوالب سياق جاهزة
  // ============================================================
  const CONTEXT_TEMPLATES = {
    dailyReport: 'اعمل تقرير يومي: مبيعات اليوم vs أمس + عدد الفواتير + أعلى 3 أصناف + أهم 3 تنبيهات',
    weeklyAnalysis: 'تحليل أسبوعي: مبيعات الأسبوع vs السابق + اتجاهات يوم بيوم + أفضل/أسوأ 3 أيام',
    riskAudit: 'تدقيق مخاطر: ائتمانية + سيولة + تشغيلية + خطة عمل عاجلة',
    inventoryCheck: 'فحص مخزون: نفد + قرب نفاذ + قرب انتهاء + راكد + قائمة طلب',
    companyHealth: 'تحليل صحي شامل: مالية + سيولة + مخزون + عملاء + مخاطر — قيّم كل جانب بـ 10'
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

      if (persona && persona.model) {
        const modelKey = persona.model;
        if (MODELS.chat[modelKey]) {
          return MODELS.chat[modelKey];
        }
      }

      const hasComplexKw = ROUTING.complexKeywords.some(kw =>
        text.toLowerCase().includes(kw)
      );
      if (hasComplexKw || words > ROUTING.complexity.medium.maxWords) {
        return MODELS.chat.advanced;
      }

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
      return Object.values(PERSONAS).filter(function (p) {
        return self.canAccessPersona(p.id, userRole);
      });
    },

    /**
     * بناء System Prompt — مُحسّن لتقليل الـ tokens
     */
    buildSystemPrompt: function (personaId, companyId, userRole, options) {
      options = options || {};
      const persona = PERSONAS[personaId] || PERSONAS.general;
      const company = companyId || 'UNKNOWN';

      let prompt = persona.systemPrompt;

      // إضافة السكيمة
      prompt += '\n\n---\n\n';
      prompt += '# قاعدة البيانات:\n';
      prompt += SCHEMA;

      // القواعد الإلزامية
      prompt += '\n---\n\n';
      prompt += '# قواعد إلزامية:\n';
      prompt += '1. company_id = ' + company + ' (هيتضاف تلقائياً)\n';
      prompt += '2. استبعد status = \'cancelled\'\n';
      prompt += '3. التواريخ: CURRENT_DATE, date_trunc(\'month\', CURRENT_DATE)\n';
      prompt += '4. قراءة فقط (SELECT/WITH)\n';
      prompt += '5. العملة: ج.م\n';
      prompt += '6. الرد بالعربي المصري\n';
      prompt += '7. المستخدم: ' + userRole + '\n';

      // الأدوات
      prompt += '\n---\n\n';
      prompt += '# الأدوات:\n';
      prompt += '1. `query_database` — نفّذ SELECT (الأكثر استخداماً)\n';
      prompt += '2. `count_records` — عدّ سجلات\n\n';
      prompt += '**خطوات إلزامية:**\n';
      prompt += '1. استدعِ `query_database` لجلب البيانات\n';
      prompt += '2. اقرأ النتائج\n';
      prompt += '3. جاوب بأرقام دقيقة\n\n';
      prompt += '**🚫 ممنوع:** "محتاج أشوف" أو "افتح الصفحة" أو التخمين\n';

      // شكل الرد
      prompt += '\n---\n\n';
      prompt += '# شكل الرد:\n';
      prompt += '1. الإجابة المباشرة (أرقام)\n';
      prompt += '2. التحليل (مقارنات)\n';
      prompt += '3. توصيات (3 نقاط)\n';
      prompt += '**حد أقصى**: 400 كلمة\n';

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
     * تقدير عدد الـ tokens
     */
    estimateTokens: function (text) {
      // تقدير: 1 token ≈ 3.5 حروف
      return Math.ceil(String(text || '').length / 3.5);
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

      // ✅ إزالة الفاصلة المنقوطة
      query = query.replace(/;\s*$/, '');

      // ✅ إضافة LIMIT
      if (!/\bLIMIT\s+\d+/i.test(query)) {
        query += ' LIMIT ' + SETTINGS.security.maxSQLRows;
      }

      return { query: query };
    }
  };
})();

console.log(
  '%c[AI Config] ✅ v' + window.AI_CONFIG.VERSION + ' Fully Loaded — Rate-Limit Optimized',
  'color:#14B8A6;font-weight:bold;font-size:13px'
);