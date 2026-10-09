/* ============================================================
   refad-quarantine.js
   نظام التشغيلات المحظورة - Refad ERP
   ============================================================ */
(function () {
  'use strict';

  // 1) Guard
  if (typeof window.Refad === 'undefined') {
    console.error('[Refad.Quarantine] Refad core is not loaded.');
    return;
  }

  // 2) الثوابت
  var CACHE_TTL = 2 * 60 * 1000;
  var MATCH_MIN_LEN = 4;

  var REASONS = {
    ministry: { key: 'ministry', label: 'سحب وزارة', color: 'red', icon: 'shield-alert', severity: 'high' },
    recall:   { key: 'recall',   label: 'استدعاء مصنع', color: 'gold', icon: 'undo-2', severity: 'high' },
    damaged:  { key: 'damaged',  label: 'تالف', color: 'red', icon: 'package-x', severity: 'medium' },
    expired:  { key: 'expired',  label: 'منتهي الصلاحية', color: 'gray', icon: 'calendar-x', severity: 'medium' },
    hold:     { key: 'hold',     label: 'تحرز داخلي', color: 'blue', icon: 'pause-circle', severity: 'low' },
    quality:  { key: 'quality',  label: 'مشكلة جودة', color: 'gold', icon: 'alert-circle', severity: 'high' },
    other:    { key: 'other',    label: 'أخرى', color: 'purple', icon: 'help-circle', severity: 'low' }
  };

  // 3) الحالة الداخلية
  var state = {
    blacklist: [],
    blacklistByNorm: {},
    blacklistBySuffix: {},
    quarantinedBatches: [],
    companyId: null,
    loaded: false,
    loadedAt: 0,
    loading: null,
    listeners: []
  };

  // 4) أدوات مساعدة
  function normalize(code) {
    if (!code) return '';
    return String(code).toUpperCase().replace(/[\s\-_\/\\\.\,]+/g, '').trim();
  }

  function getSuffix(code, len) {
    len = len || MATCH_MIN_LEN;
    var norm = normalize(code);
    if (norm.length <= len) return norm;
    return norm.slice(-len);
  }

  function match(code1, code2) {
    var a = normalize(code1);
    var b = normalize(code2);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= MATCH_MIN_LEN && b.length >= MATCH_MIN_LEN) {
      return a.slice(-MATCH_MIN_LEN) === b.slice(-MATCH_MIN_LEN);
    }
    return false;
  }

  function getCompanyId() {
    if (state.companyId) return state.companyId;
    try {
      var session = (Refad.auth && typeof Refad.auth.getSession === 'function') ? Refad.auth.getSession() : null;
      if (session && session.company_id) {
        state.companyId = session.company_id;
        return state.companyId;
      }
      var raw = localStorage.getItem('refad_session');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.company_id) {
          state.companyId = s.company_id;
          return state.companyId;
        }
      }
    } catch (e) {}
    return null;
  }

  function emitChange(reason) {
    var payload = {
      reason: reason || 'unknown',
      blacklistCount: state.blacklist.length,
      quarantinedCount: state.quarantinedBatches.length
    };
    for (var i = 0; i < state.listeners.length; i++) {
      try { state.listeners[i](payload); } catch (e) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('refad:quarantine-change', { detail: payload }));
    } catch (e) {}
  }

  function buildIndexes() {
    state.blacklistByNorm = {};
    state.blacklistBySuffix = {};

    for (var i = 0; i < state.blacklist.length; i++) {
      var item = state.blacklist[i];
      var norm = item.batch_number_normalized || normalize(item.batch_number);
      var suffix = item.batch_number_suffix || getSuffix(item.batch_number);

      if (norm) state.blacklistByNorm[norm] = item;

      if (suffix) {
        if (!state.blacklistBySuffix[suffix]) state.blacklistBySuffix[suffix] = [];
        state.blacklistBySuffix[suffix].push(item);
      }
    }
  }

  // 5) التحميل
  function load(force) {
    if (state.loading) return state.loading;

    if (!force && state.loaded && (Date.now() - state.loadedAt) < CACHE_TTL) {
      return Promise.resolve({
        blacklist: state.blacklist.slice(),
        quarantined: state.quarantinedBatches.slice()
      });
    }

    var companyId = getCompanyId();
    if (!companyId) {
      state.blacklist = [];
      state.quarantinedBatches = [];
      state.loaded = true;
      state.loadedAt = Date.now();
      buildIndexes();
      return Promise.resolve({ blacklist: [], quarantined: [] });
    }

    var p1 = Refad.db.select('batch_blacklist', {
      columns: 'id, company_id, batch_number, batch_number_normalized, batch_number_suffix, product_id, product_name, reason, reason_note, source, severity, status, created_by, created_at, released_at, released_by, release_notes, notes',
      eq: { company_id: companyId, status: 'active' },
      order: { column: 'created_at', ascending: false },
      limit: 500
    }).catch(function (e) {
      console.warn('[Refad.Quarantine] blacklist load failed:', e.message);
      return [];
    });

    var p2 = Refad.db.select('batches', {
      columns: 'id, company_id, product_id, warehouse_id, batch_number, quantity_left, cost_price, sale_price, expiry_date, is_quarantined, quarantine_reason, quarantine_reason_note, quarantine_notes, quarantined_at, quarantined_by, products(name, form, unit)',
      eq: { company_id: companyId, is_quarantined: true },
      order: { column: 'quarantined_at', ascending: false },
      limit: 500
    }).catch(function (e) {
      console.warn('[Refad.Quarantine] quarantined load failed:', e.message);
      return [];
    });

    state.loading = Promise.all([p1, p2]).then(function (results) {
      state.blacklist = results[0] || [];
      state.quarantinedBatches = results[1] || [];
      state.loaded = true;
      state.loadedAt = Date.now();
      buildIndexes();
      state.loading = null;
      return {
        blacklist: state.blacklist.slice(),
        quarantined: state.quarantinedBatches.slice()
      };
    }).catch(function (e) {
      console.error('[Refad.Quarantine] load failed:', e);
      state.blacklist = [];
      state.quarantinedBatches = [];
      state.loaded = true;
      state.loadedAt = Date.now();
      state.loading = null;
      return { blacklist: [], quarantined: [] };
    });

    return state.loading;
  }

  function ensureLoaded() {
    if (!state.loaded) return load(false);
    return Promise.resolve({
      blacklist: state.blacklist.slice(),
      quarantined: state.quarantinedBatches.slice()
    });
  }

  function refresh() {
    return load(true).then(function (r) {
      emitChange('refresh');
      return r;
    });
  }

  // 6) الفحص
  function checkBlacklist(batchNumber) {
    if (!batchNumber) return null;
    var norm = normalize(batchNumber);
    if (!norm) return null;

    if (state.blacklistByNorm[norm]) {
      return state.blacklistByNorm[norm];
    }

    if (norm.length >= MATCH_MIN_LEN) {
      var suffix = norm.slice(-MATCH_MIN_LEN);
      var candidates = state.blacklistBySuffix[suffix];
      if (candidates && candidates.length) {
        return candidates[0];
      }
    }

    return null;
  }

  function canReceive(batchNumber) {
    if (!batchNumber) return { allowed: true };

    var bl = checkBlacklist(batchNumber);
    if (bl) {
      var r = REASONS[bl.reason] || REASONS.other;
      return {
        allowed: false,
        blockType: 'blacklist',
        blockItem: bl,
        message: 'هذه التشغيلة في القايمة السوداء (' + r.label + '). لا يمكن استلامها.',
        reasonLabel: r.label,
        reasonNote: bl.reason_note || ''
      };
    }

    return { allowed: true };
  }

  function canSell(batchId, batchNumber) {
    if (batchId) {
      for (var i = 0; i < state.quarantinedBatches.length; i++) {
        if (Number(state.quarantinedBatches[i].id) === Number(batchId)) {
          var b = state.quarantinedBatches[i];
          var r = REASONS[b.quarantine_reason] || REASONS.other;
          return {
            allowed: false,
            blockType: 'quarantine',
            blockItem: b,
            message: 'هذه التشغيلة محظورة (' + r.label + '). لا يمكن بيعها.',
            reasonLabel: r.label,
            reasonNote: b.quarantine_reason_note || ''
          };
        }
      }
    }

    if (batchNumber) {
      var bl = checkBlacklist(batchNumber);
      if (bl) {
        var r2 = REASONS[bl.reason] || REASONS.other;
        return {
          allowed: false,
          blockType: 'blacklist',
          blockItem: bl,
          message: 'هذه التشغيلة في القايمة السوداء (' + r2.label + ').',
          reasonLabel: r2.label,
          reasonNote: bl.reason_note || ''
        };
      }
    }

    return { allowed: true };
  }

  function filterSellable(batches) {
    if (!batches || !batches.length) return [];
    return batches.filter(function (b) {
      if (!b) return false;
      if (b.is_quarantined) return false;
      if (b.batch_number) {
        var bl = checkBlacklist(b.batch_number);
        if (bl) return false;
      }
      return true;
    });
  }

  function check(opts) {
    opts = opts || {};
    var op = opts.operation || 'sell';

    if (op === 'receive') return canReceive(opts.batchNumber);
    if (op === 'sell' || op === 'transfer') return canSell(opts.batchId, opts.batchNumber);

    var r1 = canSell(opts.batchId, opts.batchNumber);
    if (!r1.allowed) return r1;
    return canReceive(opts.batchNumber);
  }

  // 7) Blacklist CRUD
  function addToBlacklist(data) {
    var companyId = getCompanyId();
    if (!companyId) return Promise.reject(new Error('No company_id'));

    var batchNumber = (data.batch_number || '').trim();
    if (!batchNumber) return Promise.reject(new Error('رقم التشغيلة مطلوب'));

    var normalized = normalize(batchNumber);
    var suffix = getSuffix(batchNumber, MATCH_MIN_LEN);

    var existing = checkBlacklist(batchNumber);
    if (existing) {
      return Promise.reject(new Error('هذه التشغيلة موجودة بالفعل في القايمة السوداء'));
    }

    var session = (Refad.auth && typeof Refad.auth.getSession === 'function') ? Refad.auth.getSession() : null;

    var payload = {
      company_id: companyId,
      batch_number: batchNumber,
      batch_number_normalized: normalized,
      batch_number_suffix: suffix,
      product_id: data.product_id || null,
      product_name: data.product_name || null,
      reason: data.reason || 'ministry',
      reason_note: data.reason_note || null,
      source: data.source || 'ministry',
      severity: data.severity || (REASONS[data.reason] ? REASONS[data.reason].severity : 'high'),
      status: 'active',
      created_by: session ? session.user_id : null,
      created_at: new Date().toISOString(),
      notes: data.notes || null
    };

    return Refad.db.insert('batch_blacklist', payload).then(function (created) {
      if (created && created.id) {
        state.blacklist.unshift(created);
        buildIndexes();
        emitChange('blacklist-add');
      }
      return created;
    });
  }

  function releaseFromBlacklist(id, notes) {
    var session = (Refad.auth && typeof Refad.auth.getSession === 'function') ? Refad.auth.getSession() : null;

    return Refad.db.update('batch_blacklist', id, {
      status: 'released',
      released_at: new Date().toISOString(),
      released_by: session ? session.user_id : null,
      release_notes: notes || null
    }).then(function (updated) {
      state.blacklist = state.blacklist.filter(function (b) {
        return Number(b.id) !== Number(id);
      });
      buildIndexes();
      emitChange('blacklist-release');
      return updated;
    });
  }

  function deleteFromBlacklist(id) {
    return Refad.db.remove('batch_blacklist', id).then(function () {
      state.blacklist = state.blacklist.filter(function (b) {
        return Number(b.id) !== Number(id);
      });
      buildIndexes();
      emitChange('blacklist-delete');
      return true;
    });
  }

  // 8) Quarantine CRUD
  function quarantineBatch(batchId, reason, reasonNote, notes) {
    var session = (Refad.auth && typeof Refad.auth.getSession === 'function') ? Refad.auth.getSession() : null;

    return Refad.db.update('batches', batchId, {
      is_quarantined: true,
      quarantine_reason: reason || 'hold',
      quarantine_reason_note: reasonNote || null,
      quarantine_notes: notes || null,
      quarantined_at: new Date().toISOString(),
      quarantined_by: session ? session.user_id : null
    }).then(function (updated) {
      var idx = -1;
      for (var i = 0; i < state.quarantinedBatches.length; i++) {
        if (Number(state.quarantinedBatches[i].id) === Number(batchId)) {
          idx = i;
          break;
        }
      }
      if (idx === -1 && updated) {
        state.quarantinedBatches.unshift(updated);
      } else if (updated) {
        state.quarantinedBatches[idx] = updated;
      }
      emitChange('quarantine-add');
      return updated;
    });
  }

  function releaseBatch(batchId, notes) {
    var session = (Refad.auth && typeof Refad.auth.getSession === 'function') ? Refad.auth.getSession() : null;

    return Refad.db.update('batches', batchId, {
      is_quarantined: false,
      quarantine_released_at: new Date().toISOString(),
      quarantine_released_by: session ? session.user_id : null,
      quarantine_release_notes: notes || null
    }).then(function (updated) {
      state.quarantinedBatches = state.quarantinedBatches.filter(function (b) {
        return Number(b.id) !== Number(batchId);
      });
      emitChange('quarantine-release');
      return updated;
    });
  }

  // 9) Getters
  function getBlacklist() { return state.blacklist.slice(); }
  function getQuarantinedBatches() { return state.quarantinedBatches.slice(); }
  function getReason(key) { return REASONS[key] || REASONS.other; }

  function getAllReasons() {
    var arr = [];
    for (var k in REASONS) {
      if (REASONS.hasOwnProperty(k)) arr.push(REASONS[k]);
    }
    return arr;
  }

  function onChange(callback) {
    if (typeof callback !== 'function') return function () {};
    state.listeners.push(callback);
    return function () {
      var i = state.listeners.indexOf(callback);
      if (i !== -1) state.listeners.splice(i, 1);
    };
  }

  // 10) التصدير
  Refad.Quarantine = {
    load: load,
    ensureLoaded: ensureLoaded,
    refresh: refresh,

    check: check,
    checkBlacklist: checkBlacklist,
    canReceive: canReceive,
    canSell: canSell,
    filterSellable: filterSellable,

    addToBlacklist: addToBlacklist,
    releaseFromBlacklist: releaseFromBlacklist,
    deleteFromBlacklist: deleteFromBlacklist,

    quarantineBatch: quarantineBatch,
    releaseBatch: releaseBatch,

    getBlacklist: getBlacklist,
    getQuarantinedBatches: getQuarantinedBatches,
    getReason: getReason,
    getAllReasons: getAllReasons,

    normalize: normalize,
    getSuffix: getSuffix,
    match: match,

    onChange: onChange,
    _state: state
  };

  console.log('%c[Refad] Quarantine module loaded', 'color:#14B8A6;font-weight:bold');

})();