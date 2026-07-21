# PWA audit

Initial status: source-level manifest, icons, registration UI, offline banner/page and service worker exist. Manifest has stable-looking id, start URL/scope, standalone mode, theme/background, shortcuts and any/maskable icons (`public/manifest.json:1-52`); screenshots are empty. Installability was not browser-verified. Navigation is deliberately not intercepted (`public/sw.js:39-47`), so cold offline navigation has no offline fallback. Update safety and the stale push-icon path are open findings.
