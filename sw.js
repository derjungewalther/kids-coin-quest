// Kids Coin Quest — service worker
// Bump CACHE_VERSION whenever index.html ships a change you want users to see
// immediately after reload. Old caches are purged on activate.
const CACHE_VERSION = 'kcq-v5';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  './config.js',
  './privacy.html',
  './imprint.html',
  './vendor/supabase-js-2.45.4.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for same-origin GETs: always try fresh, fall back to cache offline.
// Cross-origin (Google Fonts, etc.) is left to the browser's default.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Audio files are immutable (content-addressed by hash) — once cached,
  // always serve from cache. That keeps narration instant and avoids
  // re-downloading mp3s the user has already heard.
  if (url.pathname.startsWith('/audio/') && url.pathname.endsWith('.mp3')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async cache => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Only cache successful, basic (same-origin) responses.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
