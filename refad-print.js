/* ============================================================
   Refad ERP - Print Helper
   Version: 2.0.0
   Dependencies: jsPDF + jspdf-autotable (اختياري)
   Features:
     - 3 page sizes: A4 / A5 / 80mm
     - Multi-copy printing (1-3 copies per page)
     - Invoice with discount column
     - QR code + barcode
     - Arabic + English dual dates
     - Amount in Arabic words
   ============================================================ */

(function (global) {
  'use strict';

  if (!global.Refad) {
    console.error('[Refad] Core is required before print module');
    return;
  }

  // ============================================================
  // Helper: Convert number to Arabic words
  // ============================================================
  const NumberToArabic = {
    ones: ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
           'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
           'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'],
    tens: ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'],
    hundreds: ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'],
    thousands: ['', 'ألف', 'ألفان', 'ثلاثة آلاف', 'أربعة آلاف', 'خمسة آلاف',
                'ستة آلاف', 'سبعة آلاف', 'ثمانية آلاف', 'تسعة آلاف'],

    convert(n) {
      n = Math.round(Number(n) || 0);
      if (n === 0) return 'صفر';

      const parts = [];
      const million = Math.floor(n / 1000000);
      const thousand = Math.floor((n % 1000000) / 1000);
      const rest = n % 1000;

      if (million > 0) {
        if (million === 1) parts.push('مليون');
        else if (million === 2) parts.push('مليونان');
        else if (million <= 10) parts.push(`${this.ones[million]} ملايين`);
        else parts.push(`${this.convertThreeDigits(million)} مليون`);
      }

      if (thousand > 0) {
        if (thousand === 1) parts.push('ألف');
        else if (thousand === 2) parts.push('ألفان');
        else if (thousand <= 10) parts.push(`${this.thousands[thousand]}`);
        else parts.push(`${this.convertThreeDigits(thousand)} ألف`);
      }

      if (rest > 0) {
        parts.push(this.convertThreeDigits(rest));
      }

      return parts.filter(Boolean).join(' و');
    },

    convertThreeDigits(n) {
      const parts = [];
      const h = Math.floor(n / 100);
      const t = Math.floor((n % 100) / 10);
      const o = n % 10;

      if (h > 0) parts.push(this.hundreds[h]);

      const lastTwo = n % 100;
      if (lastTwo >= 1 && lastTwo <= 19) {
        parts.push(this.ones[lastTwo]);
      } else {
        if (o > 0) parts.push(this.ones[o]);
        if (t > 0) parts.push(this.tens[t]);
      }

      return parts.filter(Boolean).join(' و');
    },

    format(amount, currency = 'جنيه') {
      const int = Math.floor(Number(amount) || 0);
      const piasters = Math.round(((Number(amount) || 0) - int) * 100);

      let result = this.convert(int) + ' ' + currency;
      if (piasters > 0) {
        result += ' و' + this.convert(piasters) + ' قرش';
      }
      return result + ' فقط لا غير';
    }
  };

  // ============================================================
  // Helper: Barcode SVG (JSBarcode)
  // ============================================================
  function generateBarcodeSVG(code, options = {}) {
    if (typeof JsBarcode === 'undefined') return '';
    try {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(svg, code, {
        format: 'CODE128',
        width: options.width || 1.2,
        height: options.height || 30,
        displayValue: true,
        fontSize: options.fontSize || 9,
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000'
      });
      return svg.outerHTML;
    } catch (e) {
      console.warn('Barcode generation failed:', e);
      return '';
    }
  }

  // ============================================================
  // Helper: Hijri Date
  // ============================================================
  function getHijriDate(date = new Date()) {
    try {
      return new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(date);
    } catch (e) {
      return '';
    }
  }

  // ============================================================
  // Print Module
  // ============================================================
  const Print = {
    version: '2.0.0',

    // --------------------------------------------------------
    // Generic HTML Print
    // --------------------------------------------------------
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
            ${receipt ? 'body { width: 72mm; padding: 4mm; font-size: 11px; }' : ''}
            h1, h2, h3 { color: #0B2C4D; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; font-size: 12px; }
            th { background: #F1F5F9; font-weight: 700; }
            .no-print { display: none !important; }
            ${receipt ? '@page { size: 80mm auto; margin: 0; }' : `@page { size: ${pageSize} ${orientation}; margin: 8mm; }`}
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
              setTimeout(function() { window.print(); }, 500);
            });
          <\/script>
        </body>
        </html>
      `);
      w.document.close();
    },

    // --------------------------------------------------------
    // Table Print
    // --------------------------------------------------------
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

    // --------------------------------------------------------
    // PDF Table
    // --------------------------------------------------------
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

    // --------------------------------------------------------
    // Invoice Print - Enhanced Version
    // --------------------------------------------------------
    invoice(invoice, opts) {
      opts = opts || {};
      const pageSize = opts.pageSize || 'A4';
      const copies = Math.max(1, Math.min(3, parseInt(opts.copies, 10) || 1));
      const company = opts.company || Refad.company || {};
      if (!company.id) {
        Refad.toast?.error('تعذّر تحميل بيانات الشركة؛ لا يمكن طباعة الفاتورة');
        return;
      }

      // إعدادات الفاتورة من company.notes
      let invoiceSettings = {};
      try {
        if (typeof company.notes === 'string' && company.notes.trim().startsWith('{')) {
          invoiceSettings = JSON.parse(company.notes);
        }
      } catch (error) {
        console.warn('[Refad.Print] Invoice settings could not be read:', error);
      }

      // تواريخ
      const now = new Date();
      const gregorian = now.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
      const hijri = getHijriDate(now);
      const time = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

      // بيانات الفاتورة
      const invoiceNum = invoice.number || '';
      const customer = invoice.customer || {};
      const customerName = customer.name || 'عميل نقدي';
      const discountTotal = Number(invoice.discount_total ?? invoice.discount) || 0;
      const subtotal = Number(invoice.subtotal) || 0;
      const total = Number(invoice.total ?? invoice.grand_total) || 0;
      const paidAmount = invoice.paid_amount != null ? Number(invoice.paid_amount) : null;
      const remaining = paidAmount != null ? Math.max(0, total - paidAmount) : null;
      const change = paidAmount != null && paidAmount > total ? paidAmount - total : 0;
      const paymentType = invoice.payment_type === 'credit' ? 'آجل' : 'نقدي';
      const cashier = invoice.cashier_name || invoice.cashier || '';
      const salesRep = invoice.sales_rep || invoice.representative_name || '';
      const notes = invoice.notes || '';
      const footer = invoice.footer || invoiceSettings.invoice_footer || '';
      const terms = invoice.terms || invoiceSettings.invoice_terms || '';
      const invoiceType = invoice.invoice_type === 'return' ? 'مرتجع بيع' : 'فاتورة بيع';

      // توليد الباركود
      const barcodeSVG = invoiceNum ? generateBarcodeSVG(invoiceNum, {
        width: pageSize === '80mm' ? 1 : 1.4,
        height: pageSize === '80mm' ? 25 : 35,
        fontSize: pageSize === '80mm' ? 8 : 10
      }) : '';

      // ============================================================
      // BODY: بناء نسخة واحدة (Copy)
      // ============================================================
      const buildSingleCopy = (copyLabel = '') => {
        const isReceipt = pageSize === '80mm';
        const isA5 = pageSize === 'A5';

        // 1. Header
        const headerHtml = `
          <div class="invoice-header">
            <div class="header-right">
              ${company.logo_url ? `<img src="${Refad.escapeHtml(company.logo_url)}" alt="${Refad.escapeHtml(company.name || '')}" onerror="this.style.display='none'">` : ''}
              <div class="company-info">
                <h1>${Refad.escapeHtml(company.name || '')}</h1>
                ${company.address ? `<div>${Refad.escapeHtml(company.address)}</div>` : ''}
                <div>
                  ${company.phone ? `📞 ${Refad.escapeHtml(company.phone)}` : ''}
                  ${company.email ? ` • ✉️ ${Refad.escapeHtml(company.email)}` : ''}
                </div>
                ${company.tax_number ? `<div>الرقم الضريبي: ${Refad.escapeHtml(company.tax_number)}</div>` : ''}
              </div>
            </div>
            <div class="header-left">
              <div class="invoice-title">${Refad.escapeHtml(invoiceType)}</div>
              <div class="invoice-number">#${Refad.escapeHtml(invoiceNum)}</div>
              ${barcodeSVG ? `<div class="barcode-wrap">${barcodeSVG}</div>` : ''}
            </div>
          </div>
        `;

        // 2. Meta Info (العميل والتاريخ)
        const metaHtml = `
          <div class="invoice-meta">
            <div class="meta-item">
              <span class="meta-label">العميل:</span>
              <span class="meta-value">${Refad.escapeHtml(customerName)}</span>
            </div>
            ${customer.phone ? `
              <div class="meta-item">
                <span class="meta-label">الهاتف:</span>
                <span class="meta-value">${Refad.escapeHtml(customer.phone)}</span>
              </div>
            ` : ''}
            <div class="meta-item">
              <span class="meta-label">التاريخ:</span>
              <span class="meta-value">${Refad.escapeHtml(gregorian)}</span>
            </div>
            ${hijri && !isReceipt ? `
              <div class="meta-item">
                <span class="meta-label">الموافق:</span>
                <span class="meta-value">${Refad.escapeHtml(hijri)}</span>
              </div>
            ` : ''}
            <div class="meta-item">
              <span class="meta-label">الوقت:</span>
              <span class="meta-value">${Refad.escapeHtml(time)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">نوع الدفع:</span>
              <span class="meta-value">${Refad.escapeHtml(paymentType)}</span>
            </div>
            ${cashier ? `
              <div class="meta-item">
                <span class="meta-label">الكاشير:</span>
                <span class="meta-value">${Refad.escapeHtml(cashier)}</span>
              </div>
            ` : ''}
            ${salesRep ? `
              <div class="meta-item">
                <span class="meta-label">المندوب:</span>
                <span class="meta-value">${Refad.escapeHtml(salesRep)}</span>
              </div>
            ` : ''}
            ${invoice.order_number ? `
              <div class="meta-item">
                <span class="meta-label">طلب بيع:</span>
                <span class="meta-value">${Refad.escapeHtml(invoice.order_number)}</span>
              </div>
            ` : ''}
          </div>
        `;

        // 3. Items Table
        const itemsHtml = (invoice.items || []).map((it, i) => {
          const quantity = Number(it.quantity) || 0;
          const rawPrice = it.price ?? it.unit_price ?? it.sale_price;
          const price = Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : 0;
          const discount = Number(it.discount ?? it.sale_discount) || 0;
          const discountAmount = price * quantity * (discount / 100);
          const netUnitPrice = price * (1 - discount / 100);
          const rawTotal = it.total ?? it.line_total;
          const total = rawTotal == null
            ? quantity * netUnitPrice
            : Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : 0;
          const product = it.product || it.products || {};
          const name = it.name || product.name || '—';
          const unit = product.unit || '';

          if (isReceipt) {
            // 80mm receipt format
            return `
              <tr>
                <td class="center">${i + 1}</td>
                <td>
                  ${Refad.escapeHtml(name)}
                  ${discount ? `<br><small style="color:#F59E0B;">خصم ${Refad.format.number(discount, 1)}%</small>` : ''}
                </td>
                <td class="center">${Refad.format.number(quantity)}</td>
                <td class="left">${Refad.format.money(price)}</td>
                <td class="left">${Refad.format.money(total)}</td>
              </tr>
            `;
          }

          // A4 / A5 format
          return `
            <tr>
              <td class="center">${i + 1}</td>
              <td>
                <strong>${Refad.escapeHtml(name)}</strong>
                ${unit ? `<small style="color:#64748b;"> (${Refad.escapeHtml(unit)})</small>` : ''}
              </td>
              <td class="center">${Refad.format.number(quantity)}</td>
              <td class="left">${Refad.format.money(price)}</td>
              <td class="center">${discount ? `${Refad.format.number(discount, 1)}%` : '—'}</td>
              <td class="left">${discount ? Refad.format.money(discountAmount) : '—'}</td>
              <td class="left"><strong>${Refad.format.money(total)}</strong></td>
            </tr>
          `;
        }).join('');

        const itemsTableHtml = `
          <table class="invoice-items">
            <thead>
              <tr>
                ${isReceipt
                  ? '<th style="width:8%;">#</th><th>الصنف</th><th style="width:12%;">كمية</th><th style="width:20%;">سعر</th><th style="width:22%;">إجمالي</th>'
                  : '<th style="width:5%;">#</th><th style="width:35%;">الصنف</th><th style="width:10%;">الكمية</th><th style="width:12%;">السعر</th><th style="width:10%;">خصم %</th><th style="width:13%;">قيمة الخصم</th><th style="width:15%;">الإجمالي</th>'}
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        `;

        // 4. Totals
        const totalsHtml = `
          <div class="invoice-totals">
            <div class="totals-row">
              <span>المجموع قبل الخصم:</span>
              <strong>${Refad.format.money(subtotal)}</strong>
            </div>
            ${discountTotal ? `
              <div class="totals-row discount">
                <span>إجمالي الخصم:</span>
                <strong>-${Refad.format.money(discountTotal)}</strong>
              </div>
            ` : ''}
            <div class="totals-row grand-total">
              <span>الإجمالي النهائي:</span>
              <strong>${Refad.format.money(total)}</strong>
            </div>
            ${paidAmount != null ? `
              <div class="totals-row">
                <span>المدفوع:</span>
                <strong>${Refad.format.money(paidAmount)}</strong>
              </div>
              ${remaining > 0 ? `
                <div class="totals-row remaining">
                  <span>المتبقي:</span>
                  <strong>${Refad.format.money(remaining)}</strong>
                </div>
              ` : ''}
              ${change > 0 ? `
                <div class="totals-row change">
                  <span>الباقي:</span>
                  <strong>${Refad.format.money(change)}</strong>
                </div>
              ` : ''}
            ` : ''}
          </div>
        `;

        // 5. Amount in Arabic
        const amountInWords = !isReceipt ? `
          <div class="amount-words">
            <strong>المبلغ كتابةً:</strong> ${NumberToArabic.format(total, invoiceSettings.currency || 'جنيه')}
          </div>
        ` : '';

        // 6. Notes
        const notesHtml = notes ? `
          <div class="invoice-notes">
            <strong>ملاحظات:</strong> ${Refad.escapeHtml(notes)}
          </div>
        ` : '';

        // 7. Terms
        const termsHtml = terms && !isReceipt ? `
          <div class="invoice-terms">
            <strong>الشروط:</strong> ${Refad.escapeHtml(terms)}
          </div>
        ` : '';

        // 8. Signatures
        const signaturesHtml = !isReceipt ? `
          <div class="invoice-signatures">
            <div class="signature-item">
              <div>_______________________</div>
              <div>المستلم</div>
            </div>
            <div class="signature-item">
              <div>_______________________</div>
              <div>التوقيع والختم</div>
            </div>
          </div>
        ` : '';

        // 9. Footer
        const footerHtml = `
          <div class="invoice-footer">
            ${Refad.escapeHtml(footer || `شكراً لتعاملكم معنا • ${company.name || ''}`)}
          </div>
        `;

        // 10. Copy Label (للنسخ المتعددة)
        const copyLabelHtml = copyLabel ? `
          <div class="copy-label">${Refad.escapeHtml(copyLabel)}</div>
        ` : '';

        return `
          <div class="invoice-copy ${isReceipt ? 'receipt-copy' : ''}">
            ${copyLabelHtml}
            ${headerHtml}
            ${metaHtml}
            ${itemsTableHtml}
            ${totalsHtml}
            ${amountInWords}
            ${notesHtml}
            ${termsHtml}
            ${signaturesHtml}
            ${footerHtml}
          </div>
        `;
      };

      // ============================================================
      // بناء النسخ المتعددة
      // ============================================================
      const copyLabels = ['نسخة العميل', 'نسخة المحل', 'نسخة الأرشيف'];
      const copiesHtml = [];
      for (let i = 0; i < copies; i++) {
        copiesHtml.push(buildSingleCopy(copies > 1 ? copyLabels[i] : ''));
      }

      // ============================================================
      // Styles
      // ============================================================
      const isReceipt = pageSize === '80mm';
      const isA5 = pageSize === 'A5';

      const invoiceStyles = `
        /* ===== إعدادات الطباعة ===== */
        ${isReceipt
          ? `@page { size: 80mm auto; margin: 0; }
             body { width: 76mm; padding: 2mm; font-family: 'Cairo', sans-serif; font-size: 10px; }
             .invoice-copy { padding: 3mm 2mm; page-break-after: always; }`
          : isA5
            ? `@page { size: A5 ${opts.orientation || 'portrait'}; margin: 5mm; }
               body { padding: 0; font-size: 11px; }
               .invoice-copy { padding: 3mm 4mm; border: 2px dashed #cbd5e1; border-radius: 8px; margin-bottom: 4mm; page-break-inside: avoid; }
               .copy-label { background: #0B2C4D; color: white; padding: 2px 10px; border-radius: 12px; font-size: 10px; font-weight: 700; display: inline-block; margin-bottom: 6px; }`
            : `@page { size: A4 ${opts.orientation || 'portrait'}; margin: 8mm; }
               body { padding: 0; font-size: 12px; }
               .invoice-copy { padding: 4mm 5mm; border: 2px dashed #cbd5e1; border-radius: 10px; margin-bottom: 5mm; page-break-inside: avoid; }
               .copy-label { background: #0B2C4D; color: white; padding: 3px 12px; border-radius: 14px; font-size: 11px; font-weight: 700; display: inline-block; margin-bottom: 8px; }`
        }

        /* ===== نسخة الفاتورة ===== */
        .invoice-copy { background: white; }

        /* ===== Header ===== */
        .invoice-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #0B2C4D;
          padding-bottom: 8px;
          margin-bottom: 10px;
          gap: 10px;
          flex-wrap: wrap;
        }

        .header-right { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .header-right img { width: ${isReceipt ? '40px' : '60px'}; height: ${isReceipt ? '40px' : '60px'}; object-fit: contain; }

        .company-info h1 { font-size: ${isReceipt ? '13px' : '17px'}; font-weight: 800; color: #0B2C4D; margin-bottom: 2px; }
        .company-info div { font-size: ${isReceipt ? '9px' : '10px'}; color: #64748b; line-height: 1.5; }

        .header-left { text-align: left; flex-shrink: 0; }
        .invoice-title { font-size: ${isReceipt ? '12px' : '15px'}; font-weight: 800; color: #14B8A6; margin-bottom: 3px; }
        .invoice-number { font-family: 'Courier New', monospace; font-size: ${isReceipt ? '11px' : '12px'}; font-weight: 800; color: #0B2C4D; margin-bottom: 4px; }
        .barcode-wrap { display: inline-block; }

        /* ===== Meta Info ===== */
        .invoice-meta {
          background: #F1F5F9;
          border-radius: 6px;
          padding: ${isReceipt ? '4px 6px' : '8px 10px'};
          margin-bottom: 10px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(${isReceipt ? '110px' : '150px'}, 1fr));
          gap: ${isReceipt ? '2px 8px' : '4px 12px'};
          font-size: ${isReceipt ? '9px' : '11px'};
        }

        .meta-item { display: flex; gap: 4px; }
        .meta-label { color: #64748b; font-weight: 600; }
        .meta-value { color: #0B2C4D; font-weight: 700; }

        /* ===== Items Table ===== */
        .invoice-items {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 10px;
          font-size: ${isReceipt ? '9px' : '11px'};
        }

        .invoice-items th {
          background: #0B2C4D;
          color: white;
          padding: ${isReceipt ? '3px 4px' : '6px 8px'};
          text-align: right;
          font-weight: 700;
          font-size: ${isReceipt ? '9px' : '10px'};
          border: 1px solid #0B2C4D;
        }

        .invoice-items td {
          padding: ${isReceipt ? '3px 4px' : '5px 8px'};
          border: 1px solid #cbd5e1;
          vertical-align: middle;
        }

        .invoice-items tbody tr:nth-child(even) { background: #f8fafc; }

        .invoice-items .center { text-align: center; }
        .invoice-items .left { text-align: left; font-family: 'Courier New', monospace; }

        /* ===== Totals ===== */
        .invoice-totals {
          margin-right: auto;
          margin-left: 0;
          width: ${isReceipt ? '100%' : '55%'};
          min-width: ${isReceipt ? 'auto' : '260px'};
          border: 2px solid #0B2C4D;
          border-radius: 6px;
          padding: ${isReceipt ? '6px 8px' : '10px 14px'};
          background: #f8fafc;
        }

        .totals-row {
          display: flex;
          justify-content: space-between;
          padding: ${isReceipt ? '2px 0' : '4px 0'};
          font-size: ${isReceipt ? '10px' : '12px'};
        }

        .totals-row.discount strong { color: #F59E0B; }
        .totals-row.remaining strong { color: #ef4444; }
        .totals-row.change strong { color: #10b981; }

        .totals-row.grand-total {
          border-top: 2px solid #0B2C4D;
          margin-top: 6px;
          padding-top: 6px;
          font-size: ${isReceipt ? '12px' : '15px'};
        }

        .totals-row.grand-total strong { color: #14B8A6; font-size: ${isReceipt ? '14px' : '18px'}; }

        /* ===== Amount in Words ===== */
        .amount-words {
          margin-top: 8px;
          padding: 6px 10px;
          background: #fef3c7;
          border-right: 4px solid #F59E0B;
          border-radius: 4px;
          font-size: 11px;
          color: #78350f;
        }

        /* ===== Notes ===== */
        .invoice-notes, .invoice-terms {
          margin-top: 10px;
          padding: ${isReceipt ? '4px 6px' : '8px 10px'};
          background: #f8fafc;
          border-radius: 4px;
          font-size: ${isReceipt ? '9px' : '11px'};
          color: #475569;
        }

        .invoice-terms { font-size: ${isReceipt ? '8px' : '10px'}; }

        /* ===== Signatures ===== */
        .invoice-signatures {
          margin-top: 20px;
          display: flex;
          justify-content: space-around;
          font-size: 11px;
          color: #64748b;
        }

        .signature-item { text-align: center; }
        .signature-item div:first-child { margin-bottom: 4px; }

        /* ===== Footer ===== */
        .invoice-footer {
          margin-top: 15px;
          padding-top: 8px;
          border-top: 1px dashed #cbd5e1;
          text-align: center;
          font-size: ${isReceipt ? '9px' : '11px'};
          color: #94a3b8;
        }

        /* ===== Copy Label ===== */
        .copy-label {
          background: linear-gradient(135deg, #0B2C4D, #14B8A6);
          color: white;
          padding: 3px 12px;
          border-radius: 14px;
          font-size: 11px;
          font-weight: 700;
          display: inline-block;
          margin-bottom: 8px;
        }

        /* ===== Print ===== */
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .invoice-copy { page-break-inside: avoid; }
          .invoice-copy:not(:last-child) { page-break-after: always; }
        }

        ${isReceipt ? `
          .invoice-signatures, .amount-words, .invoice-terms { display: none; }
          .invoice-totals { width: 100%; }
        ` : ''}
      `;

      // ============================================================
      // إنشاء النافذة
      // ============================================================
      Print.html(
        `<div class="invoices-container">${copiesHtml.join('')}</div>`,
        {
          title: 'فاتورة ' + (invoiceNum || ''),
          orientation: opts.orientation || 'portrait',
          pageSize,
          windowRef: opts.windowRef,
          styles: invoiceStyles
        }
      );
    }
  };

  global.Refad.Print = Print;
  console.log('%c[Refad] Print v' + Print.version + ' loaded', 'color:#F59E0B;font-weight:bold');

})(typeof window !== 'undefined' ? window : this);