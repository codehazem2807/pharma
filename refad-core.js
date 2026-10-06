/* ============================================================
 * Refad ERP - Core Module
 * Version: 1.0.0
 * Dependencies: @supabase/supabase-js@2 (must be loaded before)
 * ============================================================ */

(function (window) {
  'use strict';

  // ============================================================
  // 1) الإعدادات الثابتة
  // ============================================================
  const CONFIG = {
    SUPABASE_URL: 'https://vbowtnbqfntqubuydzxd.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZib3d0bmJxZm50cXVidXlkenhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExOTIzOTksImV4cCI6MjEwNjc2ODM5OX0.KDG64v6zJZXOJJOizxp5NaGfECprbH0sxDTRfLSN_hg',
    SESSION_KEY: 'refad_session',
    THEME_KEY: 'refad_theme',
    IDLE_TIMEOUT_MIN: 30,
    SESSION_HOURS: 8,
    APP_NAME: 'رفاد',
    APP_VERSION: '1.0.0'
  };

  // ============================================================
  // 2) Supabase Client
  // ============================================================
  if (!window.supabase || !window.supabase.createClient) {
    console.error('[Refad] Supabase JS library not loaded! Add it before refad-core.js');
  }

  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'refad-erp' } }
  });

  // ============================================================
  // 3) Session Manager
  // ============================================================
  let notificationRealtimeChannel = null;
  let notificationPollTimer = null;
  let notificationPollCursor = null;
  let notificationPollWarningAt = 0;
  const seenNotificationIds = new Set();

  const notificationPermissionByType = {
    expiry: 'inventory.view',
    low_stock: 'inventory.view',
    invoice: 'sales.view',
    message: 'chat.use',
    purchase: 'purchases.view',
    receipt: 'purchases.view',
    stock: 'inventory.view',
    payment: 'company.owner'
  };

  const Session = {
    get() {
      try {
        const raw = localStorage.getItem(CONFIG.SESSION_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (s.expires_at && Date.now() > s.expires_at) {
          this.clear();
          return null;
        }
        return s;
      } catch (e) {
        this.clear();
        return null;
      }
    },

    set(data) {
      const now = Date.now();
      const session = {
        user_id: data.user_id,
        company_id: data.company_id,
        role_id: data.role_id,
        username: data.username,
        full_name: data.full_name,
        avatar_url: data.avatar_url || null,
        is_owner: data.is_owner === true,
        is_superadmin: data.is_superadmin === true,
        permissions: data.permissions || [],
        login_time: now,
        expires_at: now + CONFIG.SESSION_HOURS * 60 * 60 * 1000,
        last_activity: now
      };
      localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
      startNotificationRealtime();
      return session;
    },

    clear() {
      if (notificationRealtimeChannel) {
        sb.removeChannel(notificationRealtimeChannel).catch(error => {
          console.warn('[Refad] Notification channel cleanup failed:', error.message);
        });
        notificationRealtimeChannel = null;
      }
      if (notificationPollTimer) {
        window.clearInterval(notificationPollTimer);
        notificationPollTimer = null;
      }
      notificationPollCursor = null;
      seenNotificationIds.clear();
      localStorage.removeItem(CONFIG.SESSION_KEY);
    },

    touch() {
      const s = this.get();
      if (!s) return;
      s.last_activity = Date.now();
      localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(s));
    },

    has(permission) {
      const s = this.get();
      if (!s) return false;
      if (permission === 'company.owner') return s.is_owner === true;
      if (permission === 'reports.view') return s.is_owner === true;
      if (permission === 'system.admin' || permission === 'admin.full') return s.is_superadmin === true;
      if (s.is_superadmin) return true;
      if (!s.permissions || s.permissions.length === 0) return false;
      return s.permissions.includes(permission);
    },

    require() {
      const s = this.get();
      if (!s) {
        window.location.href = 'index.html';
        return null;
      }
      return s;
    },

    requirePermission(permission) {
      const s = this.require();
      if (!s) return null;
      if (!this.has(permission)) {
        Refad.toast.error('ليس لديك صلاحية للوصول لهذه الصفحة');
        setTimeout(() => history.back(), 1500);
        return null;
      }
      return s;
    }
  };

  // ============================================================
  // 4) Toast Notifications (Toastify wrapper)
  // ============================================================
  const toast = {
    _show(message, type, duration) {
      if (typeof Toastify === 'undefined') {
        console.log(`[${type}] ${message}`);
        return;
      }
      const colors = {
        success: 'linear-gradient(to right, #14B8A6, #0d9488)',
        error:   'linear-gradient(to right, #ef4444, #b91c1c)',
        warning: 'linear-gradient(to right, #F59E0B, #d97706)',
        info:    'linear-gradient(to right, #0B2C4D, #1e40af)'
      };
      Toastify({
        text: message,
        duration: duration || 3000,
        gravity: 'top',
        position: 'left',
        style: {
          background: colors[type] || colors.info,
          borderRadius: '10px',
          fontFamily: 'Cairo, sans-serif',
          fontSize: '14px',
          padding: '12px 20px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }
      }).showToast();
    },
    success(msg, d) { this._show(msg, 'success', d); },
    error(msg, d)   { this._show(msg, 'error', d || 4000); },
    warning(msg, d) { this._show(msg, 'warning', d); },
    info(msg, d)    { this._show(msg, 'info', d); }
  };

  // ============================================================
  // 5) SweetAlert Helpers
  // ============================================================
  const alert = {
    _swal() {
      if (typeof Swal === 'undefined') {
        console.warn('[Refad] SweetAlert2 not loaded');
        return null;
      }
      return Swal;
    },
    success(title, text) {
      const s = this._swal();
      if (!s) return;
      return s.fire({ icon: 'success', title, text, confirmButtonColor: '#14B8A6' });
    },
    error(title, text) {
      const s = this._swal();
      if (!s) return;
      return s.fire({ icon: 'error', title, text, confirmButtonColor: '#ef4444' });
    },
    warning(title, text) {
      const s = this._swal();
      if (!s) return;
      return s.fire({ icon: 'warning', title, text, confirmButtonColor: '#F59E0B' });
    },
    info(title, text) {
      const s = this._swal();
      if (!s) return;
      return s.fire({ icon: 'info', title, text, confirmButtonColor: '#0B2C4D' });
    },
    async confirm(title, text, confirmText) {
      const s = this._swal();
      if (!s) return window.confirm(`${title}\n${text || ''}`);
      const r = await s.fire({
        icon: 'question',
        title,
        text,
        showCancelButton: true,
        confirmButtonText: confirmText || 'نعم',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#14B8A6',
        cancelButtonColor: '#94a3b8',
        reverseButtons: true
      });
      return r.isConfirmed;
    },
    loading(title) {
      const s = this._swal();
      if (!s) return;
      s.fire({
        title: title || 'جارٍ التحميل...',
        allowOutsideClick: false,
        didOpen: () => s.showLoading()
      });
    },
    close() {
      const s = this._swal();
      if (s) s.close();
    }
  };

  // ============================================================
  // 6) DOM Helpers
  // ============================================================
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(c => {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // 7) Formatters
  // ============================================================
  const format = {
    money(v, currency) {
      const n = Number(v) || 0;
      const cur = currency || 'ج.م';
      return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur;
    },
    number(v, decimals) {
      const n = Number(v) || 0;
      const d = decimals === undefined ? 0 : decimals;
      return n.toLocaleString('ar-EG', { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    date(v, format) {
      if (!v) return '—';
      const d = (typeof dayjs !== 'undefined') ? dayjs(v) : new Date(v);
      if (typeof dayjs !== 'undefined') {
        return d.format(format || 'YYYY/MM/DD');
      }
      return d.toLocaleDateString('ar-EG');
    },
    datetime(v) {
      return this.date(v, 'YYYY/MM/DD HH:mm');
    },
    time(v) {
      return this.date(v, 'HH:mm');
    },
    relative(v) {
      if (!v || typeof dayjs === 'undefined') return '—';
      const d = dayjs(v);
      const diff = dayjs().diff(d, 'day');
      if (diff === 0) return 'اليوم';
      if (diff === 1) return 'أمس';
      if (diff < 30) return `منذ ${diff} يوم`;
      if (diff < 365) return `منذ ${Math.floor(diff / 30)} شهر`;
      return `منذ ${Math.floor(diff / 365)} سنة`;
    },
    daysLeft(date) {
      if (!date || typeof dayjs === 'undefined') return null;
      return dayjs(date).diff(dayjs(), 'day');
    },
    phone(v) {
      if (!v) return '—';
      return String(v).replace(/(\d{4})(\d{3})(\d{4})/, '$1 $2 $3');
    }
  };

  // ============================================================
  // 8) Date Helpers
  // ============================================================
  const dateUtil = {
    today() {
      return (typeof dayjs !== 'undefined') ? dayjs().format('YYYY-MM-DD') : new Date().toISOString().slice(0, 10);
    },
    now() {
      return new Date().toISOString();
    },
    addDays(dateStr, days) {
      if (typeof dayjs !== 'undefined') return dayjs(dateStr).add(days, 'day').format('YYYY-MM-DD');
      const d = new Date(dateStr);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    },
    diffDays(a, b) {
      if (typeof dayjs !== 'undefined') return dayjs(a).diff(dayjs(b), 'day');
      return Math.floor((new Date(a) - new Date(b)) / 86400000);
    },
    startOfMonth() {
      return (typeof dayjs !== 'undefined') ? dayjs().startOf('month').format('YYYY-MM-DD') : null;
    },
    endOfMonth() {
      return (typeof dayjs !== 'undefined') ? dayjs().endOf('month').format('YYYY-MM-DD') : null;
    }
  };

  // ============================================================
  // 9) Database Helpers (Supabase wrappers)
  // ============================================================
  const db = {
    /**
     * جلب صفوف من جدول
     */
    async select(table, options = {}) {
      let q = sb.from(table).select(options.columns || '*');
      if (options.eq) {
        Object.entries(options.eq).forEach(([k, v]) => { q = q.eq(k, v); });
      }
      if (options.neq) {
        Object.entries(options.neq).forEach(([k, v]) => { q = q.neq(k, v); });
      }
      if (options.in) {
        Object.entries(options.in).forEach(([k, v]) => { q = q.in(k, v); });
      }
      if (options.gt) {
        Object.entries(options.gt).forEach(([k, v]) => { q = q.gt(k, v); });
      }
      if (options.gte) {
        Object.entries(options.gte).forEach(([k, v]) => { q = q.gte(k, v); });
      }
      if (options.lt) {
        Object.entries(options.lt).forEach(([k, v]) => { q = q.lt(k, v); });
      }
      if (options.lte) {
        Object.entries(options.lte).forEach(([k, v]) => { q = q.lte(k, v); });
      }
      if (options.ilike) {
        Object.entries(options.ilike).forEach(([k, v]) => { q = q.ilike(k, `%${v}%`); });
      }
      if (options.order) {
        q = q.order(options.order.column, { ascending: options.order.ascending !== false });
      }
      if (options.limit) q = q.limit(options.limit);
      if (options.range) q = q.range(options.range[0], options.range[1]);

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async selectOne(table, options = {}) {
      const rows = await this.select(table, { ...options, limit: 1 });
      return rows[0] || null;
    },

    async insert(table, payload) {
      const { data, error } = await sb.from(table).insert(payload).select();
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async insertMany(table, rows) {
      if (!rows || rows.length === 0) return [];
      const { data, error } = await sb.from(table).insert(rows).select();
      if (error) throw error;
      return data || [];
    },

    async update(table, id, payload) {
      const { data, error } = await sb.from(table).update(payload).eq('id', id).select();
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },

    async updateWhere(table, conditions, payload) {
      let q = sb.from(table).update(payload);
      Object.entries(conditions).forEach(([k, v]) => { q = q.eq(k, v); });
      const { data, error } = await q.select();
      if (error) throw error;
      return data || [];
    },

    async remove(table, id) {
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) throw error;
      return true;
    },

    async removeWhere(table, conditions) {
      let q = sb.from(table).delete();
      Object.entries(conditions).forEach(([k, v]) => { q = q.eq(k, v); });
      const { error } = await q;
      if (error) throw error;
      return true;
    },

    async count(table, options = {}) {
      let q = sb.from(table).select('*', { count: 'exact', head: true });
      if (options.eq) {
        Object.entries(options.eq).forEach(([k, v]) => { q = q.eq(k, v); });
      }
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    },

    /**
     * استدعاء RPC (لو استخدمنا functions لاحقاً)
     */
    async rpc(name, params) {
      const { data, error } = await sb.rpc(name, params || {});
      if (error) throw error;
      return data;
    }
  };

  // ============================================================
  // 10) Storage Helpers
  // ============================================================
  const storage = {
    async upload(bucket, path, file, options = {}) {
      const { data, error } = await sb.storage.from(bucket).upload(path, file, {
        cacheControl: '3600',
        upsert: options.upsert || false,
        contentType: options.contentType || file.type
      });
      if (error) throw error;
      return this.publicUrl(bucket, data.path);
    },

    publicUrl(bucket, path) {
      const { data } = sb.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    },

    async remove(bucket, paths) {
      const { error } = await sb.storage.from(bucket).remove(Array.isArray(paths) ? paths : [paths]);
      if (error) throw error;
      return true;
    },

    /**
     * ضغط صورة باستخدام Canvas (توفير مساحة)
     */
    async compressImage(file, maxWidth = 1200, quality = 0.8) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > maxWidth) {
              h = Math.round((h * maxWidth) / w);
              w = maxWidth;
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
  };

  // ============================================================
  // 11) Theme Manager (Light / Dark)
  // ============================================================
  const theme = {
    get() {
      return localStorage.getItem(CONFIG.THEME_KEY) || 'light';
    },
    set(mode) {
      localStorage.setItem(CONFIG.THEME_KEY, mode);
      this.apply(mode);
    },
    toggle() {
      const next = this.get() === 'light' ? 'dark' : 'light';
      this.set(next);
      return next;
    },
    apply(mode) {
      const m = mode || this.get();
      document.documentElement.setAttribute('data-theme', m);
      if (m === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      window.dispatchEvent(new CustomEvent('refad:theme-changed', { detail: { theme: m } }));
    },
    init() {
      this.apply(this.get());
    }
  };

  // ============================================================
  // 12) Idle Timer (Auto Logout)
  // ============================================================
  let _idleTimer = null;
  function resetIdleTimer() {
    if (_idleTimer) clearTimeout(_idleTimer);
    if (!Session.get()) return;
    _idleTimer = setTimeout(() => {
      Session.clear();
      alert.warning('انتهت الجلسة', 'تم تسجيل خروجك تلقائياً بسبب عدم النشاط').then(() => {
        window.location.href = 'index.html';
      });
    }, CONFIG.IDLE_TIMEOUT_MIN * 60 * 1000);
  }

  function initIdleWatcher() {
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
      document.addEventListener(evt, () => {
        if (Session.get()) {
          Session.touch();
          resetIdleTimer();
        }
      }, { passive: true });
    });
    resetIdleTimer();
  }

  // ============================================================
  // 13) Activity Logger
  // ============================================================
  async function logActivity(action, module, details, referenceId) {
    const s = Session.get();
    if (!s) return;
    try {
      await db.insert('activity_log', {
        company_id: s.company_id,
        user_id: s.user_id,
        action,
        module: module || null,
        reference_id: referenceId || null,
        details: details ? String(details).slice(0, 500) : null
      });
    } catch (e) {
      console.warn('[Refad] Activity log failed:', e.message);
    }
  }

  // ============================================================
  // 14) Notification Helper
  // ============================================================
  async function notify(userId, companyId, title, body, type, referenceId) {
    const user = await db.selectOne('users', {
      columns: 'id, company_id, role_id',
      eq: { id: userId }
    });
    if (!user) throw new Error('لا يمكن إرسال إشعار لمستخدم غير موجود');
    if (String(user.company_id) !== String(companyId)) {
      throw new Error('لا يمكن إرسال إشعار بين شركات مختلفة');
    }

    const [role, rolePermissions] = await Promise.all([
      user.role_id ? db.selectOne('roles', {
        columns: 'company_id, is_owner',
        eq: { id: user.role_id }
      }) : null,
      user.role_id ? db.select('role_permissions', {
        columns: 'permissions(code)',
        eq: { role_id: user.role_id }
      }) : []
    ]);
    const permissions = new Set(rolePermissions.map(row => row.permissions?.code).filter(Boolean));
    const requiredPermission = notificationPermissionByType[type];
    const permitted = requiredPermission
      ? (requiredPermission === 'company.owner'
        ? role?.is_owner === true && String(role.company_id) === String(user.company_id)
        : permissions.has(requiredPermission))
      : permissions.has('notifications.view');
    if (!permitted) return null;

    return db.insert('notifications', {
      user_id: userId,
      company_id: companyId,
      title,
      body: body || null,
      type: type || 'system',
      reference_id: referenceId || null
    });
  }

  async function notifyCompany(companyId, title, body, type, referenceId, excludeUserId) {
    const users = await db.select('users', {
      columns: 'id',
      eq: { company_id: companyId, is_active: true }
    });
    const notifications = await Promise.all(users
      .filter(user => String(user.id) !== String(excludeUserId || ''))
      .map(user => notify(user.id, companyId, title, body, type, referenceId)));
    return notifications.filter(Boolean);
  }

  async function notifyCompanyDaily(companyId, title, body, type, referenceId, excludeUserId) {
    if (referenceId === null || referenceId === undefined) {
      throw new Error('التنبيه اليومي يحتاج مرجعاً واضحاً لمنع التكرار');
    }
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [existing, users] = await Promise.all([
      db.select('notifications', {
        columns: 'user_id',
        eq: { company_id: companyId, type, reference_id: referenceId },
        gte: { created_at: startOfDay.toISOString() },
        limit: 5000
      }),
      db.select('users', {
        columns: 'id',
        eq: { company_id: companyId, is_active: true }
      })
    ]);
    const alreadyNotified = new Set(existing.map(row => String(row.user_id)));
    const targets = users.filter(user =>
      String(user.id) !== String(excludeUserId || '') && !alreadyNotified.has(String(user.id))
    );
    return Promise.all(targets.map(user =>
      notify(user.id, companyId, title, body, type, referenceId)
    ));
  }

  async function scanInventoryAlerts(companyId) {
    const session = Session.get();
    if (!session || String(session.company_id) !== String(companyId)) {
      throw new Error('لا يمكن فحص مخزون شركة أخرى');
    }
    if (!Session.has('inventory.view')) return { lowStock: 0, expiring: 0 };

    async function selectAllRows(table, options) {
      const pageSize = 500;
      const rows = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = await db.select(table, {
          ...options,
          range: [offset, offset + pageSize - 1]
        });
        rows.push(...page);
        if (page.length < pageSize) return rows;
      }
    }
    const [products, batches] = await Promise.all([
      selectAllRows('products', {
        columns: 'id, name, reorder_level',
        eq: { company_id: companyId, is_active: true },
        order: { column: 'id', ascending: true }
      }),
      selectAllRows('batches', {
        columns: 'id, product_id, batch_number, expiry_date, quantity_left',
        eq: { company_id: companyId },
        gt: { quantity_left: 0 },
        order: { column: 'id', ascending: true }
      })
    ]);

    const productById = new Map(products.map(product => [String(product.id), product]));
    const inventoryByProduct = new Map();
    batches.forEach(batch => {
      const key = String(batch.product_id);
      inventoryByProduct.set(key, (inventoryByProduct.get(key) || 0) + (Number(batch.quantity_left) || 0));
    });

    const lowStock = products.filter(product => {
      const threshold = Number(product.reorder_level) || 0;
      return threshold > 0 && (inventoryByProduct.get(String(product.id)) || 0) <= threshold;
    });
    const in90Days = dateUtil.addDays(dateUtil.today(), 90);
    const expiring = batches.filter(batch => batch.expiry_date && batch.expiry_date <= in90Days);
    const alerts = [
      ...lowStock.map(product => notifyCompanyDaily(
        companyId,
        'مخزون صنف منخفض',
        `رصيد ${product.name} الحالي ${(inventoryByProduct.get(String(product.id)) || 0).toLocaleString('ar-EG')} عند حد إعادة الطلب أو أقل.`,
        'low_stock',
        product.id
      )),
      ...expiring.map(batch => notifyCompanyDaily(
        companyId,
        'تنبيه صلاحية تشغيلة',
        `التشغيلة ${batch.batch_number || '—'} من ${productById.get(String(batch.product_id))?.name || 'صنف'} تنتهي صلاحيتها ${format.date(batch.expiry_date)}.`,
        'expiry',
        batch.id
      ))
    ];
    const results = [];
    for (let offset = 0; offset < alerts.length; offset += 10) {
      results.push(...await Promise.allSettled(alerts.slice(offset, offset + 10)));
    }
    const failures = results.filter(result => result.status === 'rejected');
    failures.forEach(result => console.error('[Refad] Inventory notification failed:', result.reason));
    return { lowStock: lowStock.length, expiring: expiring.length, failed: failures.length };
  }

  function canReceiveNotification(notification) {
    const permission = notificationPermissionByType[notification.type];
    return permission ? Session.has(permission) : Session.has('notifications.view');
  }

  function presentNotification(notification) {
    const session = Session.get();
    if (!session || String(notification.company_id) !== String(session.company_id)) return;
    if (!canReceiveNotification(notification)) return;
    const id = String(notification.id);
    if (seenNotificationIds.has(id)) return;
    seenNotificationIds.add(id);
    if (seenNotificationIds.size > 200) {
      seenNotificationIds.delete(seenNotificationIds.values().next().value);
    }

    const message = [notification.title, notification.body].filter(Boolean).join(' — ');
    if (!window.location.pathname.endsWith('/notifications.html')) {
      toast.info(message, 6000);
    }
    if (window.Notification?.permission === 'granted' && !window.location.pathname.endsWith('/notifications.html')) {
      try {
        new window.Notification(notification.title, { body: notification.body || '', icon: 'logo.png' });
      } catch (error) {
        console.warn('[Refad] Browser notification failed:', error.message);
      }
    }
  }

  async function pollNotifications() {
    const session = Session.get();
    if (!session?.user_id || !session.company_id) return;
    if (!Object.values(notificationPermissionByType).some(permission => Session.has(permission)) &&
        !Session.has('notifications.view')) return;
    if (!notificationPollCursor) notificationPollCursor = new Date(Date.now() - 15000).toISOString();

    try {
      const rows = await db.select('notifications', {
        columns: 'id, company_id, user_id, title, body, type, reference_id, created_at',
        eq: { user_id: session.user_id, company_id: session.company_id },
        gt: { created_at: notificationPollCursor },
        order: { column: 'created_at', ascending: true },
        limit: 100
      });
      rows.forEach(presentNotification);
      notificationPollCursor = rows.length
        ? rows[rows.length - 1].created_at
        : new Date().toISOString();
    } catch (error) {
      if (Date.now() - notificationPollWarningAt > 60000) {
        notificationPollWarningAt = Date.now();
        console.warn('[Refad] Notification polling failed:', error.message);
        toast.warning('تعذّر تحديث الإشعارات؛ تحقق من اتصال النظام وإعدادات قاعدة البيانات');
      }
    }
  }

  function startNotificationPolling() {
    if (notificationPollTimer) return;
    notificationPollCursor = new Date(Date.now() - 15000).toISOString();
    pollNotifications();
    notificationPollTimer = window.setInterval(pollNotifications, 20000);
  }

  function startNotificationRealtime() {
    const session = Session.get();
    if (!session?.user_id || !session.company_id || notificationRealtimeChannel) return;
    if (!Object.values(notificationPermissionByType).some(permission => Session.has(permission)) &&
        !Session.has('notifications.view')) return;
    startNotificationPolling();
    notificationRealtimeChannel = sb
      .channel(`refad-notifications-${session.user_id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${session.user_id}`
      }, payload => {
        presentNotification(payload.new);
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[Refad] Notification realtime subscription status: ${status}`);
          toast.warning('تعذّر الاتصال بالإشعارات الفورية؛ راجع إعدادات Supabase Realtime واتصال الإنترنت');
        }
      });
  }

  function ensureGlobalNavigation(nav) {
    if (!nav) return;
    if (Session.has('sales.view') || Session.has('purchases.receive')) {
      const operationsHeading = Array.from(nav.querySelectorAll('.nav-section'))
        .find(section => section.textContent.trim() === 'العمليات');
      if (operationsHeading && !nav.querySelector('a[href="returns.html"]')) {
        const link = document.createElement('a');
        link.href = 'returns.html';
        link.className = 'nav-item';
        if (window.location.pathname.endsWith('/returns.html')) link.classList.add('active');
        link.innerHTML = '<i data-lucide="undo-2"></i><span>المرتجعات</span>';
        let nextSection = operationsHeading.nextElementSibling;
        while (nextSection && !nextSection.classList.contains('nav-section')) {
          nextSection = nextSection.nextElementSibling;
        }
        nav.insertBefore(link, nextSection);
        if (window.lucide) window.lucide.createIcons({ root: link });
      }
    }
    if (!Session.has('company.owner') || nav.querySelector('a[href="accounts.html"]')) return;
    let financialHeading = Array.from(nav.querySelectorAll('.nav-section'))
      .find(section => section.textContent.trim() === 'المالية');
    if (!financialHeading) {
      financialHeading = document.createElement('div');
      financialHeading.className = 'nav-section';
      financialHeading.textContent = 'المالية';
      nav.appendChild(financialHeading);
    }
    const link = document.createElement('a');
    link.href = 'accounts.html';
    link.className = 'nav-item';
    if (window.location.pathname.endsWith('/accounts.html')) link.classList.add('active');
    link.innerHTML = '<i data-lucide="landmark"></i><span>الحسابات</span>';
    let nextSection = financialHeading.nextElementSibling;
    while (nextSection && !nextSection.classList.contains('nav-section')) {
      nextSection = nextSection.nextElementSibling;
    }
    nav.insertBefore(link, nextSection);
    if (window.lucide) window.lucide.createIcons({ root: link });
  }

  function addSharedNavigation() {
    if (!Session.has('company.owner') && !Session.has('sales.view') && !Session.has('purchases.receive')) return;
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    ensureGlobalNavigation(nav);
    if (nav.dataset.accountsObserver) return;
    const observer = new MutationObserver(() => ensureGlobalNavigation(nav));
    observer.observe(nav, { childList: true });
    nav.dataset.accountsObserver = 'true';
  }

  // ============================================================
  // 15) Debounce / Throttle
  // ============================================================
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms || 300);
    };
  }

  function throttle(fn, ms) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= (ms || 300)) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  // ============================================================
  // 16) Pagination Helper
  // ============================================================
  function paginate(array, page, perPage) {
    const p = Math.max(1, page || 1);
    const pp = perPage || 20;
    const total = array.length;
    const pages = Math.ceil(total / pp) || 1;
    const start = (p - 1) * pp;
    return {
      data: array.slice(start, start + pp),
      page: p,
      perPage: pp,
      total,
      pages,
      hasNext: p < pages,
      hasPrev: p > 1
    };
  }

  // ============================================================
  // 17) Query String Helpers
  // ============================================================
  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function setParam(name, value) {
    const url = new URL(window.location);
    if (value === null || value === undefined || value === '') {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
    window.history.replaceState({}, '', url);
  }

  // ============================================================
  // 18) UUID/Token Generator
  // ============================================================
  function randomToken(len) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const n = len || 32;
    let out = '';
    const arr = new Uint8Array(n);
    crypto.getRandomValues(arr);
    for (let i = 0; i < n; i++) out += chars[arr[i] % chars.length];
    return out;
  }

  // ============================================================
  // 19) Number/Currency Utils
  // ============================================================
  function toNum(v) {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function round2(v) {
    return Math.round(toNum(v) * 100) / 100;
  }

  // ============================================================
  // 20) PWA Registration
  // ============================================================
  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.warn('[Refad] SW registration failed:', err);
      });
    }
  }

  // ============================================================
  // 21) Global Error Handler
  // ============================================================
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[Refad] Unhandled:', e.reason);
  });

  // ============================================================
  // 22) Export Global Object
  // ============================================================
  const Refad = {
    // config & clients
    CONFIG,
    sb,
    supabase: sb,

    // core modules
    Session,
    toast,
    alert,
    format,
    date: dateUtil,
    db,
    storage,
    theme,

    // dom
    $,
    $$,
    el,
    escapeHtml,

    // utils
    logActivity,
    notify,
    notifyCompany,
    notifyCompanyDaily,
    scanInventoryAlerts,
    addSharedNavigation,
    debounce,
    throttle,
    paginate,
    getParam,
    setParam,
    randomToken,
    toNum,
    round2,
    registerServiceWorker,
    initIdleWatcher,

    // version
    version: CONFIG.APP_VERSION
  };

  window.Refad = Refad;
  startNotificationRealtime();

  const responsiveStyle = document.createElement('style');
  responsiveStyle.textContent = `
    .modal-backdrop {
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-block: 16px;
    }
    .modal-backdrop .modal {
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .modal-backdrop .modal-body {
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    @media (max-width: 768px) {
      html, body {
        max-width: 100%;
        overflow-x: hidden;
      }
      .main, .content {
        min-width: 0;
      }
      .table-wrap {
        max-width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .table-wrap table {
        min-width: 640px;
      }
      .modal-backdrop .modal {
        max-width: calc(100vw - 24px);
      }
    }
    @media (max-width: 640px) {
      .content {
        padding: 12px;
      }
      .topbar {
        gap: 8px;
        padding-inline: 12px;
      }
      .form-grid {
        grid-template-columns: minmax(0, 1fr);
      }
      .form-group.span-2 {
        grid-column: 1 / -1;
      }
      .card-body {
        padding: 14px;
      }
      .modal-backdrop {
        padding: 12px;
      }
      .modal-backdrop .modal {
        width: 100%;
        max-height: calc(100dvh - 24px);
      }
      .modal-backdrop .modal-footer {
        flex-wrap: wrap;
      }
    }
  `;
  document.head.appendChild(responsiveStyle);

  // Auto-init theme on load
  theme.init();

  console.log(`%c[Refad] Core v${CONFIG.APP_VERSION} loaded`, 'color:#14B8A6;font-weight:bold');

})(window);