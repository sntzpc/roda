// sw.js — cache versi tanpa querystring
const CACHE_VERSION = 'v2025.10.12-01';        // << ganti saat rilis baru
const STATIC_CACHE  = `static-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',                    // biar bisa offline landing
  '/assets/app.css',
  // daftar JS inti (pakai entry main.js seperti saran sebelumnya)
  '/js/main.js',
  '/js/debug.js','/js/util.js','/js/notif.js','/js/store.js','/js/api.js',
  '/js/ui.js','/js/auth.js','/js/register.js','/js/order.js','/js/vehicles.js',
  '/js/approvals.js','/js/driver.js','/js/cashier.js','/js/journal.js',
  '/js/settings.js','/js/myorder.js','/js/dashboard.js'
];

// Origin GAS (jangan di-cache sama SW)
const GAS_ORIGIN = 'https://script.google.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
  // langsung aktifkan SW baru
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('static-') && n !== STATIC_CACHE)
        .map(n => caches.delete(n))
    );
    // langsung klaim kontrol semua tab
    await self.clients.claim();
  })());
});

// Helper: cek tipe file
const isHtml = (url) => url.pathname === '/' || url.pathname.endsWith('.html');
const isStatic = (url) => url.pathname.startsWith('/js/') || url.pathname.startsWith('/assets/');
const isCdn = (url) =>
  url.hostname.includes('cdn.jsdelivr.net') ||
  url.hostname.includes('unpkg.com') ||
  url.hostname.includes('cdnjs.cloudflare.com') ||
  url.hostname.includes('fonts.gstatic.com') ||
  url.hostname.includes('fonts.googleapis.com');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

   // Bypass eksplisit dari client
    if (req.headers.get('X-SW-Bypass') === '1' || req.cache === 'no-store') {
    return; // biarkan langsung ke network (tanpa respondWith = default fetch)
    }

  // 1) Jangan intercept request ke GAS (POST/GET/JSONP) → network only
    if (url.origin === GAS_ORIGIN) return;

  // 2) HTML → network-first (biar update cepat), fallback cache
  if (req.mode === 'navigate' || isHtml(url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req) || await cache.match('/');
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

    // 3) Asset static lokal (/js, /assets) → stale-while-revalidate + cache key tanpa query
    if (isStatic(url)) {
    event.respondWith((async () => {
        // Jika client minta bypass (mis. fetch(..., {cache:'no-store'}) atau header khusus), lepas ke network.
        if (req.headers.get('X-SW-Bypass') === '1' || req.cache === 'no-store') {
        try { return await fetch(req); } catch {
            // fallback ke cache kalau ada
            const cache = await caches.open(STATIC_CACHE);
            const keyUrl = new URL(req.url); keyUrl.search = '';
            const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
            const cached = await cache.match(cacheKey);
            return cached || new Response('', { status: 504 });
        }
        }

        const cache   = await caches.open(STATIC_CACHE);
        // Normalisasi key cache: abaikan querystring agar tidak terpecah karena versi/buster
        const keyUrl  = new URL(req.url); keyUrl.search = '';
        const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });

        const cached = await cache.match(cacheKey);

        // Revalidate di belakang layar
        const fetchPromise = fetch(req).then(resp => {
        // Simpan hanya jika sukses/opaque (font CDN bisa opaque)
        if (resp && (resp.status === 200 || resp.type === 'opaque')) {
            cache.put(cacheKey, resp.clone());
        }
        return resp;
        }).catch(() => null);

        // Tampilkan cache bila ada; kalau tidak, tunggu network; terakhir fallback 504
        return cached || (await fetchPromise) || new Response('', { status: 504 });
    })());
    return;
    }


  // 4) CDN (Bootstrap, Icons, XLSX, jsPDF) → stale-while-revalidate (aman, jarang berubah)
  if (isCdn(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req, { cache: 'no-store' }).then(resp => {
       if (resp && (resp.status === 200 || resp.type === 'opaque')) {
         cache.put(req, resp.clone());
       }
        return resp;
      }).catch(() => null);
      return cached || (await fetchPromise) || new Response('', {status: 504});
    })());
    return;
  }

  // 5) Default → network first (hindari kejutan)
  event.respondWith((async () => {
    try {
      return await fetch(req);
    } catch {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      return cached || new Response('', {status: 504});
    }
  })());
});

// (Opsional) terima pesan untuk trigger update dari app
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'CLEAR_CACHES_NOW') {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
});
