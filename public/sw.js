const CACHE_NAME = 'lumexfud-v3';
const OFFLINE_URL = '/offline';

// Assets to pre-cache on install
const PRECACHE = [
  '/',
  '/offline',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API calls, Supabase, or Paystack
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase') ||
    url.hostname.includes('paystack') ||
    url.hostname.includes('termii')
  ) {
    return;
  }

  // For navigation requests: network-first; cache successful pages so a
  // previously-visited page (homepage, /orders, a vendor page) still loads
  // offline. Fall back to the cached copy, then the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Safari/WebKit (iOS) throws "page couldn't load" when a service worker
          // hands a REDIRECTED response back for a navigation. Our auth proxy
          // 307-redirects "/" -> "/vendor-dashboard" | "/rider" for logged-in
          // users, and the PWA launches at "/", so this fired on every launch and
          // broke the dashboards. Rebuild a clean, non-redirected response from
          // the final body so WebKit will render it.
          const safe = response.redirected
            ? new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              })
            : response;
          if (response.ok) {
            const clone = safe.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return safe;
        })
        .catch(() =>
          caches.match(request).then((cached) =>
            cached ??
            caches.match(OFFLINE_URL).then((r) => r ?? new Response('Offline', { status: 503 }))
          )
        )
    );
    return;
  }

  // For static assets: cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }
});
