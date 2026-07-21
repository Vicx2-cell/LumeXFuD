# Initial asset inventory

`public/` contains 34 files totalling 7,417,453 bytes.

| Class | Evidence | Notes |
|---|---|---|
| PWA | `public/manifest.json`, `public/sw.js`, `public/icons/*`, `public/apple-touch-icon.png` | Manifest has 192/512 any and maskable icons; screenshots array is empty (`manifest.json:12-38`). |
| Landing imagery | `public/hero.jpg` (324,905 B), `hero-mobile.jpg` (206,948 B) | Local static assets. |
| Premium imagery | six JPEGs under `public/premium/`, about 1.88 MB | Review responsive usage and transfer budgets later. |
| Tutorial evidence | eight PNGs under `public/tutorial-screens/`, about 5.0 MB | Largest files are vendor/cart screenshots (1.16-1.45 MB each); deployment exclusion is not configured for this directory. |
| Icons/SVG | framework/brand SVGs plus five PWA PNG icons | Push code references `/icons/icon-192.png`, but inventory contains only `icon-192-v2.png` (`public/sw.js:121-126`), a suspected broken notification icon to verify. |
| Verification text/XML | Bing and TikTok verification files | Public by design; ownership/current necessity requires human confirmation. |
| Root artifacts outside public | `_live-apple.png`, `tiktok-demo-lumex-fud.mp4`, `site.tar`, `site.zip` | Archives are excluded by `.vercelignore:6-7`; repository retention/secret-content review remains pending. |

Remote user/media assets are served from Supabase Storage (`next.config.ts:20-23`). Storage bucket policy and inventory require migration/deployed-project verification.
