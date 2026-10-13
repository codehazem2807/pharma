/**
 * Refad Camera Scanner v2
 * - Web Audio API sounds (success / duplicate / blocked / unknown)
 * - Auto-pause 500ms after successful scan
 * - Torch/flash support
 * - Multi-format barcode support
 * - Auto re-enable after pause
 */
(function (window) {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════
  let activeScanner = null;
  let scanLocked = false;
  let lastCode = '';
  let lastScanAt = 0;
  let pauseUntil = 0;              // ⏸️ auto-pause after success
  let torchOn = false;
  let torchSupported = false;
  let soundEnabled = true;
  let currentTrack = null;

  const SOUND_COOLDOWN = 200;      // بين أصوات متتالية
  const DEDUPE_WINDOW = 1500;      // نفس الباركود خلال 1.5 ث
  const PAUSE_AFTER_SCAN = 500;    // ⏸️ إيقاف 500ms بعد كل مسح
  let lastSoundAt = 0;

  // ═══════════════════════════════════════════════════════════
  // Sound Engine (Web Audio API)
  // ═══════════════════════════════════════════════════════════
  const Sound = {
    ctx: null,

    init() {
      if (!this.ctx) {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) this.ctx = new AudioCtx();
        } catch (e) {
          console.warn('[Refad.Scanner] AudioContext unavailable:', e);
        }
      }
      return this.ctx;
    },

    beep(frequency, duration, type, volume) {
      if (!soundEnabled) return;
      type = type || 'sine';
      volume = volume || 0.15;

      const now = Date.now();
      if (now - lastSoundAt < SOUND_COOLDOWN) return;
      lastSoundAt = now;

      const ctx = this.init();
      if (!ctx) return;

      try {
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = frequency;
        gain.gain.value = volume;
        osc.connect(gain);
        gain.connect(ctx.destination);

        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(volume, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.start(t);
        osc.stop(t + duration);
      } catch (e) {
        // silent
      }
    },

    // ✅ نجاح — نغمة صاعدة سريعة
    success() {
      this.beep(880, 0.08);
      setTimeout(() => this.beep(1174, 0.12), 80);
    },

    // 🔁 مكرر — نغمة مزدوجة سريعة
    duplicate() {
      this.beep(1000, 0.05, 'square', 0.10);
      setTimeout(() => this.beep(1000, 0.05, 'square', 0.10), 70);
    },

    // 🚫 محظور — نغمة منخفضة طويلة
    blocked() {
      this.beep(220, 0.30, 'sawtooth', 0.20);
      setTimeout(() => this.beep(180, 0.40, 'sawtooth', 0.20), 300);
    },

    // ❓ غير معروف — نغمة تحذير هابطة
    unknown() {
      this.beep(500, 0.12, 'triangle', 0.18);
      setTimeout(() => this.beep(350, 0.18, 'triangle', 0.18), 120);
    },

    // 🎁 بونص — نغمة ثلاثية صاعدة
    bonus() {
      this.beep(1200, 0.06);
      setTimeout(() => this.beep(1500, 0.08), 60);
      setTimeout(() => this.beep(1800, 0.10), 130);
    },

    // ✅ اكتمل — نغمة موسيقية جميلة
    matched() {
      this.beep(659, 0.08);
      setTimeout(() => this.beep(784, 0.08), 70);
      setTimeout(() => this.beep(1047, 0.15), 140);
    },

    // ⏸️ pause — صوت خفيف
    pause() {
      this.beep(600, 0.03, 'sine', 0.08);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // Barcode formats
  // ═══════════════════════════════════════════════════════════
  function supportedFormats() {
    const supported = window.Html5QrcodeSupportedFormats;
    if (!supported) return undefined;
    return [
      'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E',
      'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR',
      'DATA_MATRIX', 'QR_CODE', 'PDF_417'
    ].map(name => supported[name]).filter(value => value !== undefined);
  }

  // ═══════════════════════════════════════════════════════════
  // Stop scanner
  // ═══════════════════════════════════════════════════════════
  async function stop() {
    const scanner = activeScanner;
    activeScanner = null;
    scanLocked = false;
    torchOn = false;
    torchSupported = false;
    currentTrack = null;

    if (!scanner) return;
    try {
      if (scanner.getState() === 2) await scanner.stop();
    } catch (e) {
      // silent
    } finally {
      try { await scanner.clear(); } catch (e) {}
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Torch control
  // ═══════════════════════════════════════════════════════════
  async function setTorch(on) {
    if (!currentTrack) return false;
    try {
      const capabilities = currentTrack.getCapabilities
        ? currentTrack.getCapabilities()
        : {};
      if (!capabilities.torch) return false;
      await currentTrack.applyConstraints({
        advanced: [{ torch: !!on }]
      });
      torchOn = !!on;
      return true;
    } catch (e) {
      return false;
    }
  }

  async function toggleTorch() {
    if (!torchSupported) return false;
    return await setTorch(!torchOn);
  }

  function isTorchOn() { return torchOn; }
  function isTorchSupported() { return torchSupported; }

  // ═══════════════════════════════════════════════════════════
  // Start scanner
  // ═══════════════════════════════════════════════════════════
  async function start(elementId, onScan) {
    if (typeof window.Html5Qrcode === 'undefined') {
      throw new Error('مكتبة قراءة الباركود غير محمّلة');
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('مسح الكاميرا يحتاج HTTPS أو localhost');
    }
    if (typeof onScan !== 'function') {
      throw new Error('معالج الباركود غير صالح');
    }
    const element = document.getElementById(elementId);
    if (!element) throw new Error('تعذّر العثور على مساحة عرض الكاميرا');

    await stop();
    lastCode = '';
    lastScanAt = 0;
    pauseUntil = 0;

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
        async decodedText => {
          const code = String(decodedText || '').trim();
          const now = Date.now();

          // ⏸️ في فترة توقف؟ تجاهل
          if (now < pauseUntil) return;
          if (activeScanner !== scanner || !code) return;
          if (scanLocked) return;
          if (code === lastCode && now - lastScanAt < DEDUPE_WINDOW) return;

          scanLocked = true;
          lastCode = code;
          lastScanAt = now;

          let result = 'success';

          try {
            const callbackResult = await Promise.resolve(onScan(code));
            // callback ممكن يرجع string أو object
            if (typeof callbackResult === 'string') {
              result = callbackResult;
            } else if (callbackResult && typeof callbackResult === 'object') {
              result = callbackResult.type || callbackResult.result || 'success';
            }
          } catch (error) {
            console.error('[Refad.Scanner] Handler failed:', error);
            window.Refad?.toast?.error('تعذّر معالجة الباركود');
            result = 'unknown';
          } finally {
            scanLocked = false;
          }

          // 🔊 شغل الصوت المناسب
          playResultSound(result);

          // ⏸️ إيقاف قصير بعد المسح
          pauseUntil = Date.now() + PAUSE_AFTER_SCAN;
          // إعادة تفعيل تلقائي (بدون عمل حاجة — الفلتر بس بيتحسب في المرة الجاية)
        },
        () => {}
      );

      // ═══════════════════════════════════════════════════════
      // Torch detection
      // ═══════════════════════════════════════════════════════
      try {
        // الوصول للـ video element
        const videoEl = element.querySelector('video');
        if (videoEl && videoEl.srcObject) {
          const tracks = videoEl.srcObject.getVideoTracks();
          if (tracks && tracks.length) {
            currentTrack = tracks[0];
            const caps = currentTrack.getCapabilities ? currentTrack.getCapabilities() : {};
            torchSupported = !!caps.torch;
          }
        }
      } catch (e) {
        torchSupported = false;
      }

    } catch (error) {
      try { await stop(); } catch (cleanupError) {}
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Play sound based on result
  // ═══════════════════════════════════════════════════════════
  function playResultSound(result) {
    switch (result) {
      case 'duplicate':  Sound.duplicate(); break;
      case 'blocked':    Sound.blocked(); break;
      case 'unknown':    Sound.unknown(); break;
      case 'bonus':      Sound.bonus(); break;
      case 'matched':    Sound.matched(); break;
      case 'paused':     Sound.pause(); break;
      case 'success':
      default:           Sound.success(); break;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════
  window.RefadCameraScanner = {
    start,
    stop,
    toggleTorch,
    setTorch,
    isTorchOn,
    isTorchSupported,

    // Sound control
    setSoundEnabled(enabled) { soundEnabled = !!enabled; },
    isSoundEnabled() { return soundEnabled; },

    // Direct sound access (للصفحات)
    playSound(type) { playResultSound(type); },

    // Constants
    PAUSE_AFTER_SCAN,
    DEDUPE_WINDOW
  };

})(window);