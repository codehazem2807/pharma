/* ============================================================
   refad-warehouse.js
   نظام المخازن المتعددة - Refad ERP
   ------------------------------------------------------------
   - تحميل المخازن من قاعدة البيانات
   - إدارة المخزن النشط (Active Warehouse)
   - حقن dropdown اختيار المخزن في الـ topbar
   - إشعارات التغيير (onChange) للصفحات
   - حماية من الأخطاء + fallback آمن
   ============================================================ */
(function () {
  'use strict';

  // ============================================================
  // 1) Guard: لازم Refad يكون موجود
  // ============================================================
  if (typeof window.Refad === 'undefined') {
    console.error('[Refad.Warehouse] Refad core is not loaded. تأكد من تحميل refad-core.js أولاً.');
    return;
  }

  // ============================================================
  // 2) الثوابت
  // ============================================================
  var STORAGE_KEY = 'refad_active_warehouse';
  var CACHE_TTL = 5 * 60 * 1000; // 5 دقائق

  // ============================================================
  // 3) الحالة الداخلية
  // ============================================================
  var state = {
    warehouses: [],
    activeId: null,
    active: null,
    defaultWarehouse: null,
    loaded: false,
    loading: null,
    loadedAt: 0,
    listeners: [],
    selectorEl: null
  };

  // ============================================================
  // 4) أدوات مساعدة
  // ============================================================

  function readStoredActiveId() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (!v) return null;
      var n = Number(v);
      return isFinite(n) && n > 0 ? n : null;
    } catch (e) {
      console.warn('[Refad.Warehouse] localStorage read failed:', e.message);
      return null;
    }
  }

  function writeStoredActiveId(id) {
    try {
      if (id === null || id === undefined) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, String(id));
      }
    } catch (e) {
      console.warn('[Refad.Warehouse] localStorage write failed:', e.message);
    }
  }

  function getCompanyId() {
    try {
      var session = (Refad.auth && typeof Refad.auth.getSession === 'function')
        ? Refad.auth.getSession()
        : null;
      if (session && session.company_id) return session.company_id;

      var raw = localStorage.getItem('refad_session');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.company_id) return s.company_id;
      }
    } catch (e) {
      console.warn('[Refad.Warehouse] getCompanyId failed:', e.message);
    }
    return null;
  }

  function emitChange(reason) {
    var payload = {
      active: state.active,
      activeId: state.activeId,
      warehouses: state.warehouses.slice(),
      reason: reason || 'unknown'
    };
    for (var i = 0; i < state.listeners.length; i++) {
      try { state.listeners[i](payload); }
      catch (e) { console.error('[Refad.Warehouse] onChange listener error:', e); }
    }
    try {
      window.dispatchEvent(new CustomEvent('refad:warehouse-change', { detail: payload }));
    } catch (e) { /* ignore */ }
  }

  // ============================================================
  // 5) تحميل المخازن من قاعدة البيانات
  // ============================================================

  function load(force) {
    // لو فيه تحميل جاري، رجّعه
    if (state.loading) return state.loading;

    // لو محمّلة قريب + مش force
    if (!force && state.loaded && (Date.now() - state.loadedAt) < CACHE_TTL) {
      return Promise.resolve(state.warehouses);
    }

    var companyId = getCompanyId();
    if (!companyId) {
      console.warn('[Refad.Warehouse] No company_id in session.');
      state.warehouses = [];
      state.loaded = true;
      state.loadedAt = Date.now();
      return Promise.resolve(state.warehouses);
    }

    state.loading = Refad.db.select('warehouses', {
      columns: 'id, company_id, name, code, type, address, phone, manager_id, is_default, is_active, notes, created_at, updated_at',
      eq: { company_id: companyId },
      order: { column: 'is_default', ascending: false },
      limit: 200
    }).then(function (rows) {
      var sorted = (rows || []).slice().sort(function (a, b) {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
      });

      state.warehouses = sorted;

      // اختيار المخزن الافتراضي
      state.defaultWarehouse = null;
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].is_default) { state.defaultWarehouse = sorted[i]; break; }
      }
      if (!state.defaultWarehouse && sorted.length) {
        state.defaultWarehouse = sorted[0];
      }

      state.loaded = true;
      state.loadedAt = Date.now();

      // اختيار المخزن النشط:
      // 1) من localStorage (لو متاح ونشط)
      // 2) المخزن الافتراضي
      // 3) أول مخزن نشط
      var storedId = readStoredActiveId();
      var newActive = null;

      if (storedId) {
        for (var j = 0; j < sorted.length; j++) {
          if (Number(sorted[j].id) === storedId && sorted[j].is_active) {
            newActive = sorted[j];
            break;
          }
        }
      }
      if (!newActive && state.defaultWarehouse && state.defaultWarehouse.is_active) {
        newActive = state.defaultWarehouse;
      }
      if (!newActive) {
        for (var k = 0; k < sorted.length; k++) {
          if (sorted[k].is_active) { newActive = sorted[k]; break; }
        }
      }

      if (newActive) {
        state.activeId = Number(newActive.id);
        state.active = newActive;
        writeStoredActiveId(state.activeId);
      } else {
        state.activeId = null;
        state.active = null;
      }

      return state.warehouses;
    }).catch(function (e) {
      console.error('[Refad.Warehouse] load failed:', e);
      state.warehouses = [];
      state.loaded = true;
      state.loadedAt = Date.now();
      return [];
    }).then(function (result) {
      state.loading = null;
      return result;
    });

    return state.loading;
  }

  function ensureLoaded() {
    if (!state.loaded) return load(false);
    return Promise.resolve(state.warehouses);
  }

  // ============================================================
  // 6) الوصول للمخازن
  // ============================================================

  function getAll() {
    return state.warehouses.slice();
  }

  function getActiveList() {
    return state.warehouses.filter(function (w) { return w.is_active; });
  }

  function getActive() {
    return state.active;
  }

  function getActiveId() {
    return state.activeId;
  }

  function getDefault() {
    return state.defaultWarehouse;
  }

  function getById(id) {
    if (id === null || id === undefined) return null;
    var n = Number(id);
    for (var i = 0; i < state.warehouses.length; i++) {
      if (Number(state.warehouses[i].id) === n) return state.warehouses[i];
    }
    return null;
  }

  function getByCode(code) {
    if (!code) return null;
    for (var i = 0; i < state.warehouses.length; i++) {
      if (state.warehouses[i].code === code) return state.warehouses[i];
    }
    return null;
  }

  function hasAccess(warehouseId) {
    if (warehouseId === null || warehouseId === undefined) return false;
    var w = getById(warehouseId);
    return Boolean(w && w.is_active);
  }

  // ============================================================
  // 7) تعيين المخزن النشط
  // ============================================================

  function setActive(id, opts) {
    opts = opts || {};
    var n = Number(id);
    if (!isFinite(n)) {
      console.warn('[Refad.Warehouse] setActive: invalid id', id);
      return false;
    }
    var w = getById(n);
    if (!w) {
      console.warn('[Refad.Warehouse] setActive: warehouse not found', id);
      return false;
    }
    if (!w.is_active) {
      console.warn('[Refad.Warehouse] setActive: warehouse is inactive', id);
      return false;
    }
    if (state.activeId === n) {
      updateSelectorUI();
      return true;
    }

    state.activeId = n;
    state.active = w;
    writeStoredActiveId(n);
    updateSelectorUI();

    if (!opts.silent) {
      emitChange('setActive');
    }
    return true;
  }

  function resetToDefault() {
    if (state.defaultWarehouse) {
      return setActive(state.defaultWarehouse.id);
    }
    for (var i = 0; i < state.warehouses.length; i++) {
      if (state.warehouses[i].is_active) {
        return setActive(state.warehouses[i].id);
      }
    }
    return false;
  }

  // ============================================================
  // 8) onChange
  // ============================================================

  function onChange(callback) {
    if (typeof callback !== 'function') return function () {};
    state.listeners.push(callback);
    return function unsubscribe() {
      var i = state.listeners.indexOf(callback);
      if (i !== -1) state.listeners.splice(i, 1);
    };
  }

  // ============================================================
  // 9) حقن الـ Selector في الـ topbar
  // ============================================================

  function injectSelector(opts) {
    opts = opts || {};
    var auto = opts.auto !== false;

    if (!state.loaded) {
      load(false).then(function () {
        if (auto) doInject(opts);
      });
      return;
    }
    if (auto) doInject(opts);
  }

  function doInject(opts) {
    if (!state.warehouses.length) return;

    var container = null;
    if (opts.container) {
      container = (typeof opts.container === 'string')
        ? document.querySelector(opts.container)
        : opts.container;
    }
    if (!container) {
      container = document.querySelector('.topbar-actions')
              || document.querySelector('.topbar');
    }
    if (!container) {
      console.warn('[Refad.Warehouse] injectSelector: no container found');
      return;
    }

    // شيل القديم لو موجود
    var existing = document.getElementById('refadWarehouseSelector');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    var wrap = document.createElement('div');
    wrap.id = 'refadWarehouseSelector';
    wrap.className = 'refad-warehouse-selector';
    wrap.style.cssText = [
      'position:relative',
      'display:inline-flex',
      'align-items:center',
      'gap:8px',
      'padding:6px 12px',
      'border:1px solid var(--border, #e2e8f0)',
      'border-radius:10px',
      'background:var(--card, #fff)',
      'color:var(--text, #0f172a)',
      'cursor:pointer',
      'font-family:inherit',
      'font-size:13px',
      'font-weight:600',
      'user-select:none',
      'transition:all .2s'
    ].join(';');

    var activeName = state.active ? state.active.name : 'اختر مخزن';
    var iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/></svg>';

    wrap.innerHTML =
      '<span style="display:inline-flex;align-items:center;color:var(--accent,#14B8A6);">' + iconSvg + '</span>' +
      '<span id="refadWhName">' + escapeHtml(activeName) + '</span>' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.5"><polyline points="6 9 12 15 18 9"/></svg>';

    var dropdown = document.createElement('div');
    dropdown.id = 'refadWarehouseDropdown';
    dropdown.style.cssText = [
      'position:absolute',
      'top:calc(100% + 8px)',
      'left:0',
      'min-width:240px',
      'background:var(--card, #fff)',
      'border:1px solid var(--border, #e2e8f0)',
      'border-radius:12px',
      'box-shadow:0 10px 40px rgba(11,44,77,.15)',
      'padding:6px',
      'z-index:200',
      'display:none',
      'max-height:400px',
      'overflow-y:auto'
    ].join(';');

    renderDropdownItems(dropdown);
    wrap.appendChild(dropdown);

    // فتح/غلق القائمة
    wrap.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = dropdown.style.display === 'block';
      dropdown.style.display = isOpen ? 'none' : 'block';
    });

    // اختيار مخزن
    dropdown.addEventListener('click', function (e) {
      var target = e.target;
      while (target && target !== dropdown) {
        if (target.getAttribute && target.getAttribute('data-wh-id')) {
          e.stopPropagation();
          var id = Number(target.getAttribute('data-wh-id'));
          if (setActive(id)) {
            dropdown.style.display = 'none';
          }
          return;
        }
        target = target.parentNode;
      }
    });

    // غلق عند الضغط خارج
    document.addEventListener('click', function () {
      dropdown.style.display = 'none';
    });

    // غلق بـ Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') dropdown.style.display = 'none';
    });

    // الحقن في الـ container
    container.insertBefore(wrap, container.firstChild);
    state.selectorEl = wrap;

    // تحديث تلقائي عند التغيير
    onChange(function () { updateSelectorUI(); });
  }

  function renderDropdownItems(dropdown) {
    var activeList = getActiveList();
    if (!activeList.length) {
      dropdown.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted,#64748b);font-size:12px;">لا توجد مخازن متاحة</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < activeList.length; i++) {
      var w = activeList[i];
      var isActive = Number(w.id) === state.activeId;
      var typeLabel = getTypeLabel(w.type);
      var defaultBadge = w.is_default
        ? '<span style="font-size:10px;padding:2px 6px;border-radius:6px;background:rgba(20,184,166,.12);color:#14B8A6;font-weight:700;">افتراضي</span>'
        : '';
      var check = isActive
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '';
      var bg = isActive ? 'rgba(20,184,166,.1)' : 'transparent';
      var color = isActive ? 'var(--accent,#14B8A6)' : 'var(--text,#0f172a)';
      var weight = isActive ? '700' : '500';

      html += '<div data-wh-id="' + w.id + '" style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;background:' + bg + ';color:' + color + ';font-weight:' + weight + ';font-size:13px;">' +
        '<span style="font-size:11px;opacity:.7;">' + typeLabel + '</span>' +
        '<span style="flex:1;">' + escapeHtml(w.name) + '</span>' +
        defaultBadge + check +
        '</div>';
    }
    dropdown.innerHTML = html;
  }

  function updateSelectorUI() {
    var nameEl = document.getElementById('refadWhName');
    if (nameEl && state.active) {
      nameEl.textContent = state.active.name;
    }
    var dropdown = document.getElementById('refadWarehouseDropdown');
    if (dropdown) renderDropdownItems(dropdown);
  }

  // ============================================================
  // 10) أدوات مساعدة للعرض
  // ============================================================

  function getTypeLabel(type) {
    var map = { main: '🏢', branch: '🏪', cold: '❄️', hazard: '⚠️', other: '📦' };
    return map[type] || '📦';
  }

  function getTypeText(type) {
    var map = { main: 'رئيسي', branch: 'فرع', cold: 'مبرد', hazard: 'مواد خطرة', other: 'أخرى' };
    return map[type] || 'غير محدد';
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================
  // 11) Refresh يدوي
  // ============================================================

  function refresh() {
    return load(true).then(function (list) {
      updateSelectorUI();
      emitChange('refresh');
      return list;
    });
  }

  // ============================================================
  // 12) التصدير على Refad
  // ============================================================
  Refad.Warehouse = {
    // البيانات
    load: load,
    ensureLoaded: ensureLoaded,
    refresh: refresh,
    getAll: getAll,
    getActiveList: getActiveList,
    getActive: getActive,
    getActiveId: getActiveId,
    getDefault: getDefault,
    getById: getById,
    getByCode: getByCode,
    hasAccess: hasAccess,

    // التحكم
    setActive: setActive,
    resetToDefault: resetToDefault,

    // الواجهة
    injectSelector: injectSelector,

    // الأحداث
    onChange: onChange,

    // أدوات
    getTypeLabel: getTypeLabel,
    getTypeText: getTypeText,

    // حالة داخلية (للتصحيح)
    _state: state
  };

  console.log('%c[Refad] Warehouse module loaded', 'color:#14B8A6;font-weight:bold');

})();