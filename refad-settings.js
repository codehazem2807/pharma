/**
 * ═══════════════════════════════════════════════════════════════
 * refad-settings.js
 * Version: 2.0.0
 * ═══════════════════════════════════════════════════════════════
 * 
 * طبقة موحّدة لإدارة كل إعدادات الشركة
 * 
 * Changelog v2.0.0:
 *   ✅ Helper APIs لكل الأقسام (invoice, inventory, payroll, security, etc.)
 *   ✅ Auto-reload عند تغيير الإعدادات (event-based)
 *   ✅ تطبيق تلقائي للهوية واللغة والحواف
 *   ✅ قراءة العملة من الإعدادات
 *   ✅ دعم كامل لـ RefadSettings.invoice.getPrefix()
 *   ✅ دعم RefadSettings.locale.getCurrencySymbol()
 *   ✅ دعم RefadSettings.identity.getSystemName()
 *   ✅ دعم RefadSettings.security.getSessionHours()
 *   ✅ دعم RefadSettings.payroll.getWorkHours()
 *   ✅ دعم RefadSettings.inventory.getReorderLevel()
 * 
 * الأقسام المدعومة:
 *   - theme, identity, invoice, inventory, payroll,
 *     security, notifications, locale, accounting
 * 
 * الاستخدام:
 *   RefadSettings.get('invoice', 'invoice_prefix')
 *   RefadSettings.invoice.getPrefix()
 *   RefadSettings.locale.getCurrencySymbol()
 *   RefadSettings.security.getSessionHours()
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // 1) الإعدادات الافتراضية لكل قسم
  // ═══════════════════════════════════════════════════════════
  const DEFAULTS = {
    theme: {
      active_preset: 'refad',
      primary_color: '#0B2C4D',
      accent_color: '#14B8A6',
      sidebar_bg: '#0B2C4D',
      sidebar_text: '#cbd5e1',
      success_color: '#10b981',
      danger_color: '#ef4444',
      warning_color: '#f59e0b',
      info_color: '#3b82f6',
      purple_color: '#8b5cf6',
      gold_color: '#F59E0B',
      bg_light: '#F1F5F9',
      text_light: '#0f172a',
      bg_dark: '#0a1628',
      text_dark: '#f1f5f9',
      default_mode: 'light'
    },

    identity: {
      system_name: 'رفاد',
      system_tagline: 'نظام إدارة الأدوية',
      logo_url: null,
      favicon_url: null,
      border_radius: '14',
      density: 'comfortable'
    },

    invoice: {
      invoice_prefix: 'INV',
      purchase_prefix: 'PUR',
      next_invoice_number: '1',
      next_purchase_number: '1',
      default_tax_rate: '0',
      default_discount: '0',
      invoice_footer: '',
      invoice_terms: '',
      show_logo_on_invoice: 'true',
      show_qr_code: 'false'
    },

    inventory: {
      default_reorder_level: '10',
      expiry_alert_days: '90',
      min_order_qty: '1',
      cost_method: 'fifo',
      low_stock_alerts: 'true',
      expiry_alerts: 'true',
      prevent_loss_sale: 'false',
      allow_negative_sale: 'false',
      enable_batch_tracking: 'true'
    },

    payroll: {
      work_hours_per_day: '8',
      monthly_leave_days: '4',
      late_deduction_pct: '25',
      absent_deduction_pct: '100',
      unexcused_absent_multiplier: '2',
      overtime_multiplier: '1.5',
      perfect_attendance_bonus: '0',
      no_late_bonus: '0',
      salary_day_of_month: '1'
    },

    security: {
      session_hours: '8',
      idle_timeout_min: '30',
      max_login_attempts: '5',
      lock_duration_min: '15',
      require_2fa: 'false',
      force_logout_all: 'false'
    },

    notifications: {
      realtime_notifs: 'true',
      expiry_alerts: 'true',
      low_stock_alerts: 'true',
      whatsapp_notifs: 'false',
      email_notifs: 'false',
      daily_summary: 'true',
      purchase_order_alerts: 'true'
    },

    locale: {
      currency: 'EGP',
      currency_symbol: 'ج.م',
      language: 'ar',
      timezone: 'Africa/Cairo',
      date_format: 'DD/MM/YYYY',
      time_format: '24h',
      number_format: 'en'
    },

    accounting: {
      cost_method: 'fifo',
      fiscal_year_start: '01-01',
      tax_included: 'false',
      rounding_method: 'round',
      allow_manual_journal: 'true'
    }
  };

  // ═══════════════════════════════════════════════════════════
  // 2) State
  // ═══════════════════════════════════════════════════════════
  const state = {
    cache: {},
    loadedSections: {},
    loading: {},
    lastFetch: {}
  };

  const CACHE_TTL = 5 * 60 * 1000; // 5 دقائق

  // ═══════════════════════════════════════════════════════════
  // 3) Helpers
  // ═══════════════════════════════════════════════════════════

  function getSession() {
    if (!window.Refad || !Refad.Session || typeof Refad.Session.get !== 'function') {
      return null;
    }
    return Refad.Session.get();
  }

  function getCompanyId() {
    const session = getSession();
    return session ? session.company_id : null;
  }

  function getUserId() {
    const session = getSession();
    return session ? session.user_id : null;
  }

  function isCacheValid(section) {
    const last = state.lastFetch[section];
    if (!last) return false;
    return (Date.now() - last) < CACHE_TTL;
  }

  function castValue(value, valueType) {
    if (value === null || value === undefined) return value;
    if (valueType === 'number') return Number(value) || 0;
    if (valueType === 'boolean') return value === 'true' || value === true;
    if (valueType === 'json') {
      try { return JSON.parse(value); } catch (e) { return value; }
    }
    return value;
  }

  function detectValueType(value) {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'object' && value !== null) return 'json';
    if (typeof value === 'string') {
      if (value === 'true' || value === 'false') return 'boolean';
      if (/^-?\d+(\.\d+)?$/.test(value) && value.length < 20) return 'number';
    }
    return 'string';
  }

  // ═══════════════════════════════════════════════════════════
  // 4) Load Section من DB
  // ═══════════════════════════════════════════════════════════

  async function loadSection(section, force) {
    const companyId = getCompanyId();
    if (!companyId) {
      state.cache[section] = { ...(DEFAULTS[section] || {}) };
      state.loadedSections[section] = true;
      return state.cache[section];
    }

    if (!force && isCacheValid(section) && state.cache[section]) {
      return state.cache[section];
    }

    if (state.loading[section]) {
      await new Promise(function (resolve) { setTimeout(resolve, 200); });
      return state.cache[section] || { ...(DEFAULTS[section] || {}) };
    }

    state.loading[section] = true;

    try {
      if (!window.Refad || !Refad.db) {
        throw new Error('Refad.db not available');
      }

      const rows = await Refad.db.select('company_settings', {
        columns: 'key, value, value_type',
        eq: { company_id: companyId, category: section }
      }).catch(function (e) {
        console.warn('[Settings] Load section failed:', section, e.message);
        return [];
      });

      const result = { ...(DEFAULTS[section] || {}) };

      (rows || []).forEach(function (r) {
        result[r.key] = castValue(r.value, r.value_type);
      });

      state.cache[section] = result;
      state.loadedSections[section] = true;
      state.lastFetch[section] = Date.now();

      return result;
    } catch (e) {
      console.warn('[Settings] Load error:', section, e.message);
      state.cache[section] = { ...(DEFAULTS[section] || {}) };
      state.loadedSections[section] = true;
      return state.cache[section];
    } finally {
      state.loading[section] = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 5) ✅ Apply Settings Globally
  // ═══════════════════════════════════════════════════════════
  function applyIdentityToDOM() {
    try {
      const systemName = API.identity.getSystemName();
      const tagline = API.identity.getTagline();
      const radius = API.identity.getBorderRadius();
      const density = API.identity.getDensity();
      const logoUrl = API.identity.getLogoUrl();

      // 1) تحديث اسم النظام في sidebar
      const brandName = document.getElementById('sidebarBrandName');
      const brandDesc = document.getElementById('sidebarBrandDesc');
      if (brandName) brandName.textContent = systemName;
      if (brandDesc) brandDesc.textContent = tagline;

      // 2) تحديث الحواف
      document.documentElement.style.setProperty('--radius', radius + 'px');
      document.documentElement.style.setProperty('--radius-sm', Math.max(6, radius - 4) + 'px');

      // 3) تحديث density
      const densityMap = { compact: '0.85', comfortable: '1', spacious: '1.15' };
      document.documentElement.style.setProperty('--density', densityMap[density] || '1');

      // 4) تحديث الشعار
      if (logoUrl) {
        document.querySelectorAll('img[id*="Logo"], img[id*="logo"]').forEach(img => {
          if (img.src !== logoUrl && !img.dataset.keepSrc) {
            img.src = logoUrl;
            img.onerror = function () {
              this.style.display = 'none';
            };
          }
        });
      }

      // 5) تحديث Language
      const lang = API.locale.getLanguage();
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

      // 6) تحديث title
      const pageTitle = document.title.split(' - ')[0];
      if (pageTitle && systemName) {
        document.title = pageTitle + ' - ' + systemName;
      }
    } catch (e) {
      console.warn('[Settings] applyIdentityToDOM failed:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 6) Public APIs
  // ═══════════════════════════════════════════════════════════

  const API = {
    /**
     * جلب قيمة إعداد معين (sync — من cache)
     */
    get: function (section, key, defaultValue) {
      const sectionCache = state.cache[section];
      if (sectionCache && sectionCache[key] !== undefined) {
        return sectionCache[key];
      }
      if (DEFAULTS[section] && DEFAULTS[section][key] !== undefined) {
        return DEFAULTS[section][key];
      }
      return defaultValue;
    },

    getAsync: async function (section, key, defaultValue) {
      await loadSection(section, false);
      return API.get(section, key, defaultValue);
    },

    /**
     * حفظ إعداد معين (async)
     */
    set: async function (section, key, value) {
      const companyId = getCompanyId();
      if (!companyId) throw new Error('لا توجد جلسة نشطة');
      if (!window.Refad || !Refad.db) throw new Error('Refad.db not available');

      const valueType = detectValueType(value);
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);

      try {
        // حاول RPC أولاً
        if (Refad.sb && Refad.sb.rpc) {
          try {
            const result = await Refad.sb.rpc('save_company_setting', {
              p_company_id: companyId,
              p_category: section,
              p_key: key,
              p_value: valueStr,
              p_value_type: valueType,
              p_user_id: getUserId()
            });
            if (result.error) throw result.error;

            if (!state.cache[section]) state.cache[section] = {};
            state.cache[section][key] = value;
            state.lastFetch[section] = Date.now();

            // ✅ Dispatch event لتطبيق التغييرات
            window.dispatchEvent(new CustomEvent('refad:setting-changed', {
              detail: { section, key, value }
            }));

            return true;
          } catch (rpcErr) {
            console.warn('[Settings] RPC failed, using upsert:', rpcErr.message);
          }
        }

        // Fallback: upsert مباشر
        const existing = await Refad.db.selectOne('company_settings', {
          eq: { company_id: companyId, category: section, key: key }
        }).catch(function () { return null; });

        const payload = {
          company_id: companyId,
          category: section,
          key: key,
          value: valueStr,
          value_type: valueType,
          updated_by: getUserId()
        };

        if (existing) {
          await Refad.db.update('company_settings', existing.id, {
            value: valueStr,
            value_type: valueType,
            updated_by: getUserId()
          });
        } else {
          await Refad.db.insert('company_settings', payload);
        }

        if (!state.cache[section]) state.cache[section] = {};
        state.cache[section][key] = value;
        state.lastFetch[section] = Date.now();

        // ✅ Dispatch event
        window.dispatchEvent(new CustomEvent('refad:setting-changed', {
          detail: { section, key, value }
        }));

        return true;
      } catch (e) {
        console.error('[Settings] set failed:', section, key, e);
        throw e;
      }
    },

    setSection: async function (section, settingsObject) {
      const results = [];
      for (const key of Object.keys(settingsObject)) {
        try {
          await API.set(section, key, settingsObject[key]);
          results.push({ key: key, success: true });
        } catch (e) {
          results.push({ key: key, success: false, error: e.message });
        }
      }
      return results;
    },

    getSection: async function (section) {
      return await loadSection(section, false);
    },

    reloadSection: async function (section) {
      delete state.lastFetch[section];
      return await loadSection(section, true);
    },

    ensure: async function (section) {
      if (!state.loadedSections[section] || !isCacheValid(section)) {
        await loadSection(section, false);
      }
      return state.cache[section];
    },

    loadAll: async function () {
      const sections = Object.keys(DEFAULTS);
      const results = await Promise.all(
        sections.map(function (s) {
          return loadSection(s, false).then(function (data) {
            return { section: s, success: true, data: data };
          }).catch(function (e) {
            return { section: s, success: false, error: e.message };
          });
        })
      );
      return results;
    },

    getAll: function () {
      const all = {};
      Object.keys(DEFAULTS).forEach(function (section) {
        all[section] = state.cache[section] || { ...DEFAULTS[section] };
      });
      return all;
    },

    getDefaults: function (section) {
      return section ? { ...(DEFAULTS[section] || {}) } : { ...DEFAULTS };
    },

    resetSection: async function (section) {
      if (!DEFAULTS[section]) throw new Error('Invalid section: ' + section);

      try {
        const companyId = getCompanyId();
        if (!companyId) throw new Error('لا توجد جلسة');

        const rows = await Refad.db.select('company_settings', {
          columns: 'id',
          eq: { company_id: companyId, category: section }
        }).catch(function () { return []; });

        for (const row of rows) {
          await Refad.db.remove('company_settings', row.id).catch(function () {});
        }

        delete state.cache[section];
        delete state.lastFetch[section];
        delete state.loadedSections[section];

        return true;
      } catch (e) {
        console.error('[Settings] resetSection failed:', e);
        throw e;
      }
    },

    // ═══════════════════════════════════════════════════════
    // Helper: قراءة بأمان
    // ═══════════════════════════════════════════════════════

    getString: function (section, key, defaultValue) {
      const v = API.get(section, key, defaultValue);
      return v != null ? String(v) : defaultValue;
    },

    getNumber: function (section, key, defaultValue) {
      const v = API.get(section, key, defaultValue);
      const n = Number(v);
      return isNaN(n) ? defaultValue : n;
    },

    getBoolean: function (section, key, defaultValue) {
      const v = API.get(section, key, defaultValue);
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') return v === 'true';
      return !!v;
    },

    getJSON: function (section, key, defaultValue) {
      const v = API.get(section, key, defaultValue);
      if (typeof v === 'object') return v;
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch (e) { return defaultValue; }
      }
      return defaultValue;
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Helper APIs — الفواتير
    // ═══════════════════════════════════════════════════════
    invoice: {
      getPrefix: function () { return API.getString('invoice', 'invoice_prefix', 'INV'); },
      getPurchasePrefix: function () { return API.getString('invoice', 'purchase_prefix', 'PUR'); },
      getNextNumber: function () { return API.getNumber('invoice', 'next_invoice_number', 1); },
      getNextPurchaseNumber: function () { return API.getNumber('invoice', 'next_purchase_number', 1); },
      getTaxRate: function () { return API.getNumber('invoice', 'default_tax_rate', 0); },
      getDiscount: function () { return API.getNumber('invoice', 'default_discount', 0); },
      getFooter: function () { return API.getString('invoice', 'invoice_footer', ''); },
      getTerms: function () { return API.getString('invoice', 'invoice_terms', ''); },

      shouldShowLogo: function () {
        const v = API.get('invoice', 'show_logo_on_invoice', 'true');
        return v === 'true' || v === true;
      },

      shouldShowQR: function () {
        const v = API.get('invoice', 'show_qr_code', 'false');
        return v === 'true' || v === true;
      },

      generateNumber: function (type) {
        type = type || 'sale';
        const prefix = type === 'sale' ? API.invoice.getPrefix() : API.invoice.getPurchasePrefix();
        const next = type === 'sale' ? API.invoice.getNextNumber() : API.invoice.getNextPurchaseNumber();
        const year = new Date().getFullYear();
        return prefix + '-' + year + '-' + String(next).padStart(5, '0');
      },

      incrementCounter: async function (type) {
        type = type || 'sale';
        const key = type === 'sale' ? 'next_invoice_number' : 'next_purchase_number';
        const current = API.getNumber('invoice', key, 1);
        await API.set('invoice', key, current + 1);
        return current + 1;
      }
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Helper APIs — المخزون
    // ═══════════════════════════════════════════════════════
    inventory: {
      getReorderLevel: function () { return API.getNumber('inventory', 'default_reorder_level', 10); },
      getExpiryAlertDays: function () { return API.getNumber('inventory', 'expiry_alert_days', 90); },
      getMinOrderQty: function () { return API.getNumber('inventory', 'min_order_qty', 1); },
      getCostMethod: function () { return API.getString('inventory', 'cost_method', 'fifo'); },

      isLowStockAlertEnabled: function () {
        const v = API.get('inventory', 'low_stock_alerts', 'true');
        return v === 'true' || v === true;
      },
      isExpiryAlertEnabled: function () {
        const v = API.get('inventory', 'expiry_alerts', 'true');
        return v === 'true' || v === true;
      },
      isPreventLossSaleEnabled: function () {
        const v = API.get('inventory', 'prevent_loss_sale', 'false');
        return v === 'true' || v === true;
      },
      isAllowNegativeSaleEnabled: function () {
        const v = API.get('inventory', 'allow_negative_sale', 'false');
        return v === 'true' || v === true;
      },
      isBatchTrackingEnabled: function () {
        const v = API.get('inventory', 'enable_batch_tracking', 'true');
        return v === 'true' || v === true;
      }
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Helper APIs — الرواتب
    // ═══════════════════════════════════════════════════════
    payroll: {
      getWorkHours: function () { return API.getNumber('payroll', 'work_hours_per_day', 8); },
      getMonthlyLeave: function () { return API.getNumber('payroll', 'monthly_leave_days', 4); },
      getLateDeduction: function () { return API.getNumber('payroll', 'late_deduction_pct', 25); },
      getAbsentDeduction: function () { return API.getNumber('payroll', 'absent_deduction_pct', 100); },
      getUnexcusedMultiplier: function () { return API.getNumber('payroll', 'unexcused_absent_multiplier', 2); },
      getOvertimeMultiplier: function () { return API.getNumber('payroll', 'overtime_multiplier', 1.5); },
      getPerfectAttendanceBonus: function () { return API.getNumber('payroll', 'perfect_attendance_bonus', 0); },
      getNoLateBonus: function () { return API.getNumber('payroll', 'no_late_bonus', 0); },
      getSalaryDay: function () { return API.getNumber('payroll', 'salary_day_of_month', 1); }
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Helper APIs — الأمان
    // ═══════════════════════════════════════════════════════
    security: {
      getSessionHours: function () { return API.getNumber('security', 'session_hours', 8); },
      getIdleTimeout: function () { return API.getNumber('security', 'idle_timeout_min', 30); },
      getMaxLoginAttempts: function () { return API.getNumber('security', 'max_login_attempts', 5); },
      getLockDuration: function () { return API.getNumber('security', 'lock_duration_min', 15); },
      is2FARequired: function () {
        const v = API.get('security', 'require_2fa', 'false');
        return v === 'true' || v === true;
      }
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Helper APIs — الإشعارات
    // ═══════════════════════════════════════════════════════
    notifications: {
      isRealtimeEnabled: function () {
        const v = API.get('notifications', 'realtime_notifs', 'true');
        return v === 'true' || v === true;
      },
      isExpiryEnabled: function () {
        const v = API.get('notifications', 'expiry_alerts', 'true');
        return v === 'true' || v === true;
      },
      isLowStockEnabled: function () {
        const v = API.get('notifications', 'low_stock_alerts', 'true');
        return v === 'true' || v === true;
      },
      isWhatsAppEnabled: function () {
        const v = API.get('notifications', 'whatsapp_notifs', 'false');
        return v === 'true' || v === true;
      },
      isEmailEnabled: function () {
        const v = API.get('notifications', 'email_notifs', 'false');
        return v === 'true' || v === true;
      },
      isDailySummaryEnabled: function () {
        const v = API.get('notifications', 'daily_summary', 'true');
        return v === 'true' || v === true;
      }
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Helper APIs — Locale
    // ═══════════════════════════════════════════════════════
    locale: {
      getCurrency: function () { return API.getString('locale', 'currency', 'EGP'); },
      getCurrencySymbol: function () { return API.getString('locale', 'currency_symbol', 'ج.م'); },
      getLanguage: function () { return API.getString('locale', 'language', 'ar'); },
      getTimezone: function () { return API.getString('locale', 'timezone', 'Africa/Cairo'); },
      getDateFormat: function () { return API.getString('locale', 'date_format', 'DD/MM/YYYY'); },
      getTimeFormat: function () { return API.getString('locale', 'time_format', '24h'); },

      formatMoney: function (amount) {
        const symbol = API.locale.getCurrencySymbol();
        const num = Number(amount) || 0;
        return num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + symbol;
      }
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Helper APIs — الهوية
    // ═══════════════════════════════════════════════════════
    identity: {
      getSystemName: function () { return API.getString('identity', 'system_name', 'رفاد'); },
      getTagline: function () { return API.getString('identity', 'system_tagline', 'نظام إدارة الأدوية'); },
      getLogoUrl: function () { return API.getString('identity', 'logo_url', null); },
      getBorderRadius: function () { return API.getNumber('identity', 'border_radius', 14); },
      getDensity: function () { return API.getString('identity', 'density', 'comfortable'); }
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Helper APIs — المحاسبة
    // ═══════════════════════════════════════════════════════
    accounting: {
      getCostMethod: function () { return API.getString('accounting', 'cost_method', 'fifo'); },
      getFiscalYearStart: function () { return API.getString('accounting', 'fiscal_year_start', '01-01'); },
      isTaxIncluded: function () {
        const v = API.get('accounting', 'tax_included', 'false');
        return v === 'true' || v === true;
      },
      getRoundingMethod: function () { return API.getString('accounting', 'rounding_method', 'round'); }
    },

    // ═══════════════════════════════════════════════════════
    // ✅ Utilities
    // ═══════════════════════════════════════════════════════

    /**
     * تطبيق الإعدادات على DOM فوراً
     */
    applyToDOM: function () {
      applyIdentityToDOM();
    },

    clearCache: function () {
      state.cache = {};
      state.loadedSections = {};
      state.lastFetch = {};
      console.log('[Settings] Cache cleared');
    },

    getCacheStatus: function () {
      return {
        sections: Object.keys(state.cache),
        loadedSections: Object.keys(state.loadedSections),
        lastFetch: { ...state.lastFetch },
        defaults: Object.keys(DEFAULTS)
      };
    },

    getSections: function () {
      return Object.keys(DEFAULTS);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // 7) Auto-init + Auto-apply
  // ═══════════════════════════════════════════════════════════

  // تهيئة الـ cache بالافتراضي
  Object.keys(DEFAULTS).forEach(function (section) {
    state.cache[section] = { ...DEFAULTS[section] };
  });

  // ✅ الاستماع لتغيير الإعدادات لتطبيقها فوراً
  window.addEventListener('refad:setting-changed', function (e) {
    const detail = e.detail || {};
    if (['identity', 'locale', 'theme'].includes(detail.section)) {
      applyIdentityToDOM();
    }
  });

  async function initAsync() {
    if (!getCompanyId()) {
      console.log('[Settings] No active session — using defaults');
      return;
    }

    const prioritySections = ['theme', 'identity', 'locale', 'security'];
    Promise.all(prioritySections.map(function (s) {
      return loadSection(s, false).catch(function () { return null; });
    })).then(function () {
      // ✅ طبّق الإعدادات بعد التحميل
      applyIdentityToDOM();

      console.log('%c[Refad] Settings ready', 'color:#14B8A6;font-weight:bold');
      window.dispatchEvent(new CustomEvent('refad:settings-ready'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(initAsync, 200);
    });
  } else {
    setTimeout(initAsync, 200);
  }

  // ═══════════════════════════════════════════════════════════
  // 8) Expose to window
  // ═══════════════════════════════════════════════════════════
  window.RefadSettings = API;

  console.log('%c[Refad] Settings API v2.0 loaded (Helper APIs + Auto-apply)', 'color:#14B8A6;font-weight:bold');

})();