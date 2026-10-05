/* ============================================================
   Refad ERP - Excel Helper
   Version: 1.0.0
   Dependencies: SheetJS (xlsx)
   ============================================================ */

(function (global) {
  'use strict';

  if (!global.Refad) {
    console.error('[Refad] Core is required before excel module');
    return;
  }

  const Excel = {
    version: '1.0.0',

    exportJson(rows, opts) {
      opts = opts || {};
      if (!rows || !rows.length) return Refad.toast?.warning('لا توجد بيانات للتصدير');
      if (typeof XLSX === 'undefined') return Refad.toast?.error('مكتبة Excel غير محمّلة');

      let data = rows;
      if (opts.columns && Array.isArray(opts.columns)) {
        data = rows.map(r => {
          const o = {};
          opts.columns.forEach(c => { o[c.label || c.key] = r[c.key]; });
          return o;
        });
      }

      const ws = XLSX.utils.json_to_sheet(data);
      try {
        ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(12, Math.min(40, k.length + 6)) }));
      } catch (e) {}

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || 'Sheet1');
      XLSX.writeFile(wb, opts.fileName || ('export_' + Excel.today() + '.xlsx'));
      Refad.toast?.success('تم تصدير ' + rows.length + ' صف');
    },

    exportTable(tableRef, opts) {
      opts = opts || {};
      const table = typeof tableRef === 'string' ? document.querySelector(tableRef) : tableRef;
      if (!table) return Refad.toast?.warning('لم يتم العثور على الجدول');
      if (typeof XLSX === 'undefined') return Refad.toast?.error('مكتبة Excel غير محمّلة');

      const ws = XLSX.utils.table_to_sheet(table);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || 'Sheet1');
      XLSX.writeFile(wb, opts.fileName || ('export_' + Excel.today() + '.xlsx'));
      Refad.toast?.success('تم التصدير');
    },

    importFile(file, opts) {
      opts = opts || {};
      return new Promise((resolve, reject) => {
        if (!file) return reject(new Error('لم يتم اختيار ملف'));
        if (typeof XLSX === 'undefined') return reject(new Error('مكتبة Excel غير محمّلة'));

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const sheetName = typeof opts.sheet === 'number'
              ? wb.SheetNames[opts.sheet || 0]
              : (opts.sheet || wb.SheetNames[0]);
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, {
              header: opts.header !== false ? undefined : 1,
              defval: '',
              raw: false
            });
            resolve(rows);
          } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('فشل قراءة الملف'));
        reader.readAsArrayBuffer(file);
      });
    },

    pickAndImport(opts) {
      opts = opts || {};
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = opts.accept || '.xlsx,.xls,.csv';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const rows = await Excel.importFile(file, opts);
          opts.onLoad?.(rows, file);
        } catch (err) {
          console.error('[Refad.Excel] import failed:', err);
          Refad.toast?.error('فشل الاستيراد: ' + err.message);
        }
      };
      input.click();
    },

    downloadTemplate(headers, opts) {
      opts = opts || {};
      if (!headers || !headers.length) return Refad.toast?.warning('لا توجد أعمدة');
      if (typeof XLSX === 'undefined') return;

      const ws = XLSX.utils.aoa_to_sheet([headers]);
      if (opts.sampleRow) {
        const sampleRow = headers.map(h => opts.sampleRow[h] != null ? opts.sampleRow[h] : '');
        XLSX.utils.sheet_add_aoa(ws, [sampleRow], { origin: -1 });
      }
      ws['!cols'] = headers.map(h => ({ wch: Math.max(15, h.length + 4) }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template');
      XLSX.writeFile(wb, opts.fileName || 'template.xlsx');
      Refad.toast?.success('تم تحميل القالب');
    },

    today() { return new Date().toISOString().slice(0, 10); },

    parseExcelDate(v) {
      if (v == null) return null;
      if (typeof v === 'number') {
        const d = new Date((v - 25569) * 86400 * 1000);
        if (isNaN(d)) return null;
        return d.toISOString().slice(0, 10);
      }
      const d = new Date(v);
      if (isNaN(d)) return null;
      return d.toISOString().slice(0, 10);
    },

    pickValue(row, keys) {
      for (const k of keys) {
        if (row[k] != null && row[k] !== '') return row[k];
      }
      const lower = keys.map(k => k.toLowerCase());
      for (const key of Object.keys(row)) {
        if (lower.includes(key.toLowerCase().trim())) return row[key];
      }
      return null;
    }
  };

  global.Refad.Excel = Excel;
  console.log('%c[Refad] Excel v' + Excel.version + ' loaded', 'color:#10b981;font-weight:bold');

})(typeof window !== 'undefined' ? window : this);