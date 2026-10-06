/* ============================================================
   Refad ERP - Print Helper
   Version: 1.0.0
   Dependencies: jsPDF + jspdf-autotable (اختياري)
   ============================================================ */

(function (global) {
  'use strict';

  if (!global.Refad) {
    console.error('[Refad] Core is required before print module');
    return;
  }

  const Print = {
    version: '1.0.0',

    html(content, opts) {
      opts = opts || {};
      const html = typeof content === 'string' ? content : content.outerHTML;
      const w = opts.windowRef || window.open('', '_blank');
      if (!w) return Refad.toast?.warning('الرجاء السماح بالنوافذ المنبثقة');

      const orientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
      const pageSize = opts.pageSize || 'A4';
      const receipt = pageSize === '80mm';
      const title = opts.title || 'طباعة';

      w.document.open();
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
              padding: 20px; color: #0f172a; background: #fff;
              font-size: 13px; line-height: 1.5;
            }
            ${receipt ? 'body { width: 72mm; padding: 4mm; font-size: 11px; } table { font-size: 10px; } th, td { padding: 4px 2px; font-size: 10px; }' : ''}
            ${receipt ? '.invoice-print-header { flex-wrap: wrap !important; gap: 6px !important; } .invoice-print-header img { width: 34px !important; height: 34px !important; } .invoice-print-header > div { font-size: 10px !important; }' : ''}
            h1, h2, h3 { color: #0B2C4D; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; font-size: 12px; }
            th { background: #F1F5F9; font-weight: 700; }
            .no-print { display: none !important; }
            ${receipt ? '@page { size: 80mm auto; margin: 0; }' : `@page { size: ${pageSize} ${orientation}; margin: 12mm; }`}
            @media print {
              body { padding: ${receipt ? '4mm' : '0'}; font-size: ${receipt ? '11px' : '12px'}; }
              .no-print { display: none !important; }
              a { color: inherit; text-decoration: none; }
            }
            ${opts.styles || ''}
          </style>
        </head>
        <body class="${receipt ? 'receipt' : ''}">
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

    table(tableRef, opts) {
      opts = opts || {};
      const table = typeof tableRef === 'string' ? document.querySelector(tableRef) : tableRef;
      if (!table) return Refad.toast?.warning('لم يتم العثور على الجدول');

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

    pdfTable(rows, columns, opts) {
      opts = opts || {};
      if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
        return Refad.toast?.error('مكتبة PDF غير محمّلة');
      }
      const { jsPDF } = window.jspdf || window;
      const doc = new jsPDF({
        orientation: opts.orientation || 'portrait',
        unit: 'pt', format: 'a4'
      });

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

      if (typeof doc.autoTable === 'function') {
        doc.autoTable({
          head: [columns.map(c => c.header)],
          body: rows.map(r => columns.map(c => r[c.dataKey] != null ? r[c.dataKey] : '')),
          startY: opts.subtitle ? 95 : 80,
          styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, halign: 'right', textColor: [15, 23, 42] },
          headStyles: { fillColor: [11, 44, 77], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { top: 60, right: 30, left: 30, bottom: 40 }
        });
      } else {
        console.warn('[Refad.Print] jspdf-autotable not loaded');
      }

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

    invoice(invoice, opts) {
      opts = opts || {};
      const pageSize = opts.pageSize || 'A4';
      const company = opts.company || Refad.company || {};
      if (!company.id) {
        Refad.toast?.error('تعذّر تحميل بيانات الشركة؛ لا يمكن طباعة الفاتورة');
        return;
      }

      let invoiceSettings = {};
      try {
        if (typeof company.notes === 'string' && company.notes.trim().startsWith('{')) {
          invoiceSettings = JSON.parse(company.notes);
        }
      } catch (error) {
        console.warn('[Refad.Print] Invoice settings could not be read:', error);
      }

      const itemsHtml = (invoice.items || []).map((it, i) => {
        const quantity = Number(it.quantity) || 0;
        const rawPrice = it.price ?? it.unit_price ?? it.sale_price;
        const price = Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : 0;
        const rawTotal = it.total ?? it.line_total;
        const total = rawTotal == null
          ? quantity * price
          : Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : 0;
        const product = it.product || it.products || {};
        const name = it.name || product.name || '—';
        const discount = Number(it.discount ?? it.sale_discount) || 0;
        if (pageSize === '80mm') {
          return `
            <tr>
              <td>${Refad.escapeHtml(name)}${discount ? `<br><small>خصم ${Refad.format.number(discount, 1)}%</small>` : ''}</td>
              <td>${Refad.format.number(quantity)}</td>
              <td>${Refad.format.money(price)}</td>
              <td>${Refad.format.money(total)}</td>
            </tr>
          `;
        }
        return `
        <tr>
          <td>${i + 1}</td>
          <td>${Refad.escapeHtml(name)}</td>
          <td>${Refad.format.number(quantity)}</td>
          <td>${Refad.format.money(price)}</td>
          <td>${discount ? `${Refad.format.number(discount, 1)}%` : '—'}</td>
          <td>${Refad.format.money(total)}</td>
        </tr>
      `;
      }).join('');

      const customer = invoice.customer || {};
      const discountTotal = Number(invoice.discount_total ?? invoice.discount) || 0;
      const total = Number(invoice.total ?? invoice.grand_total) || 0;
      const footer = invoice.footer || invoiceSettings.invoice_footer || '';
      const terms = invoice.terms || invoiceSettings.invoice_terms || '';

      Print.html(`
        <div class="invoice-print-header" style="border-bottom:2px solid #0B2C4D;padding-bottom:12px;margin-bottom:16px;display:flex;align-items:center;gap:14px;">
          ${company.logo_url ? `<img src="${Refad.escapeHtml(company.logo_url)}" alt="${Refad.escapeHtml(company.name || '')}" style="width:70px;height:70px;object-fit:contain;" onerror="this.style.display='none'">` : ''}
          <div style="flex:1;">
            <h1 style="font-size:20px;margin-bottom:4px;">${Refad.escapeHtml(company.name || '')}</h1>
            <div style="font-size:11px;color:#64748b;line-height:1.5;">
              ${company.address ? Refad.escapeHtml(company.address) + '<br>' : ''}
              ${company.phone ? 'الهاتف: ' + Refad.escapeHtml(company.phone) : ''}
              ${company.email ? ' • البريد: ' + Refad.escapeHtml(company.email) : ''}
              ${company.tax_number ? '<br>الرقم الضريبي: ' + Refad.escapeHtml(company.tax_number) : ''}
            </div>
          </div>
          <div style="text-align:left;font-size:12px;">
            <div style="font-weight:800;color:#0B2C4D;font-size:14px;">فاتورة بيع</div>
            <div style="color:#64748b;">رقم: <strong>${Refad.escapeHtml(invoice.number || '')}</strong></div>
            <div style="color:#64748b;">التاريخ: <strong>${Refad.escapeHtml(invoice.date || Refad.format.date(new Date()))}</strong></div>
          </div>
        </div>

        <div style="background:#F1F5F9;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;">
          <strong>${invoice.supplier_id ? 'المورد المشتري:' : 'العميل:'}</strong> ${Refad.escapeHtml(customer.name || 'نقدي')}
          ${customer.phone ? ' • الهاتف: ' + Refad.escapeHtml(customer.phone) : ''}
          ${customer.address ? '<br>العنوان: ' + Refad.escapeHtml(customer.address) : ''}
        </div>

        <table>
          <thead>
            <tr>
              ${pageSize === '80mm'
                ? '<th>الصنف</th><th style="width:35px;">كمية</th><th style="width:55px;">سعر</th><th style="width:65px;">الإجمالي</th>'
                : '<th style="width:30px;">#</th><th>الصنف</th><th style="width:60px;">الكمية</th><th style="width:80px;">السعر</th><th style="width:55px;">خصم</th><th style="width:90px;">الإجمالي</th>'}
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
            ${discountTotal ? `
              <div style="display:flex;justify-content:space-between;padding:4px 0;">
                <span>الخصم:</span><strong style="color:#F59E0B;">${Refad.format.money(discountTotal)}</strong>
              </div>
            ` : ''}
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #0B2C4D;margin-top:6px;">
              <strong style="color:#0B2C4D;font-size:15px;">الصافي:</strong>
              <strong style="color:#14B8A6;font-size:15px;">${Refad.format.money(total)}</strong>
            </div>
            ${invoice.paid_amount != null ? `
              <div style="display:flex;justify-content:space-between;padding:4px 0;">
                <span>المدفوع:</span><strong>${Refad.format.money(invoice.paid_amount)}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;padding:4px 0;">
                <span>المتبقي:</span><strong>${Refad.format.money(Math.max(0, total - (Number(invoice.paid_amount) || 0)))}</strong>
              </div>
            ` : ''}
          </div>
        </div>

        ${terms ? `<div style="margin-top:18px;font-size:10px;color:#64748b;"><strong>الشروط:</strong> ${Refad.escapeHtml(terms)}</div>` : ''}

        ${pageSize === '80mm' ? '' : `
          <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:11px;color:#64748b;">
            <div style="text-align:center;">_______________________<br>المستلم</div>
            <div style="text-align:center;">_______________________<br>التوقيع والختم</div>
          </div>
        `}

        <div style="margin-top:30px;text-align:center;font-size:11px;color:#94a3b8;">
          ${Refad.escapeHtml(footer || `شكراً لتعاملكم معنا • ${company.name || ''}`)}
        </div>
      `, {
        title: 'فاتورة ' + (invoice.number || ''),
        orientation: opts.orientation || 'portrait',
        pageSize,
        windowRef: opts.windowRef
      });
    }
  };

  global.Refad.Print = Print;
  console.log('%c[Refad] Print v' + Print.version + ' loaded', 'color:#F59E0B;font-weight:bold');

})(typeof window !== 'undefined' ? window : this);