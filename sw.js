// Kids Coin Quest — service worker
// Bump CACHE_VERSION whenever index.html ships a change you want users to see
// immediately after reload. Old caches are purged on activate.
const CACHE_VERSION = 'kcq-v9';

// `index.html` and `/` always need a fresh check so users pick up
// new app code immediately. Everything else (assets, scripts, fonts)
// is served stale-while-revalidate: instant from cache, refreshed in
// the background. This eliminates the prior network-first behaviour
// where every same-origin request roundtripped to the network even
// when a cached copy existed — that was the root cause of the
// "every asset fetched 3-4× per page load" performance bug.
const HTML_PATHS = ['./', './index.html'];

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
  // Pre-warm the cache so the first offline visit doesn't show a blank
  // screen. We only fetch each asset once — the cache.addAll path is
  // separate from the fetch event handler below.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Audio is now served by jsDelivr (cross-origin, falls into the
  // origin-skip clause above). Old kcq-v5/v6 caches may still hold
  // local mp3s; the activate handler purges them on upgrade.

  // HTML/document paths: network-first so a deploy is visible on the
  // next reload. Cache fallback covers offline.
  const isHtml = HTML_PATHS.some(p => url.pathname === p || url.pathname.endsWith('/index.html'));
  if (isHtml) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Narration manifest: ALSO network-first. The manifest is the (hash →
  // mp3) lookup table; if it's stale, freshly generated audio is
  // invisible to the runtime. We keep a cache fallback so offline keeps
  // working — but a live network always wins. (Was the v1 bug: stale
  // manifest at the edge made new mp3s unreachable for days.)
  if (url.pathname.endsWith('/audio/manifest.json')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Everything else: stale-while-revalidate. Serve cache immediately,
  // refresh in background. This reduces double-fetches from 2× to 1×
  // (cache hit) for warm reloads, and keeps offline working.
  event.respondWith(staleWhileRevalidate(req));
});

function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')));
}

function staleWhileRevalidate(req) {
  return caches.match(req).then((cached) => {
    const networkFetch = fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => cached);    // offline → keep serving stale
    // If we have a cached copy, return it instantly. The networkFetch
    // promise updates the cache for the next request.
    return cached || networkFetch;
  });
}
