(function (window) {
  'use strict';

  let activeScanner = null;
  let scanLocked = false;
  let lastCode = '';
  let lastScanAt = 0;

  function supportedFormats() {
    const supported = window.Html5QrcodeSupportedFormats;
    if (!supported) return undefined;
    return [
      'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E',
      'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR',
      'DATA_MATRIX', 'QR_CODE', 'PDF_417'
    ].map(name => supported[name]).filter(value => value !== undefined);
  }

  async function stop() {
    const scanner = activeScanner;
    activeScanner = null;
    scanLocked = false;
    if (!scanner) return;

    try {
      if (scanner.getState() === 2) await scanner.stop();
    } finally {
      await scanner.clear();
    }
  }

  async function start(elementId, onScan) {
    if (typeof window.Html5Qrcode === 'undefined') {
      throw new Error('مكتبة قراءة الباركود غير محمّلة');
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('مسح الكاميرا يحتاج تشغيل الموقع عبر HTTPS أو localhost؛ استخدم سكانر USB/Bluetooth بدلاً منه.');
    }
    if (typeof onScan !== 'function') {
      throw new Error('معالج الباركود غير صالح');
    }
    const element = document.getElementById(elementId);
    if (!element) throw new Error('تعذّر العثور على مساحة عرض الكاميرا');

    await stop();
    lastCode = '';
    lastScanAt = 0;
    const formats = supportedFormats();
    const scanner = new window.Html5Qrcode(
      elementId,
      formats?.length ? { formatsToSupport: formats } : undefined
    );
    activeScanner = scanner;

    try {
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (width, height) => ({
            width: Math.min(320, Math.floor(width * 0.85)),
            height: Math.min(180, Math.floor(height * 0.5))
          })
        },
        decodedText => {
          const code = String(decodedText || '').trim();
          const now = Date.now();
          if (activeScanner !== scanner || !code || scanLocked || (code === lastCode && now - lastScanAt < 1500)) return;
          scanLocked = true;
          lastCode = code;
          lastScanAt = now;
          Promise.resolve(onScan(code))
            .catch(error => {
              console.error('[Refad.Scanner] Barcode handler failed:', error);
              window.Refad?.toast?.error('تعذّر معالجة الباركود');
            })
            .finally(() => { scanLocked = false; });
        },
        () => {}
      );
    } catch (error) {
      try {
        await stop();
      } catch (cleanupError) {
        console.error('[Refad.Scanner] Camera cleanup failed:', cleanupError);
      }
      throw error;
    }
  }

  window.RefadCameraScanner = { start, stop };
})(window);
