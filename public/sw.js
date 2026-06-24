// Bump on every release that must reach already-installed PWAs: a changed sw.js
// triggers install→activate (purging old caches) and a controllerchange reload
// in components/pwa.tsx, so clients pick up the new app instead of stale assets.
const CACHE_NAME = 'lumexfud-v17';

// Pre-cache only assets that are SAME for everyone and never redirect.
// IMPORTANT: do NOT precache "/" — for a logged-in user the auth proxy
// 307-redirects "/", and Cache.addAll() rejects on a redirected response, which
// made the whole SW install fail (so a fixed SW could never take over).
// NOTE: manifest.json is intentionally NOT precached — it's served network-first
// below so a new logo/icon set reaches the device on the next online load.
const PRECACHE = [
  '/offline',
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

  // Brand / app-shell assets (icons, manifest, loose images): NETWORK-FIRST.
  // Cache-first here is what kept serving the OLD black launcher icon after a
  // rebrand — the SW shadowed the freshly deployed PNGs. Now we always try the
  // network (so a new logo reaches the device immediately) and only fall back
  // to cache when offline.
  if (
    url.pathname === '/manifest.json' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Content-hashed build assets: cache-first (immutable, filename changes on
  // every build — safe to serve from cache and never goes stale).
  if (url.pathname.startsWith('/_next/static/')) {
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

// ── Web Push ─────────────────────────────────────────────────────────────────
// Real push so vendors/riders get the new-order alert even when the tab/PWA is
// closed. Payload is JSON: { title, body, url, tag } (see lib/push.ts).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'LumeX Fud', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'LumeX Fud';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // tag collapses repeats (e.g. many status pings for one order) into one chip.
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a push focuses an existing tab (navigating it) or opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
