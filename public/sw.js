/* Vanlife Club — service worker (mobile PWA shell) */
const CACHE = 'vanlife-club-v5';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API / auth calls.
  if (url.pathname.startsWith('/api/')) return;

  // App shell / navigations: network first, cache fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/') || caches.match('/index.html'))
    );
    return;
  }

  // Static assets: stale-while-revalidate (never cache HTML as JS/CSS).
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetching = fetch(request)
        .then((response) => {
          const ct = response.headers.get('content-type') || '';
          const path = url.pathname;
          const looksLikeAsset =
            (path.endsWith('.js') && (ct.includes('javascript') || ct.includes('ecmascript'))) ||
            (path.endsWith('.css') && ct.includes('css')) ||
            (!path.endsWith('.js') && !path.endsWith('.css'));
          if (response && response.ok && looksLikeAsset) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetching;
    })
  );
});
