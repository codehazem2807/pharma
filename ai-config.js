/* ============================================================
   ai-config.js
   إعدادات AI Agent + الشخصيات + الأدوات + السكيمة
   الإصدار: 4.2.0 — Ultra-Light Edition (Free Tier Optimized)
   ============================================================ */

window.AI_CONFIG = (function () {
  'use strict';

  const VERSION = '4.2.0';

  // ============================================================
  // 🔑 إعدادات Groq
  // ============================================================
  const GROQ_CONFIG = {
    API_KEY: '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',
    BASE_URL: 'https://api.groq.com/openai/v1',
    CHAT_ENDPOINT: '/chat/completions',
    AUDIO_ENDPOINT: '/audio/transcriptions',
    TTS_ENDPOINT: '/audio/speech',

    TIMEOUT: {
      chat: 60000,
      chatWithTools: 90000,
      transcribe: 30000,
      tts: 15000,
      sqlQuery: 15000
    },

    RETRY: {
      maxAttempts: 3,
      baseDelayMs: 4000,
      maxDelayMs: 40000,
      backoffMultiplier: 2,
      retryOn429: true
    },

    // 🛡️ Rate Limiting — حد Groq Free: 8000 TPM
    RATE_LIMIT: {
      maxTokensPerMinute: 7500,
      windowMs: 60000,
      minIntervalBetweenCalls: 2500,
      warningThreshold: 0.85
    }
  };

  // ============================================================
  // 🧠 النماذج
  // ============================================================
  const MODELS = {
    chat: {
      advanced: 'openai/gpt-oss-20b',
      balanced: 'openai/gpt-oss-20b',
      fast: 'openai/gpt-oss-20b',
      guard: 'meta-llama/llama-prompt-guard-2-86m',
      guardFast: 'meta-llama/llama-prompt-guard-2-22m'
    },

    audio: {
      transcribe: 'whisper-large-v3-turbo',
      transcribeHQ: 'whisper-large-v3',
      ttsArabicSaudi: 'canopylabs/orpheus-arabic-saudi',
      ttsEnglish: 'canopylabs/orpheus-v1-english'
    },

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
  // 🛠️ الأدوات — مختصرة جداً
  // ============================================================
  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'query_database',
        description: 'تنفيذ استعلام SELECT على قاعدة بيانات الشركة. ممنوع INSERT/UPDATE/DELETE. ممنوع كتابة company_id (يضاف تلقائياً).',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'استعلام SQL واحد فقط (SELECT أو WITH)'
            },
            reason: {
              type: 'string',
              description: 'سبب مختصر'
            }
          },
          required: ['query', 'reason']
        }
      }
    }
  ];

  // ============================================================
  // 🎭 الشخصيات — Prompts مختصرة
  // ============================================================
  const PERSONAS = {

    // 1️⃣ المحلل المالي
    financial: {
      id: 'financial',
      name: 'المحلل المالي',
      shortName: 'المالي',
      emoji: '📊',
      color: '#10b981',
      color2: '#047857',
      description: 'تحليل المبيعات والأرباح',
      keywords: ['مبيعات', 'أرباح', 'إيرادات', 'دخل', 'خسارة', 'تحليل', 'اتجاه', 'ربح', 'إجمالي', 'شهر', 'أسبوع', 'سنة', 'نمو', 'هامش', 'فاتورة', 'تحصيل', 'تقرير'],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `أنت "المحلل المالي" في نظام "رفاد".

## قواعد صارمة:
1. استخدم \`query_database\` **مرة واحدة فقط** لكل سؤال
2. لو محتاج بيانات من جدولين، اكتب JOIN في نفس الاستعلام
3. بعد أول نتيجة، اكتب الرد النهائي مباشرة
4. لا تقول "محتاج أشوف" — إنت بتشوف بنفسك

## حسابات:
- الربح = SUM(total_profit)
- هامش الربح = (الربح ÷ المبيعات) × 100
- التحصيل = (SUM(paid_amount) ÷ SUM(grand_total)) × 100

## فلترة:
- status != 'cancelled'
- التواريخ: CURRENT_DATE, date_trunc('month', CURRENT_DATE)

## تنسيق:
- الأرقام **bold**
- إيموجي للاتجاه 📈 📉 ⚠️
- 3 توصيات` 
    },

    // 2️⃣ مدير المخزون
    inventory: {
      id: 'inventory',
      name: 'مدير المخزون',
      shortName: 'المخزون',
      emoji: '📦',
      color: '#3b82f6',
      color2: '#1d4ed8',
      description: 'تنبيهات المخزون والصلاحية',
      keywords: ['مخزون', 'أصناف', 'نفاذ', 'صلاحية', 'تشغيلة', 'منتهي', 'كمية', 'ناقص', 'راكد', 'تحتاج طلب', 'نفد', 'batch', 'stock'],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `أنت "مدير المخزون" في نظام "رفاد".

## قواعد صارمة:
1. استخدم \`query_database\` **مرة واحدة فقط** لكل سؤال
2. اكتب استعلام واحد شامل يجيب كل البيانات المطلوبة
3. بعد أول نتيجة، اكتب الرد النهائي

## استعلام شامل للنفاذ:
\`\`\`sql
SELECT p.name, SUM(b.quantity_left) as available, p.reorder_level
FROM products p
LEFT JOIN batches b ON b.product_id = p.id
WHERE p.is_active = true
GROUP BY p.id, p.name, p.reorder_level
HAVING SUM(b.quantity_left) <= p.reorder_level
ORDER BY available ASC
\`\`\`

## قواعد التنبيه:
- 🔴 نفد: available = 0
- 🟡 قرب نفاذ: available ≤ reorder_level
- 🟡 قرب انتهاء: expiry_date ≤ CURRENT_DATE + 90
- 🔴 منتهي: expiry_date < CURRENT_DATE

## تنسيق: جدول
| الصنف | المتاح | حد الطلب | الأولوية |`
    },

    // 3️⃣ مستشار المبيعات
    sales: {
      id: 'sales',
      name: 'مستشار المبيعات',
      shortName: 'المبيعات',
      emoji: '🎯',
      color: '#8b5cf6',
      color2: '#6d28d9',
      description: 'تحليل المبيعات والعملاء',
      keywords: ['عميل', 'مندوب', 'أفضل', 'أداء', 'مبيعات', 'تحصيل', 'ديون', 'حد ائتمان', 'رصيد', 'customer', 'top'],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `أنت "مستشار المبيعات" في نظام "رفاد".

## قواعد صارمة:
1. استخدم \`query_database\` **مرة واحدة فقط** لكل سؤال
2. اكتب استعلام شامل بـ JOIN
3. بعد أول نتيجة، اكتب الرد النهائي

## استعلام أفضل العملاء:
\`\`\`sql
SELECT c.name, c.phone, SUM(si.grand_total) as total, SUM(si.total_profit) as profit
FROM sales_invoices si
JOIN customers c ON c.id = si.customer_id
WHERE si.status != 'cancelled'
GROUP BY c.id, c.name, c.phone
ORDER BY total DESC LIMIT 10
\`\`\`

## استعلام عملاء متأخرين:
\`\`\`sql
SELECT name, phone, balance FROM customers
WHERE balance > 0 ORDER BY balance DESC LIMIT 20
\`\`\`

## تنسيق:
- جداول للمقارنات
- توصيات عملية لكل حالة`
    },

    // 4️⃣ مدقق المخاطر (للمالك فقط)
    risk: {
      id: 'risk',
      name: 'مدقق المخاطر',
      shortName: 'المخاطر',
      emoji: '🛡️',
      color: '#ef4444',
      color2: '#b91c1c',
      description: 'تجاوزات وشيكات متأخرة',
      keywords: ['خطر', 'تجاوز', 'شيك', 'متأخر', 'مشكلة', 'تحذير', 'تدقيق', 'احتيال', 'risk', 'cheque', 'overdue'],
      allowedRoles: ['owner'],
      model: 'balanced',
      systemPrompt: `أنت "مدقق المخاطر" في نظام "رفاد".

## قواعد صارمة:
1. استخدم \`query_database\` **مرة واحدة فقط** لكل سؤال
2. اكتب استعلام شامل يجيب كل المخاطر في نفس واحد
3. بعد أول نتيجة، اكتب الرد النهائي

## استعلام المخاطر الشامل:
\`\`\`sql
SELECT 'تجاوز ائتمان' as risk_type, name, balance, credit_limit
FROM customers WHERE credit_limit > 0 AND balance > credit_limit
UNION ALL
SELECT 'شيك متأخر' as risk_type, party_name, amount, due_date
FROM cheques WHERE status = 'pending' AND due_date < CURRENT_DATE
LIMIT 30
\`\`\`

## التصنيف:
- 🔴 خطر عالي (تصرف فوري)
- 🟡 متوسط (راقب)
- 🟢 ملاحظة

## ⛔ ممنوع: لا تتهم أحداً بدون دليل`
    },

    // 5️⃣ المساعد العام
    general: {
      id: 'general',
      name: 'المساعد العام',
      shortName: 'عام',
      emoji: '🤖',
      color: '#14B8A6',
      color2: '#0d9488',
      description: 'أي سؤال',
      keywords: [],
      allowedRoles: ['owner', 'manager'],
      model: 'balanced',
      systemPrompt: `أنت "المساعد العام" في نظام "رفاد".

## قواعد صارمة:
1. استخدم \`query_database\` **مرة واحدة فقط** لكل سؤال
2. بعد أول نتيجة، اكتب الرد النهائي
3. لا تقول "محتاج أشوف" — إنت بتشوف بنفسك

## أمثلة:
- كام عميل: \`SELECT COUNT(*) FROM customers WHERE is_active = true\`
- آخر فواتير: \`SELECT invoice_number, grand_total FROM sales_invoices WHERE status != 'cancelled' ORDER BY created_at DESC LIMIT 5\`

## التنسيق: مختصر ومباشر`
    }
  };

  // ⏭️ الجزء 2 (SCHEMA + SETTINGS + Helpers) هيتحط هنا

    // ============================================================
  // 📋 السكيمة — مختصرة جداً (~400 tokens)
  // ============================================================
  const SCHEMA = `
**sales_invoices**: id, customer_id, invoice_date, grand_total, total_profit, paid_amount, status
**sales_invoice_items**: invoice_id, product_id, batch_id, quantity, unit_price, profit, total
**customers**: id, name, phone, balance, credit_limit
**suppliers**: id, name, phone, balance
**products**: id, name, form, unit, default_price, reorder_level
**batches**: id, product_id, batch_number, quantity_left, expiry_date, cost_price, sale_price
**payments**: id, direction, customer_id, supplier_id, amount, reference_invoice_id
**cheques**: id, cheque_number, party_name, amount, due_date, status
**receipts**: id, supplier_id, receipt_number, total_amount, paid_amount
**accounts**: id, name, current_balance
**expenses**: id, category, amount, expense_date
**warehouses**: id, name, is_default

**العلاقات:**
- sales_invoice_items.invoice_id → sales_invoices.id
- sales_invoice_items.product_id → products.id
- batches.product_id → products.id
- payments.reference_invoice_id → sales_invoices.id

**قواعد:**
- company_id في كل الجداول (فلتر تلقائي)
- status != 'cancelled' للفواتير
- CURRENT_DATE للتواريخ
`;

  // ============================================================
  // 🎯 ROUTING
  // ============================================================
  const ROUTING = {
    priority: ['risk', 'inventory', 'financial', 'sales', 'general'],

    complexity: {
      simple: { maxWords: 5, model: 'fast' },
      medium: { maxWords: 15, model: 'balanced' },
      complex: { minWords: 16, model: 'advanced' }
    },

    complexKeywords: ['لماذا', 'ليه', 'اشرح', 'حلل', 'قارن', 'توقع', 'اتجاه', 'مشكلة', 'سبب', 'تحليل عميق', 'تفصيلي', 'شامل', 'تدقيق'],

    simpleKeywords: ['كام', 'قد إيه', 'عدد', 'إيه', 'مين', 'فين', 'امتى']
  };

  // ============================================================
  // ⚙️ SETTINGS — محسّنة للـ Free Tier
  // ============================================================
  const SETTINGS = {
    rateLimit: {
      perHour: 30,
      perDay: 200,
      cooldownMs: 3000
    },

    context: {
      maxRows: 20,                    // ← قللناها من 30
      maxTokensInPrompt: 2000,        // ← قللناها من 3000
      maxHistory: 2,                  // ← قللناها من 3
      maxHistoryChars: 800            // ← قللناها من 1000
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
      maxSQLRows: 100                 // ← قللناها من 200
    },

    // 🔧 Function Calling — مُحسّن
    functionCalling: {
      enabled: true,
      maxIterations: 2,               // ← من 5 لـ 2
      toolChoice: 'auto',
      parallelToolCalls: false,
      maxTokensPerCall: 800           // ← من 1000 لـ 800
    },

    // ⏱️ Rate Limit Guard
    rateLimitGuard: {
      enabled: true,
      maxTokensPerMinute: 7500,
      windowMs: 60000,
      minIntervalMs: 2500,
      warningThreshold: 0.85,
      retryOn429: true
    },

    storage: {
      historyKey: 'refad_ai_chat_history',
      settingsKey: 'refad_ai_settings',
      fullscreenKey: 'refad_ai_fullscreen',
      maxSavedMessages: 30
    }
  };

  // ============================================================
  // 🎨 SUGGESTIONS
  // ============================================================
  const SUGGESTIONS = {
    financial: [
      'كام مبيعات النهاردة؟',
      'قارن مبيعات الشهر ده بالشهر اللي فات',
      'إيه هامش الربح الحالي؟',
      'أعلى 5 أيام في المبيعات'
    ],
    inventory: [
      'إيه الأصناف اللي قربت تنفد؟',
      'إيه اللي قرب ينتهي؟',
      'اقترح قائمة طلب شراء',
      'كام صنف متوفر؟'
    ],
    sales: [
      'مين أفضل 10 عملاء؟',
      'مين العملاء اللي مش بيشتروا؟',
      'أداء المناديب',
      'الأصناف الأكثر مبيعاً'
    ],
    risk: [
      'مين تجاوز حد الائتمان؟',
      'فيه شيكات متأخرة؟',
      'الفواتير بدون عميل',
      'تحليل مخاطر شامل'
    ],
    general: [
      'إيه الأخبار النهاردة؟',
      'ملخص شامل للشركة',
      'كام موظف؟',
      'آخر 5 فواتير'
    ]
  };

  // ============================================================
  // 📋 CONTEXT_TEMPLATES
  // ============================================================
  const CONTEXT_TEMPLATES = {
    dailyReport: 'تقرير يومي: مبيعات النهاردة + عدد فواتير + أعلى 3 أصناف + أهم 3 تنبيهات',
    weeklyAnalysis: 'تحليل أسبوعي: مبيعات الأسبوع + اتجاهات يوم بيوم + أفضل/أسوأ أيام',
    riskAudit: 'تدقيق مخاطر: ائتمانية + سيولة + تشغيلية',
    inventoryCheck: 'فحص مخزون: نفد + قرب نفاذ + قرب انتهاء',
    companyHealth: 'تحليل شامل: مالية + مخزون + عملاء + مخاطر — قيّم كل جانب بـ 10'
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

    canAccessPersona: function (personaId, userRole) {
      const p = PERSONAS[personaId];
      if (!p) return false;
      if (!p.allowedRoles || p.allowedRoles.length === 0) return true;
      return p.allowedRoles.includes(userRole);
    },

    getSuggestions: function (personaId) {
      return SUGGESTIONS[personaId] || SUGGESTIONS.general;
    },

    getPersonasForRole: function (userRole) {
      const self = this;
      return Object.values(PERSONAS).filter(function (p) {
        return self.canAccessPersona(p.id, userRole);
      });
    },

    buildSystemPrompt: function (personaId, companyId, userRole, options) {
      options = options || {};
      const persona = PERSONAS[personaId] || PERSONAS.general;
      const company = companyId || 'UNKNOWN';

      let prompt = persona.systemPrompt;

      // السكيمة
      prompt += '\n\n---\n\n# قاعدة البيانات:\n';
      prompt += SCHEMA;

      // القواعد
      prompt += '\n---\n\n# قواعد إلزامية:\n';
      prompt += '1. company_id = ' + company + ' (تلقائي)\n';
      prompt += '2. status != \'cancelled\'\n';
      prompt += '3. CURRENT_DATE للتواريخ\n';
      prompt += '4. SELECT/WITH فقط\n';
      prompt += '5. العملة: ج.م\n';
      prompt += '6. الرد بالعربي\n';
      prompt += '7. المستخدم: ' + userRole + '\n';

      // الأدوات
      prompt += '\n---\n\n# الأدوات:\n';
      prompt += '`query_database` — نفّذ استعلام SQL\n\n';

      // ⚠️ التعليمات الصارمة
      prompt += '**🚨 قواعد صارمة:**\n';
      prompt += '1. استخدم \`query_database\` **مرة واحدة فقط** لكل سؤال\n';
      prompt += '2. اكتب استعلام واحد شامل (JOIN لو محتاج)\n';
      prompt += '3. بعد أول نتيجة، **اكتب الرد النهائي مباشرة**\n';
      prompt += '4. لا تستدعي الأداة أكثر من مرة\n';
      prompt += '5. لو البيانات ناقصة، قول "محتاج معلومة إضافية"\n';

      prompt += '\n**🚫 ممنوع:** "محتاج أشوف" أو "افتح الصفحة" أو التخمين\n';

      // شكل الرد
      prompt += '\n---\n\n# شكل الرد:\n';
      prompt += '1. الإجابة المباشرة (أرقام)\n';
      prompt += '2. التحليل (مقارنات)\n';
      prompt += '3. توصيات (3 نقاط)\n';
      prompt += '**حد أقصى**: 300 كلمة\n';

      return prompt;
    },

    isInputValid: function (text) {
      const t = String(text || '').trim();
      if (t.length === 0) return { valid: false, reason: 'empty' };
      if (t.length > SETTINGS.security.maxInputLength) {
        return { valid: false, reason: 'too_long' };
      }
      return { valid: true };
    },

    getModelInfo: function (modelId) {
      return MODELS.meta[modelId] || null;
    },

    modelSupportsTools: function (modelId) {
      const info = MODELS.meta[modelId];
      return info ? info.tools === true : false;
    },

    estimateTokens: function (text) {
      return Math.ceil(String(text || '').length / 3.5);
    },

    sanitizeQuery: function (sql, companyId) {
      if (!sql) return null;

      let query = String(sql).trim();

      if (!/^(SELECT|WITH)\s/i.test(query)) {
        return { error: 'Only SELECT/WITH queries allowed' };
      }

      const dangerous = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i;
      if (dangerous.test(query)) {
        return { error: 'Modification queries not allowed' };
      }

      const sensitive = /\b(users|auth\.|pg_|information_schema)\b/i;
      if (sensitive.test(query)) {
        return { error: 'Access to sensitive tables denied' };
      }

      query = query.replace(/;\s*$/, '');

      if (!/\bLIMIT\s+\d+/i.test(query)) {
        query += ' LIMIT ' + SETTINGS.security.maxSQLRows;
      }

      return { query: query };
    }
  };
})();

console.log(
  '%c[AI Config] ✅ v' + window.AI_CONFIG.VERSION + ' Ultra-Light Loaded',
  'color:#14B8A6;font-weight:bold;font-size:13px'
);