/* ============================================================
   Refad ERP - Print Helper
   Version: 1.0.0
   Dependencies: print-js, jsPDF, jspdf-autotable (اختياري)
   ============================================================ */

(function (global) {
  'use strict';

  if (!global.Refad) {
    console.error('[Refad] Core is required before print module');
    return;
  }

  const Print = {
    version: '1.0.0',

    // ============================================================
    // 1) طباعة HTML مباشرة (نافذة جديدة)
    // ============================================================
    /**
     * @param {string|HTMLElement} content - HTML string أو عنصر
     * @param {object} opts - { title, orientation, pageSize, styles }
     */
    html(content, opts) {
      opts = opts || {};
      const html = typeof content === 'string' ? content : content.outerHTML;
      const w = window.open('', '_blank');
      if (!w) {
        Refad.toast?.warning('الرجاء السماح بالنوافذ المنبثقة');
        return;
      }

      const orientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
      const pageSize = opts.pageSize || 'A4';
      const title = opts.title || 'طباعة';

      w.document.write(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>${Refad.escapeHtml(title)}</title>
          <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Cairo', Arial, sans-serif;
              padding: 20px;
              color: #0f172a;
              background: #fff;
              font-size: 13px;
              line-height: 1.5;
            }
            h1, h2, h3 { color: #0B2C4D; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; font-size: 12px; }
            th { background: #F1F5F9; font-weight: 700; }
            .no-print { display: none !important; }
            @page { size: ${pageSize} ${orientation}; margin: 12mm; }
            @media print {
              body { padding: 0; font-size: 12px; }
              .no-print { display: none !important; }
              a { color: inherit; text-decoration: none; }
            }
            ${opts.styles || ''}
          </style>
        </head>
        <body>
          ${html}
          <script>
            window.addEventListener('load', function() {
              setTimeout(function() { window.print(); }, 400);
            });
          <\/script>
        </body>
        </html>
      `);
      w.document.close();
    },

    // ============================================================
    // 2) طباعة جدول HTML
    // ============================================================
    table(tableRef, opts) {
      opts = opts || {};
      const table = typeof tableRef === 'string'
        ? document.querySelector(tableRef)
        : tableRef;
      if (!table) {
        Refad.toast?.warning('لم يتم العثور على الجدول');
        return;
      }

      const title = opts.title || 'جدول';
      const subtitle = opts.subtitle ? `<div style="color:#64748b;font-size:12px;margin-bottom:12px;">${Refad.escapeHtml(opts.subtitle)}</div>` : '';
      const styles = `
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: right; font-size: 11px; }
        th { background: #F1F5F9; font-weight: 700; color: #0B2C4D; }
        tr:nth-child(even) td { background: #f8fafc; }
      `;

      Print.html(`
        <h2 style="font-size:18px;margin-bottom:6px;">${Refad.escapeHtml(title)}</h2>
        ${subtitle}
        ${table.outerHTML}
        <div style="margin-top:20px;text-align:center;font-size:11px;color:#94a3b8;">
          ${Refad.escapeHtml(Refad.company?.name || '')} • ${new Date().toLocaleString('ar-EG')}
        </div>
      `, { title: title, orientation: opts.orientation, styles: styles });
    },

    // ============================================================
    // 3) تصدير PDF (jsPDF + autoTable)
    // ============================================================
    /**
     * @param {array} rows - بيانات الجدول
     * @param {array} columns - [{ header, dataKey }]
     * @param {object} opts - { fileName, title, subtitle, orientation }
     */
    pdfTable(rows, columns, opts) {
      opts = opts || {};
      if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
        Refad.toast?.error('مكتبة PDF غير محمّلة');
        return;
      }
      const { jsPDF } = window.jspdf || window;
      const doc = new jsPDF({
        orientation: opts.orientation || 'portrait',
        unit: 'pt',
        format: 'a4'
      });

      // عنوان
      const title = opts.title || 'تقرير';
      const companyName = Refad.company?.name || '';

      doc.setFontSize(16);
      doc.setTextColor(11, 44, 77);
      doc.text(companyName, doc.internal.pageSize.width / 2, 40, { align: 'center' });

      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(title, doc.internal.pageSize.width / 2, 62, { align: 'center' });

      if (opts.subtitle) {
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text(opts.subtitle, doc.internal.pageSize.width / 2, 78, { align: 'center' });
      }

      // الجدول
      if (typeof doc.autoTable === 'function') {
        doc.autoTable({
          head: [columns.map(c => c.header)],
          body: rows.map(r => columns.map(c => r[c.dataKey] != null ? r[c.dataKey] : '')),
          startY: opts.subtitle ? 95 : 80,
          styles: {
            font: 'helvetica',
            fontSize: 9,
            cellPadding: 4,
            halign: 'right',
            textColor: [15, 23, 42]
          },
          headStyles: {
            fillColor: [11, 44, 77],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            halign: 'right'
          },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { top: 60, right: 30, left: 30, bottom: 40 }
        });
      } else {
        console.warn('[Refad.Print] jspdf-autotable not loaded');
        doc.setFontSize(10);
        doc.text('jspdf-autotable not loaded', 40, 100);
      }

      // footer
      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `صفحة ${i} / ${pages} • ${new Date().toLocaleDateString('ar-EG')}`,
          doc.internal.pageSize.width / 2,
          doc.internal.pageSize.height - 15,
          { align: 'center' }
        );
      }

      const fname = opts.fileName || ('report_' + new Date().toISOString().slice(0, 10) + '.pdf');
      doc.save(fname);
      Refad.toast?.success('تم إنشاء PDF');
    },

    // ============================================================
    // 4) طباعة فاتورة بشكل جاهز
    // ============================================================
    /**
     * @param {object} invoice - { number, date, customer, items, subtotal, discount, total, notes }
     */
    invoice(invoice, opts) {
      opts = opts || {};
      const company = Refad.company || {};
      const logoUrl = company.logo_url || 'logo.png';

      const itemsHtml = (invoice.items || []).map((it, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${Refad.escapeHtml(it.name)}</td>
          <td>${it.quantity}</td>
          <td>${Refad.format.money(it.price)}</td>
          <td>${Refad.format.money(it.total)}</td>
        </tr>
      `).join('');

      Print.html(`
        <div style="border-bottom:2px solid #0B2C4D;padding-bottom:12px;margin-bottom:16px;display:flex;align-items:center;gap:14px;">
          <img src="${Refad.escapeHtml(logoUrl)}" style="width:70px;height:70px;object-fit:contain;" onerror="this.style.display='none'">
          <div style="flex:1;">
            <h1 style="font-size:20px;margin-bottom:4px;">${Refad.escapeHtml(company.name || '')}</h1>
            <div style="font-size:11px;color:#64748b;line-height:1.5;">
              ${company.address ? Refad.escapeHtml(company.address) + '<br>' : ''}
              ${company.phone ? '📞 ' + Refad.escapeHtml(company.phone) : ''}
              ${company.tax_number ? ' • الرقم الضريبي: ' + Refad.escapeHtml(company.tax_number) : ''}
            </div>
          </div>
          <div style="text-align:left;font-size:12px;">
            <div style="font-weight:800;color:#0B2C4D;font-size:14px;">فاتورة</div>
            <div style="color:#64748b;">رقم: <strong>${Refad.escapeHtml(invoice.number || '')}</strong></div>
            <div style="color:#64748b;">التاريخ: <strong>${Refad.escapeHtml(invoice.date || Refad.format.date(new Date()))}</strong></div>
          </div>
        </div>

        ${invoice.customer ? `
          <div style="background:#F1F5F9;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;">
            <strong>العميل:</strong> ${Refad.escapeHtml(invoice.customer.name || '')}
            ${invoice.customer.phone ? ' • 📞 ' + Refad.escapeHtml(invoice.customer.phone) : ''}
            ${invoice.customer.address ? '<br><strong>العنوان:</strong> ' + Refad.escapeHtml(invoice.customer.address) : ''}
          </div>
        ` : ''}

        <table>
          <thead>
            <tr>
              <th style="width:30px;">#</th>
              <th>الصنف</th>
              <th style="width:60px;">الكمية</th>
              <th style="width:80px;">السعر</th>
              <th style="width:90px;">الإجمالي</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:16px;">
          <div style="font-size:12px;color:#64748b;max-width:60%;">
            ${invoice.notes ? '<strong>ملاحظات:</strong><br>' + Refad.escapeHtml(invoice.notes) : ''}
          </div>
          <div style="font-size:13px;min-width:220px;">
            <div style="display:flex;justify-content:space-between;padding:4px 0;">
              <span>المجموع:</span><strong>${Refad.format.money(invoice.subtotal || 0)}</strong>
            </div>
            ${invoice.discount ? `
              <div style="display:flex;justify-content:space-between;padding:4px 0;">
                <span>الخصم:</span><strong style="color:#F59E0B;">${Refad.format.money(invoice.discount)}</strong>
              </div>
            ` : ''}
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #0B2C4D;margin-top:6px;">
              <strong style="color:#0B2C4D;font-size:15px;">الصافي:</strong>
              <strong style="color:#14B8A6;font-size:15px;">${Refad.format.money(invoice.total || 0)}</strong>
            </div>
          </div>
        </div>

        <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:11px;color:#64748b;">
          <div style="text-align:center;">
            _______________________<br>المستلم
          </div>
          <div style="text-align:center;">
            _______________________<br>التوقيع والختم
          </div>
        </div>

        <div style="margin-top:30px;text-align:center;font-size:11px;color:#94a3b8;">
          شكراً لتعاملكم معنا • ${Refad.escapeHtml(company.name || '')}
        </div>
      `, { title: 'فاتورة ' + (invoice.number || ''), orientation: opts.orientation || 'portrait' });
    },

    // ============================================================
    // 5) طباعة ملصقات (labels) — شبكة 3×8
    // ============================================================
    labels(items, opts) {
      opts = opts || {};
      const cols = opts.columns || 3;
      const rows = opts.rows || 8;

      const labelsHtml = (items || []).map(it => `
        <div class="label">
          <div class="label-name">${Refad.escapeHtml(it.name || '')}</div>
          ${it.price ? `<div class="label-price">${Refad.format.money(it.price)}</div>` : ''}
          ${it.barcode ? `<svg class="label-barcode" data-value="${Refad.escapeHtml(it.barcode)}"></svg>` : ''}
        </div>
      `).join('');

      Print.html(`
        <div class="labels-grid">${labelsHtml}</div>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
        <script>
          window.addEventListener('load', function() {
            document.querySelectorAll('.label-barcode').forEach(function(svg) {
              try {
                JsBarcode(svg, svg.dataset.value, { format: 'CODE128', width: 1.5, height: 40, displayValue: true, fontSize: 10, margin: 2 });
              } catch (e) {}
            });
          });
        <\/script>
      `, {
        title: 'ملصقات',
        styles: `
          .labels-grid {
            display: grid;
            grid-template-columns: repeat(${cols}, 1fr);
            gap: 4px;
          }
          .label {
            border: 1px dashed #cbd5e1;
            padding: 6px;
            text-align: center;
            page-break-inside: avoid;
          }
          .label-name { font-size: 11px; font-weight: 700; margin-bottom: 4px; }
          .label-price { font-size: 13px; font-weight: 800; color: #14B8A6; }
          .label-barcode { max-width: 100%; height: auto; }
        `
      });
    }
  };

  global.Refad.Print = Print;
  console.log('%c[Refad] Print v' + Print.version + ' loaded', 'color:#F59E0B;font-weight:bold');

})(typeof window !== 'undefined' ? window : this);