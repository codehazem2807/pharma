/* ============================================================
   Refad ERP - Service Worker
   Version: 1.0.7
   Strategy: Cache-first for static, Network-first for API
   ============================================================ */

const CACHE_VERSION = 'refad-v1.0.7';
const STATIC_CACHE = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// الملفات الأساسية للكاش
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/accounts.html',
  '/returns.html',
  '/refad-camera-scanner.js',
  '/refad-print.js',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

// ============================================================
// Install
// ============================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Precache failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ============================================================
// Activate
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k.startsWith('refad-') && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================
// Fetch
// ============================================================
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // تجاهل الطلبات غير GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ===== 1) Supabase API → Network-only (مع fallback للكاش للقراءات) =====
  if (url.hostname.includes('supabase.co')) {
    // للطلبات من نوع REST GET، جرب Network أولاً مع fallback
    if (url.pathname.includes('/rest/v1/')) {
      event.respondWith(networkFirstWithCache(req, RUNTIME_CACHE));
      return;
    }
    // لغير REST (Storage, Auth) → Network-only
    return;
  }

  // ===== 2) CDN Libraries → Cache-first =====
  if (
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // ===== 3) ملفات التطبيق → Cache-first مع تحديث خلفي =====
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // ===== 4) الباقي → Network =====
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

// ============================================================
// Strategies
// ============================================================
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    return new Response('offline', { status: 503 });
  }
}

async function networkFirstWithCache(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline', message: 'لا يوجد اتصال بالإنترنت' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req).then((res) => {
    if (res && res.status === 200) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => cached || new Response('offline', { status: 503 }));

  return cached || fetchPromise;
}

// ============================================================
// Messages
// ============================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) => Promise.all(keys.map(k => caches.delete(k))));
  }
});

// ============================================================
// Push Notifications (اختياري)
// ============================================================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: 'رفاد', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'رفاد', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

console.log('[Refad SW] Service Worker loaded — v1.0.0');