/* ============================================================
 * Refad ERP - Authentication Module
 * Version: 2.0.0 — Security Settings Integration
 * Dependencies: refad-core.js, refad-settings.js
 * ============================================================ */

(function (window) {
  'use strict';

  if (!window.Refad) {
    console.error('[Refad Auth] refad-core.js must be loaded first!');
    return;
  }

  const { db, Session, toast, alert, logActivity, CONFIG } = window.Refad;

  // ============================================================
  // 1) ثوابت المصادقة الافتراضية (fallback)
  // ============================================================
  const AUTH_CONFIG = {
    MAX_ATTEMPTS: 5,
    LOCK_MINUTES: 15,
    MIN_PASSWORD_LENGTH: 4,
    SESSION_HOURS: 8,
    IDLE_TIMEOUT_MIN: 30
  };

  const SESSION_EXPIRES_KEY = 'refad_session_expires_at';
  const SESSION_ACTIVITY_KEY = 'refad_session_last_activity';
  const SESSION_STARTED_KEY = 'refad_session_started_at';

  // ============================================================
  // 2) قراءة إعدادات الأمان من RefadSettings (مع fallback)
  // ============================================================
  function getSecuritySettings() {
    // استخدام Helper APIs من refad-settings.js v2.0 (أسرع وأنظف)
    try {
      if (window.RefadSettings && RefadSettings.security) {
        return {
          maxLoginAttempts: RefadSettings.security.getMaxLoginAttempts() || AUTH_CONFIG.MAX_ATTEMPTS,
          lockDurationMin: RefadSettings.security.getLockDuration() || AUTH_CONFIG.LOCK_MINUTES,
          sessionHours: RefadSettings.security.getSessionHours() || AUTH_CONFIG.SESSION_HOURS,
          idleTimeoutMin: RefadSettings.security.getIdleTimeout() || AUTH_CONFIG.IDLE_TIMEOUT_MIN,
          require2FA: RefadSettings.security.is2FARequired()
        };
      }
    } catch (e) {
      console.warn('[Auth] RefadSettings.security failed, using fallback:', e.message);
    }

    // Fallback: قراءة مباشرة من cache
    const get = function (key, def) {
      try {
        if (window.RefadSettings && typeof RefadSettings.get === 'function') {
          const val = RefadSettings.get('security', key, def);
          if (val !== undefined && val !== null && val !== '') return val;
        }
      } catch (e) {}
      return def;
    };

    const numVal = function (key, def) {
      const v = parseInt(get(key, String(def)), 10);
      return isNaN(v) || v <= 0 ? def : v;
    };

    return {
      maxLoginAttempts: numVal('max_login_attempts', AUTH_CONFIG.MAX_ATTEMPTS),
      lockDurationMin: numVal('lock_duration_min', AUTH_CONFIG.LOCK_MINUTES),
      sessionHours: numVal('session_hours', AUTH_CONFIG.SESSION_HOURS),
      idleTimeoutMin: numVal('idle_timeout_min', AUTH_CONFIG.IDLE_TIMEOUT_MIN),
      require2FA: String(get('require_2fa', 'false')).toLowerCase() === 'true'
    };
  }

  // ============================================================
  // 3) إدارة انتهاء الجلسة
  // ============================================================
  function setSessionExpiry(hours) {
    try {
      const now = Date.now();
      const expiresAt = now + (hours * 60 * 60 * 1000);
      sessionStorage.setItem(SESSION_EXPIRES_KEY, String(expiresAt));
      sessionStorage.setItem(SESSION_STARTED_KEY, String(now));
      sessionStorage.setItem(SESSION_ACTIVITY_KEY, String(now));
    } catch (e) {}
  }

  function updateLastActivity() {
    try {
      sessionStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now()));
    } catch (e) {}
  }

  function isSessionExpired() {
    try {
      const expiresAt = parseInt(sessionStorage.getItem(SESSION_EXPIRES_KEY), 10);
      if (!expiresAt) return false;
      if (Date.now() >= expiresAt) return true;

      // فحص الخمول
      const settings = getSecuritySettings();
      const lastActivity = parseInt(sessionStorage.getItem(SESSION_ACTIVITY_KEY), 10);
      if (lastActivity) {
        const idleMs = Date.now() - lastActivity;
        if (idleMs >= settings.idleTimeoutMin * 60 * 1000) return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  function clearSessionExpiry() {
    try {
      sessionStorage.removeItem(SESSION_EXPIRES_KEY);
      sessionStorage.removeItem(SESSION_STARTED_KEY);
      sessionStorage.removeItem(SESSION_ACTIVITY_KEY);
    } catch (e) {}
  }

  function getSessionRemainingMs() {
    try {
      const expiresAt = parseInt(sessionStorage.getItem(SESSION_EXPIRES_KEY), 10);
      if (!expiresAt) return null;
      return Math.max(0, expiresAt - Date.now());
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // 4) Idle Watcher — يراقب النشاط ويخرج تلقائياً
  // ============================================================
  let idleWatcherInterval = null;
  let idleWatcherWarningShown = false;
  let activityListenersBound = false;

  function startIdleWatcher() {
    if (idleWatcherInterval) return;

    const settings = getSecuritySettings();
    const idleMs = settings.idleTimeoutMin * 60 * 1000;
    const warningMs = 2 * 60 * 1000; // تحذير قبل دقيقتين

    // ربط أحداث النشاط مرة واحدة فقط
    if (!activityListenersBound) {
      const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
      const onActivity = function () { updateLastActivity(); };
      events.forEach(function (ev) {
        document.addEventListener(ev, onActivity, { passive: true });
      });
      activityListenersBound = true;
    }

    // فحص دوري كل 30 ثانية
    idleWatcherInterval = setInterval(function () {
      const s = Session.get();
      if (!s) {
        stopIdleWatcher();
        return;
      }

      // فحص session expiry الكلي
      const remaining = getSessionRemainingMs();
      if (remaining !== null && remaining <= 0) {
        handleSessionExpired('انتهت مدة الجلسة');
        return;
      }

      // فحص الخمول
      try {
        const lastActivity = parseInt(sessionStorage.getItem(SESSION_ACTIVITY_KEY), 10);
        if (lastActivity) {
          const idle = Date.now() - lastActivity;
          if (idle >= idleMs) {
            handleSessionExpired('تم تسجيل الخروج بسبب عدم النشاط');
            return;
          }
          // تحذير قبل دقيقتين
          if (idle >= idleMs - warningMs && !idleWatcherWarningShown) {
            idleWatcherWarningShown = true;
            const secLeft = Math.round((idleMs - idle) / 1000);
            if (toast && toast.warning) {
              toast.warning('⏰ سيتم تسجيل خروجك خلال ' + Math.round(secLeft / 60) + ' دقيقة بسبب عدم النشاط');
            }
          } else if (idle < idleMs - warningMs) {
            idleWatcherWarningShown = false;
          }
        }
      } catch (e) {}
    }, 30000);
  }

  function stopIdleWatcher() {
    if (idleWatcherInterval) {
      clearInterval(idleWatcherInterval);
      idleWatcherInterval = null;
    }
    idleWatcherWarningShown = false;
  }

  async function handleSessionExpired(reason) {
    stopIdleWatcher();
    const s = Session.get();
    if (s) {
      try { await logActivity('session_expired', 'auth', reason, s.user_id); } catch (e) {}
    }
    Session.clear();
    clearSessionExpiry();

    try {
      if (alert && alert.warning) {
        await alert.warning('انتهت الجلسة', reason + '\n\nسيتم توجيهك لصفحة الدخول.', 'حسناً');
      }
    } catch (e) {}

    window.location.replace('index.html');
  }

  // ============================================================
  // 5) تسجيل الدخول
  // ============================================================
  async function login(username, password, rememberMe) {
    // تنظيف المدخلات
    username = (username || '').trim();
    password = (password || '').trim();

    if (!username || !password) {
      throw new Error('الرجاء إدخال اسم المستخدم وكلمة المرور');
    }

    // 1) جلب المستخدم
    let user;
    try {
      user = await db.selectOne('users', {
        eq: { username: username }
      });
    } catch (e) {
      console.error('[Auth] DB error:', e);
      throw new Error('خطأ في الاتصال بقاعدة البيانات');
    }

    // 2) المستخدم غير موجود
    if (!user) {
      throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    // 3) الحساب غير مفعل
    if (!user.is_active) {
      throw new Error('الحساب غير مفعّل. تواصل مع المدير');
    }

    // ✨ 4) قراءة إعدادات الأمان للشركة (بعد ما عرفنا user)
    const security = getSecuritySettings();

    // 5) التحقق من القفل
    if (user.locked_until) {
      const lockedUntil = new Date(user.locked_until).getTime();
      if (lockedUntil > Date.now()) {
        const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
        throw new Error('الحساب مقفل. حاول بعد ' + mins + ' دقيقة');
      }
      // انتهى القفل → صفّر
      await db.update('users', user.id, {
        locked_until: null,
        failed_attempts: 0
      });
      user.locked_until = null;
      user.failed_attempts = 0;
    }

    // 6) التحقق من كلمة المرور
    if (password !== user.password) {
      const attempts = (user.failed_attempts || 0) + 1;
      const updatePayload = { failed_attempts: attempts };

      // ✨ استخدام الإعدادات (بدل hardcoded)
      if (attempts >= security.maxLoginAttempts) {
        const lockTime = new Date(Date.now() + security.lockDurationMin * 60000);
        updatePayload.locked_until = lockTime.toISOString();
        updatePayload.failed_attempts = 0;
        await db.update('users', user.id, updatePayload);

        try {
          await logActivity('account_locked', 'auth',
            'تم قفل الحساب ' + security.lockDurationMin + ' دقيقة بسبب ' + security.maxLoginAttempts + ' محاولات فاشلة',
            user.id);
        } catch (e) {}

        throw new Error('تم قفل الحساب ' + security.lockDurationMin + ' دقيقة بسبب ' + security.maxLoginAttempts + ' محاولات فاشلة');
      }

      await db.update('users', user.id, updatePayload);
      const remaining = security.maxLoginAttempts - attempts;
      throw new Error('كلمة المرور غير صحيحة. متبقي ' + remaining + ' محاولات');
    }

    // 7) جلب بيانات الدور + الصلاحيات
    const role = user.role_id ? await db.selectOne('roles', {
      columns: 'id, company_id, name, is_owner',
      eq: { id: user.role_id }
    }) : null;

    const isSuperAdmin = role && role.name === 'superadmin' &&
      role.company_id == null &&
      user.company_id == null;
    const isOwner = role && role.is_owner === true &&
      role.company_id === user.company_id;
    const permissions = await getUserPermissions(user.role_id, isSuperAdmin);

    // ✨ 8) فحص المصادقة الثنائية
    const requires2FA = security.require2FA && !isSuperAdmin;

    // 9) إنشاء الجلسة
    const session = Session.set({
      user_id: user.id,
      company_id: user.company_id,
      role_id: user.role_id,
      username: user.username,
      full_name: user.full_name,
      avatar_url: user.avatar_url,
      is_owner: isOwner,
      is_superadmin: isSuperAdmin,
      permissions: permissions,
      requires_2fa: requires2FA
    });

    // ✨ 10) تطبيق session expiry
    setSessionExpiry(security.sessionHours);

    // 11) تحديث آخر دخول + تصفير المحاولات
    await db.update('users', user.id, {
      last_login: new Date().toISOString(),
      failed_attempts: 0,
      locked_until: null
    });

    // 12) تسجيل النشاط
    try {
      await logActivity('login', 'auth',
        'تسجيل دخول من ' + navigator.userAgent.slice(0, 80),
        user.id);
    } catch (e) {}

    // 13) تشغيل Idle Watcher
    startIdleWatcher();

    return session;
  }

  // ============================================================
  // 6) جلب صلاحيات المستخدم
  // ============================================================
  async function getUserPermissions(roleId, isSuperAdmin) {
    if (!roleId) return [];
    const rows = await db.select('role_permissions', {
      columns: 'permission_id, permissions(code)',
      eq: { role_id: roleId }
    });
    return rows
      .map(function (r) { return r.permissions && r.permissions.code; })
      .filter(function (code) { return code && (isSuperAdmin || code !== 'admin.full'); });
  }

  // ============================================================
  // 7) تسجيل الخروج
  // ============================================================
  async function logout(silent) {
    const s = Session.get();
    if (s) {
      try {
        await logActivity('logout', 'auth', 'تسجيل خروج', s.user_id);
      } catch (e) {}
    }
    stopIdleWatcher();
    Session.clear();
    clearSessionExpiry();

    if (!silent) {
      window.location.href = 'index.html';
    }
  }

  // ============================================================
  // 8) التحقق من الجلسة (يُستدعى في كل صفحة محمية)
  // ============================================================
  function requireLogin() {
    const s = Session.get();
    if (!s) {
      window.location.replace('index.html');
      return null;
    }

    // ✨ فحص expiry
    if (isSessionExpired()) {
      handleSessionExpired('انتهت صلاحية الجلسة أو حدث خمول طويل');
      return null;
    }

    // تحديث آخر نشاط
    updateLastActivity();
    return s;
  }

  // ============================================================
  // 9) تغيير كلمة المرور
  // ============================================================
  async function changePassword(userId, oldPassword, newPassword) {
    if (!userId || !oldPassword || !newPassword) {
      throw new Error('كل الحقول مطلوبة');
    }
    if (newPassword.length < AUTH_CONFIG.MIN_PASSWORD_LENGTH) {
      throw new Error('كلمة المرور يجب أن تكون ' + AUTH_CONFIG.MIN_PASSWORD_LENGTH + ' أحرف على الأقل');
    }

    const user = await db.selectOne('users', { eq: { id: userId } });
    if (!user) throw new Error('المستخدم غير موجود');
    if (user.password !== oldPassword) throw new Error('كلمة المرور الحالية غير صحيحة');

    await db.update('users', userId, { password: newPassword });
    await logActivity('change_password', 'auth', 'تغيير كلمة المرور', userId);
    return true;
  }

  // ============================================================
  // 10) إعادة تعيين كلمة مرور
  // ============================================================
  async function resetPassword(userId, newPassword) {
    if (!newPassword || newPassword.length < AUTH_CONFIG.MIN_PASSWORD_LENGTH) {
      throw new Error('كلمة المرور يجب أن تكون ' + AUTH_CONFIG.MIN_PASSWORD_LENGTH + ' أحرف على الأقل');
    }
    await db.update('users', userId, {
      password: newPassword,
      failed_attempts: 0,
      locked_until: null
    });
    await logActivity('reset_password', 'auth', 'إعادة تعيين كلمة مرور', userId);
    return true;
  }

  // ============================================================
  // 11) فتح قفل مستخدم
  // ============================================================
  async function unlockUser(userId) {
    await db.update('users', userId, {
      failed_attempts: 0,
      locked_until: null
    });
    await logActivity('unlock_user', 'auth', 'فتح قفل مستخدم', userId);
    return true;
  }

  // ============================================================
  // 12) التحقق من كلمة المرور
  // ============================================================
  async function verifyPassword(userId, password) {
    const user = await db.selectOne('users', { eq: { id: userId } });
    if (!user) return false;
    return user.password === password;
  }

  // ============================================================
  // 13) إنشاء موظف جديد
  // ============================================================
  async function createUser(data) {
    const s = Session.get();
    if (!s) throw new Error('يجب تسجيل الدخول');

    if (!data.username || !data.password || !data.full_name) {
      throw new Error('اسم المستخدم، كلمة المرور، والاسم الكامل مطلوبة');
    }
    if (data.password.length < AUTH_CONFIG.MIN_PASSWORD_LENGTH) {
      throw new Error('كلمة المرور ' + AUTH_CONFIG.MIN_PASSWORD_LENGTH + ' أحرف على الأقل');
    }

    const existing = await db.selectOne('users', { eq: { username: data.username } });
    if (existing) throw new Error('اسم المستخدم موجود بالفعل');

    const payload = {
      company_id: data.company_id || s.company_id,
      role_id: data.role_id || null,
      username: data.username.trim(),
      password: data.password,
      full_name: data.full_name.trim(),
      phone: data.phone || null,
      email: data.email || null,
      is_active: data.is_active !== false,
      has_device: data.has_device !== false,
      salary: data.salary || 0,
      hire_date: data.hire_date || null
    };

    const created = await db.insert('users', payload);
    await logActivity('create_user', 'users', 'إنشاء موظف: ' + created.username, created.id);
    return created;
  }

  // ============================================================
  // 14) الحصول على المستخدم الحالي
  // ============================================================
  async function getCurrentUser() {
    const s = Session.get();
    if (!s) return null;
    try {
      const user = await db.selectOne('users', {
        columns: 'id, company_id, role_id, username, full_name, phone, email, avatar_url, is_active, has_device, salary, hire_date, theme, last_login',
        eq: { id: s.user_id }
      });
      return user;
    } catch (e) {
      console.warn('[Auth] getCurrentUser failed:', e.message);
      return null;
    }
  }

  // ============================================================
  // 15) التحقق من صلاحية
  // ============================================================
  function can(permission) {
    return Session.has(permission);
  }

  // ============================================================
  // 16) Guard Page
  // ============================================================
  function guardPage(requiredPermission) {
    const s = requireLogin();
    if (!s) return null;

    if (!Session.has('notifications.view')) {
      document.querySelectorAll('#notifBtn').forEach(function (button) {
        button.style.display = 'none';
      });
    }

    if (s.is_superadmin && requiredPermission !== 'system.admin') {
      window.location.replace('admin.html');
      return null;
    }

    if (requiredPermission && !Session.has(requiredPermission)) {
      alert.error('غير مصرح', 'ليس لديك صلاحية الوصول لهذه الصفحة').then(function () {
        window.location.href = 'dashboard.html';
      });
      return null;
    }

    // ✨ تشغيل Idle Watcher
    startIdleWatcher();

    // ✨ تشغيل initIdleWatcher (لو موجود في core)
    try {
      if (window.Refad.initIdleWatcher && typeof window.Refad.initIdleWatcher === 'function') {
        window.Refad.initIdleWatcher();
      }
    } catch (e) {}

    // إضافة التنقل المشترك
    try {
      if (window.Refad.addSharedNavigation && typeof window.Refad.addSharedNavigation === 'function') {
        window.Refad.addSharedNavigation();
      }
    } catch (e) {}

    return s;
  }

  // ============================================================
  // 17) Public API — إدارة الجلسة
  // ============================================================
  function getSessionRemaining() {
    const ms = getSessionRemainingMs();
    if (ms === null) return null;
    return {
      ms: ms,
      minutes: Math.floor(ms / 60000),
      seconds: Math.floor(ms / 1000) % 60,
      isExpired: ms <= 0
    };
  }

  function extendSession() {
    try {
      const settings = getSecuritySettings();
      setSessionExpiry(settings.sessionHours);
      updateLastActivity();
      return true;
    } catch (e) {
      return false;
    }
  }

  function getSecurityConfig() {
    return getSecuritySettings();
  }

  // ============================================================
  // 18) تصدير
  // ============================================================
  const Auth = {
    login: login,
    logout: logout,
    requireLogin: requireLogin,
    guardPage: guardPage,
    changePassword: changePassword,
    resetPassword: resetPassword,
    unlockUser: unlockUser,
    verifyPassword: verifyPassword,
    createUser: createUser,
    getCurrentUser: getCurrentUser,
    getUserPermissions: getUserPermissions,
    can: can,
    CONFIG: AUTH_CONFIG,

    // ✨ جديد — إدارة الجلسة
    getSessionRemaining: getSessionRemaining,
    extendSession: extendSession,
    getSecurityConfig: getSecurityConfig,
    startIdleWatcher: startIdleWatcher,
    stopIdleWatcher: stopIdleWatcher,
    isSessionExpired: isSessionExpired,
    clearSessionExpiry: clearSessionExpiry,
    updateLastActivity: updateLastActivity
  };

  window.Refad.Auth = Auth;

  // ✨ مراقبة النشاط على مستوى عام
  if (typeof document !== 'undefined') {
    ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        if (Session.get()) updateLastActivity();
      }, { passive: true });
    });
  }

  console.log('%c[Refad] Auth v2.0.0 loaded — Security Settings Integration', 'color:#F59E0B;font-weight:bold');

})(window);