/**
 * ═══════════════════════════════════════════════════════════════
 * refad-theme-sync.js
 * Version: 2.1.0
 * ═══════════════════════════════════════════════════════════════
 * 
 * طبقة المزامنة المركزية لنظام رفاد
 * - تقرأ إعدادات الشركة من Supabase (company_settings)
 * - تطبق الألوان + الهوية على كل صفحة تلقائياً
 * - تخزن نسخة محلية (cache) لتسريع التحميل
 * - تستمع لتغييرات الثيم في realtime
 * - Fallback: Polling إذا فشل realtime
 * 
 * Changelog v2.1.0:
 *   - Silent Realtime Fallback (بدون رسائل مزعجة)
 *   - Auto-retry مع exponential backoff
 *   - Polling fallback كل 30 ثانية
 *   - يطبق الألوان من cache فوراً قبل DB
 *   - يشتغل حتى بدون realtime
 *   - يستمع لـ visibilitychange
 * 
 * APIs المتاحة:
 *   RefadThemeSync.apply()          → تطبيق الإعدادات يدوياً
 *   RefadThemeSync.refresh()        → مسح الـ cache وجلب جديد
 *   RefadThemeSync.getColors()      → الحصول على الألوان الحالية
 *   RefadThemeSync.getIdentity()    → الحصول على الهوية الحالية
 *   RefadThemeSync.getSetting(cat, key)  → قراءة إعداد معين
 *   RefadThemeSync.saveSetting(cat, key, value)  → حفظ إعداد
 *   RefadThemeSync.applyPreset(key) → تطبيق ثيم جاهز
 *   RefadThemeSync.getPresets()     → كل الثيمات الجاهزة
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // 1) الإعدادات الأساسية
  // ═══════════════════════════════════════════════════════════
  const STORAGE_KEY = 'refad_theme_cache_v2';
  const CACHE_TTL = 5 * 60 * 1000;        // 5 دقائق
  const REALTIME_CHANNEL = 'refad-theme-sync';
  const POLL_INTERVAL_MS = 30000;         // 30 ثانية
  const MAX_REALTIME_RETRIES = 3;
  const RETRY_DELAY_MS = 5000;
  const ERROR_THROTTLE_MS = 300000;       // 5 دقايق

  // الألوان الافتراضية
  const DEFAULT_COLORS = {
    primary: '#0B2C4D',
    accent: '#14B8A6',
    sidebarBg: '#0B2C4D',
    sidebarText: '#cbd5e1',
    success: '#10b981',
    danger: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
    purple: '#8b5cf6',
    gold: '#F59E0B',
    bgLight: '#F1F5F9',
    textLight: '#0f172a',
    bgDark: '#0a1628',
    textDark: '#f1f5f9'
  };

  const DEFAULT_IDENTITY = {
    system_name: 'رفاد',
    system_tagline: 'نظام إدارة الأدوية',
    border_radius: '14',
    density: 'comfortable'
  };

  const DEFAULT_LOCALE = {
    currency: 'EGP',
    currency_symbol: 'ج.م',
    language: 'ar',
    timezone: 'Africa/Cairo',
    date_format: 'DD/MM/YYYY',
    time_format: '24h'
  };

  // ═══════════════════════════════════════════════════════════
  // 2) State
  // ═══════════════════════════════════════════════════════════
  const state = {
    colors: { ...DEFAULT_COLORS },
    identity: { ...DEFAULT_IDENTITY },
    locale: { ...DEFAULT_LOCALE },
    allSettings: {},
    loaded: false,
    loading: false,
    realtimeChannel: null,
    realtimeRetry: 0,
    realtimeRetryTimer: null,
    pollTimer: null,
    lastErrorAt: 0,
    lastFetchAt: 0,
    silentMode: true
  };

  // ═══════════════════════════════════════════════════════════
  // 3) Helpers
  // ═══════════════════════════════════════════════════════════

  function shadeColor(color, percent) {
    if (!color || typeof color !== 'string' || color[0] !== '#') return color;
    try {
      const num = parseInt(color.replace('#', ''), 16);
      const amt = Math.round(2.55 * percent);
      const R = Math.max(0, Math.min(255, (num >> 16) + amt));
      const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
      const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
      return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    } catch (e) {
      return color;
    }
  }

  function getContrastColor(hexColor) {
    if (!hexColor || hexColor[0] !== '#') return '#ffffff';
    try {
      const hex = hexColor.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
      return (yiq >= 128) ? '#0f172a' : '#ffffff';
    } catch (e) {
      return '#ffffff';
    }
  }

  function getCurrentMode() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function whenReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
    } else {
      callback();
    }
  }

  function camelToSnake(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  // ✨ Throttled warning
  function logSilentWarning(message) {
    if (!state.silentMode) {
      console.warn('[ThemeSync]', message);
      return;
    }
    if (Date.now() - state.lastErrorAt > ERROR_THROTTLE_MS) {
      state.lastErrorAt = Date.now();
      console.warn('[ThemeSync]', message);
      console.warn('[ThemeSync] Realtime unavailable. Theme sync will use polling fallback.');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 4) تطبيق الألوان على CSS Variables
  // ═══════════════════════════════════════════════════════════

  function applyColors(colors) {
    if (!colors) colors = state.colors;
    const root = document.documentElement;

    if (colors.primary) {
      root.style.setProperty('--primary', colors.primary);
      root.style.setProperty('--primary-light', shadeColor(colors.primary, 15));
    }
    if (colors.accent) {
      root.style.setProperty('--accent', colors.accent);
      root.style.setProperty('--accent-dark', shadeColor(colors.accent, -15));
    }
    if (colors.sidebarBg) {
      root.style.setProperty('--sidebar-bg', colors.sidebarBg);
    }
    if (colors.sidebarText) {
      root.style.setProperty('--sidebar-text', colors.sidebarText);
    }

    if (colors.success) root.style.setProperty('--success', colors.success);
    if (colors.danger) root.style.setProperty('--danger', colors.danger);
    if (colors.warning) root.style.setProperty('--warning', colors.warning);
    if (colors.info) root.style.setProperty('--info', colors.info);
    if (colors.purple) root.style.setProperty('--purple', colors.purple);
    if (colors.gold) root.style.setProperty('--gold', colors.gold);

    const mode = getCurrentMode();
    if (mode === 'light') {
      if (colors.bgLight) root.style.setProperty('--bg', colors.bgLight);
      if (colors.textLight) root.style.setProperty('--text', colors.textLight);
    } else {
      if (colors.bgDark) root.style.setProperty('--bg', colors.bgDark);
      if (colors.textDark) root.style.setProperty('--text', colors.textDark);
    }

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme && colors.primary) {
      metaTheme.setAttribute('content', colors.primary);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 5) تطبيق الهوية
  // ═══════════════════════════════════════════════════════════

  function applyIdentity(identity) {
    if (!identity) identity = state.identity;

    if (identity.system_name) {
      const brandH2 = document.querySelector('.sidebar-brand h2');
      if (brandH2) brandH2.textContent = identity.system_name;

      const currentTitle = document.title || '';
      if (currentTitle.includes('رفاد')) {
        document.title = currentTitle.replace(/رفاد/g, identity.system_name);
      }
    }

    if (identity.system_tagline) {
      const brandP = document.querySelector('.sidebar-brand p');
      if (brandP) brandP.textContent = identity.system_tagline;
    }

    if (identity.border_radius != null) {
      const r = parseInt(identity.border_radius, 10) || 14;
      document.documentElement.style.setProperty('--radius', r + 'px');
      document.documentElement.style.setProperty('--radius-sm', Math.max(6, r - 4) + 'px');
    }

    if (identity.density) {
      const topbar = document.documentElement;
      if (identity.density === 'compact') {
        topbar.style.setProperty('--topbar-h', '56px');
      } else if (identity.density === 'spacious') {
        topbar.style.setProperty('--topbar-h', '72px');
      } else {
        topbar.style.setProperty('--topbar-h', '64px');
      }
    }

    // ✨ تطبيق الشعار إن وُجد
    if (identity.logo_url) {
      const logoImgs = document.querySelectorAll('.sidebar-logo img');
      logoImgs.forEach(function (img) {
        if (img.src !== identity.logo_url) {
          img.src = identity.logo_url;
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 6) Cache Management
  // ═══════════════════════════════════════════════════════════

  function loadFromCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached.timestamp || (Date.now() - cached.timestamp > CACHE_TTL)) {
        return null;
      }
      return cached;
    } catch (e) {
      return null;
    }
  }

  // ✨ تحميل من cache حتى لو منتهي الصلاحية (للـ fallback)
  function loadStaleCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveToCache() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        timestamp: Date.now(),
        colors: state.colors,
        identity: state.identity,
        locale: state.locale,
        allSettings: state.allSettings
      }));
    } catch (e) {
      console.warn('[ThemeSync] Cache save failed:', e.message);
    }
  }

  function clearCache() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  // 7) Fetch from DB
  // ═══════════════════════════════════════════════════════════

  async function fetchFromDB(companyId) {
    if (!window.Refad || !Refad.db) {
      return null;
    }

    try {
      const rows = await Refad.db.select('company_settings', {
        columns: 'category, key, value, value_type',
        eq: { company_id: companyId }
      }).catch(function (e) {
        return null;
      });

      if (!rows) return null;

      const all = {};
      rows.forEach(function (r) {
        if (!all[r.category]) all[r.category] = {};
        all[r.category][r.key] = r.value;
      });

      const colors = {};
      const themeSettings = all.theme || {};
      Object.keys(DEFAULT_COLORS).forEach(function (k) {
        const snakeKey = camelToSnake(k) + '_color';
        const alternateKey = camelToSnake(k);
        colors[k] = themeSettings[snakeKey] || themeSettings[alternateKey] || DEFAULT_COLORS[k];
      });

      const identity = {};
      const identitySettings = all.identity || {};
      Object.keys(DEFAULT_IDENTITY).forEach(function (k) {
        identity[k] = identitySettings[k] || DEFAULT_IDENTITY[k];
      });

      const locale = {};
      const localeSettings = all.locale || {};
      Object.keys(DEFAULT_LOCALE).forEach(function (k) {
        locale[k] = localeSettings[k] || DEFAULT_LOCALE[k];
      });

      return {
        colors: colors,
        identity: identity,
        locale: locale,
        all: all,
        raw: rows
      };
    } catch (e) {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 8) Apply Sync (main function)
  // ═══════════════════════════════════════════════════════════

  async function applySync() {
    if (state.loading) return;
    state.loading = true;

    try {
      if (!window.Refad || !Refad.Session || typeof Refad.Session.get !== 'function') {
        applyColors(DEFAULT_COLORS);
        applyIdentity(DEFAULT_IDENTITY);
        state.colors = { ...DEFAULT_COLORS };
        state.identity = { ...DEFAULT_IDENTITY };
        state.locale = { ...DEFAULT_LOCALE };
        state.loaded = true;
        return;
      }

      const session = Refad.Session.get();
      if (!session || !session.company_id) {
        applyColors(DEFAULT_COLORS);
        applyIdentity(DEFAULT_IDENTITY);
        state.loaded = true;
        return;
      }

      // 1) حاول من الـ cache (فوري)
      const cached = loadFromCache();
      if (cached && cached.colors) {
        state.colors = cached.colors;
        state.identity = cached.identity || DEFAULT_IDENTITY;
        state.locale = cached.locale || DEFAULT_LOCALE;
        state.allSettings = cached.allSettings || {};
        applyColors(state.colors);
        applyIdentity(state.identity);
      }

      // 2) اجلب من الـ DB
      const fresh = await fetchFromDB(session.company_id);

      if (fresh) {
        state.colors = fresh.colors;
        state.identity = fresh.identity;
        state.locale = fresh.locale;
        state.allSettings = fresh.all;
        state.loaded = true;
        state.lastFetchAt = Date.now();

        applyColors(state.colors);
        applyIdentity(state.identity);
        saveToCache();
      } else if (!cached) {
        state.colors = { ...DEFAULT_COLORS };
        state.identity = { ...DEFAULT_IDENTITY };
        state.locale = { ...DEFAULT_LOCALE };
        applyColors(state.colors);
        applyIdentity(state.identity);
        state.loaded = true;
      }
    } catch (e) {
      // Fallback صامت
      if (!state.loaded) {
        const stale = loadStaleCache();
        if (stale && stale.colors) {
          state.colors = stale.colors;
          state.identity = stale.identity || DEFAULT_IDENTITY;
          state.locale = stale.locale || DEFAULT_LOCALE;
        } else {
          state.colors = { ...DEFAULT_COLORS };
          state.identity = { ...DEFAULT_IDENTITY };
        }
        applyColors(state.colors);
        applyIdentity(state.identity);
        state.loaded = true;
      }
    } finally {
      state.loading = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ✨ 9) Polling Fallback (كل 30 ثانية)
  // ═══════════════════════════════════════════════════════════

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = window.setInterval(async function () {
      if (document.hidden) return; // ما تعملش poll لو التاب مخفي
      if (Date.now() - state.lastFetchAt < POLL_INTERVAL_MS - 5000) return;
      try {
        const session = Refad.Session?.get?.();
        if (!session?.company_id) return;
        const fresh = await fetchFromDB(session.company_id);
        if (fresh) {
          const colorsChanged = JSON.stringify(fresh.colors) !== JSON.stringify(state.colors);
          const identityChanged = JSON.stringify(fresh.identity) !== JSON.stringify(state.identity);
          if (colorsChanged || identityChanged) {
            state.colors = fresh.colors;
            state.identity = fresh.identity;
            state.locale = fresh.locale;
            state.allSettings = fresh.all;
            state.lastFetchAt = Date.now();
            applyColors(state.colors);
            applyIdentity(state.identity);
            saveToCache();
            window.dispatchEvent(new CustomEvent('refad:theme-changed', {
              detail: { colors: state.colors, identity: state.identity, source: 'polling' }
            }));
          }
        }
      } catch (e) {
        // silent
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ✨ 10) Realtime Sync (v2 — Silent + Retry)
  // ═══════════════════════════════════════════════════════════

  function scheduleRealtimeRetry() {
    if (state.realtimeRetryTimer) return;
    if (state.realtimeRetry >= MAX_REALTIME_RETRIES) {
      logSilentWarning('Max realtime retries reached. Using polling only.');
      startPolling();
      return;
    }
    state.realtimeRetry++;
    const delay = RETRY_DELAY_MS * Math.pow(2, state.realtimeRetry - 1);
    state.realtimeRetryTimer = window.setTimeout(function () {
      state.realtimeRetryTimer = null;
      setupRealtime();
    }, delay);
  }

  function setupRealtime() {
    if (!window.Refad || !Refad.sb) {
      startPolling();
      return;
    }
    if (!window.Refad.Session || typeof Refad.Session.get !== 'function') {
      startPolling();
      return;
    }

    const session = Refad.Session.get();
    if (!session || !session.company_id) {
      return;
    }

    // لو الـ channel موجود بالفعل، لا تنشئ واحد جديد
    if (state.realtimeChannel) return;

    try {
      state.realtimeChannel = Refad.sb
        .channel(REALTIME_CHANNEL)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'company_settings',
          filter: 'company_id=eq.' + session.company_id
        }, function (payload) {
          // settings changed → refresh
          clearCache();
          applySync().then(function () {
            window.dispatchEvent(new CustomEvent('refad:theme-changed', {
              detail: { colors: state.colors, identity: state.identity, source: 'realtime' }
            }));
          });
        })
        .subscribe(function (status) {
          if (status === 'SUBSCRIBED') {
            state.realtimeRetry = 0;
            console.log('%c[ThemeSync] ✅ Realtime subscribed', 'color:#14B8A6');
            // أوقف polling (realtime شغال)
            stopPolling();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            logSilentWarning('Realtime subscription failed: ' + status);
            // امسح الـ channel
            if (state.realtimeChannel) {
              try {
                Refad.sb.removeChannel(state.realtimeChannel).catch(function () {});
              } catch (e) {}
              state.realtimeChannel = null;
            }
            // ابدأ polling كـ fallback
            startPolling();
            // جدول retry
            scheduleRealtimeRetry();
          } else if (status === 'CLOSED') {
            state.realtimeChannel = null;
            startPolling();
          }
        });
    } catch (e) {
      state.realtimeChannel = null;
      startPolling();
      scheduleRealtimeRetry();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 11) Watch Theme Changes
  // ═══════════════════════════════════════════════════════════

  function watchThemeToggle() {
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName === 'data-theme') {
          applyColors(state.colors);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  // ✨ Watch visibility changes
  function watchVisibility() {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        // رجع للتاب — refresh
        const session = Refad.Session?.get?.();
        if (session?.company_id && Date.now() - state.lastFetchAt > 60000) {
          applySync();
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 12) Public APIs
  // ═══════════════════════════════════════════════════════════

  const API = {
    apply: applySync,

    refresh: async function () {
      clearCache();
      await applySync();
      return { colors: state.colors, identity: state.identity, locale: state.locale };
    },

    getColors: function () {
      return { ...state.colors };
    },

    getIdentity: function () {
      return { ...state.identity };
    },

    getLocale: function () {
      return { ...state.locale };
    },

    getSetting: function (category, key, defaultValue) {
      if (state.allSettings && state.allSettings[category] && state.allSettings[category][key] !== undefined) {
        return state.allSettings[category][key];
      }
      return defaultValue;
    },

    saveSetting: async function (category, key, value) {
      if (!window.Refad || !Refad.Session) throw new Error('Refad not initialized');
      const session = Refad.Session.get();
      if (!session || !session.company_id) throw new Error('No active session');

      try {
        if (Refad.sb && Refad.sb.rpc) {
          const result = await Refad.sb.rpc('save_company_setting', {
            p_company_id: session.company_id,
            p_category: category,
            p_key: key,
            p_value: String(value),
            p_value_type: typeof value === 'boolean' ? 'boolean' :
                           typeof value === 'number' ? 'number' : 'string',
            p_user_id: session.user_id || null
          });

          if (result.error) throw result.error;
        } else {
          const existing = await Refad.db.selectOne('company_settings', {
            eq: { company_id: session.company_id, category: category, key: key }
          }).catch(function () { return null; });

          if (existing) {
            await Refad.db.update('company_settings', existing.id, { value: String(value) });
          } else {
            await Refad.db.insert('company_settings', {
              company_id: session.company_id,
              category: category,
              key: key,
              value: String(value),
              value_type: typeof value === 'boolean' ? 'boolean' :
                          typeof value === 'number' ? 'number' : 'string',
              updated_by: session.user_id || null
            });
          }
        }

        if (!state.allSettings[category]) state.allSettings[category] = {};
        state.allSettings[category][key] = String(value);

        saveToCache();
        return true;
      } catch (e) {
        console.error('[ThemeSync] saveSetting failed:', e);
        throw e;
      }
    },

    saveManySettings: async function (category, settingsObject) {
      const results = [];
      for (const key of Object.keys(settingsObject)) {
        try {
          await API.saveSetting(category, key, settingsObject[key]);
          results.push({ key: key, success: true });
        } catch (e) {
          results.push({ key: key, success: false, error: e.message });
        }
      }
      return results;
    },

    applyPreset: async function (presetKey) {
      if (!window.Refad || !Refad.Session) throw new Error('Refad not initialized');
      const session = Refad.Session.get();
      if (!session || !session.company_id) throw new Error('No active session');

      try {
        const result = await Refad.sb.rpc('apply_theme_preset', {
          p_company_id: session.company_id,
          p_preset_key: presetKey,
          p_user_id: session.user_id || null
        });

        if (result.error) throw result.error;

        clearCache();
        await applySync();

        return { success: true, colors: state.colors };
      } catch (e) {
        console.error('[ThemeSync] applyPreset failed:', e);
        throw e;
      }
    },

    getPresets: async function () {
      if (!window.Refad || !Refad.db) return [];
      try {
        const rows = await Refad.db.select('theme_presets', {
          columns: 'key, name_ar, name_en, description, is_default, colors, mode',
          eq: { is_active: true },
          order: { column: 'is_default', ascending: false }
        });
        return rows || [];
      } catch (e) {
        return [];
      }
    },

    getState: function () {
      return {
        loaded: state.loaded,
        loading: state.loading,
        colors: { ...state.colors },
        identity: { ...state.identity },
        locale: { ...state.locale }
      };
    },

    reload: function () {
      clearCache();
      return applySync();
    },

    // ✨ APIs جديدة للتشخيص
    getRealtimeStatus: function () {
      return {
        channelActive: !!state.realtimeChannel,
        retryCount: state.realtimeRetry,
        pollingActive: !!state.pollTimer,
        lastFetch: state.lastFetchAt ? new Date(state.lastFetchAt).toISOString() : null
      };
    },

    setSilentMode: function (silent) {
      state.silentMode = !!silent;
    }
  };

  // ═══════════════════════════════════════════════════════════
  // 13) Expose to window
  // ═══════════════════════════════════════════════════════════
  window.RefadThemeSync = API;

  // ═══════════════════════════════════════════════════════════
  // 14) Auto-init
  // ═══════════════════════════════════════════════════════════

  // 1) طبّق من الـ cache فوراً
  const cached = loadFromCache();
  if (cached && cached.colors) {
    state.colors = cached.colors;
    state.identity = cached.identity || DEFAULT_IDENTITY;
    state.locale = cached.locale || DEFAULT_LOCALE;
    state.allSettings = cached.allSettings || {};
    applyColors(state.colors);
    applyIdentity(state.identity);
  } else {
    const stale = loadStaleCache();
    if (stale && stale.colors) {
      state.colors = stale.colors;
      state.identity = stale.identity || DEFAULT_IDENTITY;
      state.locale = stale.locale || DEFAULT_LOCALE;
      state.allSettings = stale.allSettings || {};
      applyColors(state.colors);
      applyIdentity(state.identity);
    } else {
      applyColors(DEFAULT_COLORS);
      applyIdentity(DEFAULT_IDENTITY);
    }
  }

  // 2) راقب تغيير الوضع
  watchThemeToggle();

  // 3) راقب visibilitychange
  watchVisibility();

  // 4) بعد تحميل DOM — اجلب من DB
  whenReady(function () {
    setTimeout(function () {
      applySync().then(function () {
        // ✨ ابدأ polling كـ fallback دايماً
        startPolling();

        // ✨ حاول realtime
        setupRealtime();

        window.dispatchEvent(new CustomEvent('refad:theme-ready', {
          detail: { colors: state.colors, identity: state.identity }
        }));

        console.log('%c[Refad] ThemeSync v2.1 ready (Silent + Polling Fallback)', 'color:#14B8A6;font-weight:bold');
      });
    }, 100);
  });

  // ✨ تنظيف عند إغلاق الصفحة
  window.addEventListener('beforeunload', function () {
    stopPolling();
    if (state.realtimeChannel) {
      try {
        Refad.sb.removeChannel(state.realtimeChannel).catch(function () {});
      } catch (e) {}
    }
  });

})();