/* ============================================================
 * Refad ERP - Authentication Module
 * Version: 1.0.0
 * Dependencies: refad-core.js
 * ============================================================ */

(function (window) {
  'use strict';

  if (!window.Refad) {
    console.error('[Refad Auth] refad-core.js must be loaded first!');
    return;
  }

  const { db, Session, toast, alert, logActivity, CONFIG } = window.Refad;

  // ============================================================
  // 1) ثوابت المصادقة
  // ============================================================
  const AUTH_CONFIG = {
    MAX_ATTEMPTS: 5,
    LOCK_MINUTES: 15,
    MIN_PASSWORD_LENGTH: 4
  };

  // ============================================================
  // 2) تسجيل الدخول
  // ============================================================
  async function login(username, password, rememberMe) {
    // تنظيف المدخلات
    username = (username || '').trim();
    password = (password || '').trim();

    // التحقق من المدخلات
    if (!username || !password) {
      throw new Error('الرجاء إدخال اسم المستخدم وكلمة المرور');
    }

    // 1. جلب المستخدم
    let user;
    try {
      user = await db.selectOne('users', {
        eq: { username: username }
      });
    } catch (e) {
      console.error('[Auth] DB error:', e);
      throw new Error('خطأ في الاتصال بقاعدة البيانات');
    }

    // 2. المستخدم غير موجود
    if (!user) {
      throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    // 3. الحساب غير مفعل
    if (!user.is_active) {
      throw new Error('الحساب غير مفعّل. تواصل مع المدير');
    }

    // 4. التحقق من القفل
    if (user.locked_until) {
      const lockedUntil = new Date(user.locked_until).getTime();
      if (lockedUntil > Date.now()) {
        const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
        throw new Error(`الحساب مقفل. حاول بعد ${mins} دقيقة`);
      }
      // انتهى القفل → صفّر
      await db.update('users', user.id, {
        locked_until: null,
        failed_attempts: 0
      });
      user.locked_until = null;
      user.failed_attempts = 0;
    }

    // 5. التحقق من كلمة المرور (نص عادي)
    if (password !== user.password) {
      // زيادة عدد المحاولات الفاشلة
      const attempts = (user.failed_attempts || 0) + 1;
      const updatePayload = { failed_attempts: attempts };

      if (attempts >= AUTH_CONFIG.MAX_ATTEMPTS) {
        const lockTime = new Date(Date.now() + AUTH_CONFIG.LOCK_MINUTES * 60000);
        updatePayload.locked_until = lockTime.toISOString();
        updatePayload.failed_attempts = 0; // صفّر بعد القفل
        await db.update('users', user.id, updatePayload);
        throw new Error(`تم قفل الحساب ${AUTH_CONFIG.LOCK_MINUTES} دقيقة بسبب ${AUTH_CONFIG.MAX_ATTEMPTS} محاولات فاشلة`);
      }

      await db.update('users', user.id, updatePayload);
      const remaining = AUTH_CONFIG.MAX_ATTEMPTS - attempts;
      throw new Error(`كلمة المرور غير صحيحة. متبقي ${remaining} محاولات`);
    }

    // 6. جلب بيانات الدور وصلاحياته
    const role = user.role_id ? await db.selectOne('roles', {
      columns: 'id, company_id, name, is_owner',
      eq: { id: user.role_id }
    }) : null;
    const isSuperAdmin = role?.name === 'superadmin' &&
      role.company_id == null &&
      user.company_id == null;
    const isOwner = role?.is_owner === true &&
      role.company_id === user.company_id;
    const permissions = await getUserPermissions(user.role_id, isSuperAdmin);

    // 7. إنشاء الجلسة
    const session = Session.set({
      user_id: user.id,
      company_id: user.company_id,
      role_id: user.role_id,
      username: user.username,
      full_name: user.full_name,
      avatar_url: user.avatar_url,
      is_owner: isOwner,
      is_superadmin: isSuperAdmin,
      permissions: permissions
    });

    // 8. تحديث بيانات آخر دخول + تصفير المحاولات
    await db.update('users', user.id, {
      last_login: new Date().toISOString(),
      failed_attempts: 0,
      locked_until: null
    });

    // 9. تسجيل النشاط
    await logActivity('login', 'auth', `تسجيل دخول من ${navigator.userAgent.slice(0, 80)}`, user.id);

    return session;
  }

  // ============================================================
  // 3) جلب صلاحيات المستخدم
  // ============================================================
  async function getUserPermissions(roleId, isSuperAdmin) {
    if (!roleId) return [];
    const rows = await db.select('role_permissions', {
      columns: 'permission_id, permissions(code)',
      eq: { role_id: roleId }
    });
    return rows
      .map(r => r.permissions?.code)
      .filter(code => code && (isSuperAdmin || code !== 'admin.full'));
  }

  // ============================================================
  // 4) تسجيل الخروج
  // ============================================================
  async function logout(silent) {
    const s = Session.get();
    if (s) {
      try {
        await logActivity('logout', 'auth', 'تسجيل خروج', s.user_id);
      } catch (e) {
        // تجاهل
      }
    }
    Session.clear();
    if (!silent) {
      window.location.href = 'index.html';
    }
  }

  // ============================================================
  // 5) التحقق من الجلسة (يُستدعى في كل صفحة محمية)
  // ============================================================
  function requireLogin() {
    const s = Session.get();
    if (!s) {
      window.location.replace('index.html');
      return null;
    }
    return s;
  }

  // ============================================================
  // 6) تغيير كلمة المرور
  // ============================================================
  async function changePassword(userId, oldPassword, newPassword) {
    if (!userId || !oldPassword || !newPassword) {
      throw new Error('كل الحقول مطلوبة');
    }
    if (newPassword.length < AUTH_CONFIG.MIN_PASSWORD_LENGTH) {
      throw new Error(`كلمة المرور يجب أن تكون ${AUTH_CONFIG.MIN_PASSWORD_LENGTH} أحرف على الأقل`);
    }

    const user = await db.selectOne('users', { eq: { id: userId } });
    if (!user) throw new Error('المستخدم غير موجود');
    if (user.password !== oldPassword) throw new Error('كلمة المرور الحالية غير صحيحة');

    await db.update('users', userId, { password: newPassword });
    await logActivity('change_password', 'auth', 'تغيير كلمة المرور', userId);
    return true;
  }

  // ============================================================
  // 7) إعادة تعيين كلمة مرور (يستخدمها الأدمن)
  // ============================================================
  async function resetPassword(userId, newPassword) {
    if (!newPassword || newPassword.length < AUTH_CONFIG.MIN_PASSWORD_LENGTH) {
      throw new Error(`كلمة المرور يجب أن تكون ${AUTH_CONFIG.MIN_PASSWORD_LENGTH} أحرف على الأقل`);
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
  // 8) فتح قفل مستخدم
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
  // 9) التحقق من كلمة المرور الحالية
  // ============================================================
  async function verifyPassword(userId, password) {
    const user = await db.selectOne('users', { eq: { id: userId } });
    if (!user) return false;
    return user.password === password;
  }

  // ============================================================
  // 10) إنشاء موظف جديد (يستخدمها الأدمن)
  // ============================================================
  async function createUser(data) {
    const s = Session.get();
    if (!s) throw new Error('يجب تسجيل الدخول');

    // تحقق
    if (!data.username || !data.password || !data.full_name) {
      throw new Error('اسم المستخدم، كلمة المرور، والاسم الكامل مطلوبة');
    }
    if (data.password.length < AUTH_CONFIG.MIN_PASSWORD_LENGTH) {
      throw new Error(`كلمة المرور ${AUTH_CONFIG.MIN_PASSWORD_LENGTH} أحرف على الأقل`);
    }

    // تحقق من عدم وجود اسم مستخدم مكرر
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
    await logActivity('create_user', 'users', `إنشاء موظف: ${created.username}`, created.id);
    return created;
  }

  // ============================================================
  // 11) الحصول على بيانات المستخدم الحالي كاملة
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
  // 12) التحقق من صلاحية معينة (سريع)
  // ============================================================
  function can(permission) {
    return Session.has(permission);
  }

  // ============================================================
  // 13) كود الحماية الشامل لكل صفحة محمية
  // ============================================================
  function guardPage(requiredPermission) {
    const s = requireLogin();
    if (!s) return null;

    if (!Session.has('notifications.view')) {
      document.querySelectorAll('#notifBtn').forEach(button => {
        button.style.display = 'none';
      });
    }

    if (s.is_superadmin && requiredPermission !== 'system.admin') {
      window.location.replace('admin.html');
      return null;
    }

    if (requiredPermission && !Session.has(requiredPermission)) {
      alert.error('غير مصرح', 'ليس لديك صلاحية الوصول لهذه الصفحة').then(() => {
        window.location.href = 'dashboard.html';
      });
      return null;
    }

    // تشغيل Idle Watcher
    window.Refad.initIdleWatcher();
    window.Refad.addSharedNavigation();

    return s;
  }

  // ============================================================
  // 14) تصدير
  // ============================================================
  const Auth = {
    login,
    logout,
    requireLogin,
    guardPage,
    changePassword,
    resetPassword,
    unlockUser,
    verifyPassword,
    createUser,
    getCurrentUser,
    getUserPermissions,
    can,
    CONFIG: AUTH_CONFIG
  };

  window.Refad.Auth = Auth;

  console.log('%c[Refad] Auth v1.0.0 loaded', 'color:#F59E0B;font-weight:bold');

})(window);