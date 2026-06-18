// Bump on every release that must reach already-installed PWAs: a changed sw.js
// triggers install→activate (purging old caches) and a controllerchange reload
// in components/pwa.tsx, so clients pick up the new app instead of stale assets.
const CACHE_NAME = 'lumexfud-v9';

// Pre-cache only assets that are SAME for everyone and never redirect.
// IMPORTANT: do NOT precache "/" — for a logged-in user the auth proxy
// 307-redirects "/", and Cache.addAll() rejects on a redirected response, which
// made the whole SW install fail (so a fixed SW could never take over).
const PRECACHE = [
  '/offline',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  // allSettled (not addAll) so one missing/redirecting asset can't abort install.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE.map((u) => cache.add(u)))
    )
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

  // CRITICAL: never intercept NAVIGATIONS. Page loads (incl. the auth proxy's
  // 307 redirects) are handled natively by the browser, exactly like desktop.
  // Intercepting them and returning the (redirected) response is what older iOS
  // WebKit rejects with "page couldn't load" — so we stay out of navigations
  // entirely. This means no branded offline page on a cold navigation; that's an
  // acceptable trade for the dashboards actually loading on iPhone.
  if (request.mode === 'navigate') {
    return;
  }

  // Never intercept API calls or third-party hosts.
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase') ||
    url.hostname.includes('paystack') ||
    url.hostname.includes('sendchamp')
  ) {
    return;
  }

  // Static, content-hashed assets: cache-first (safe — these never redirect).
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
          if (response.ok && !response.redirected) {
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
