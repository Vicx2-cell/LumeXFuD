# Frontend UI Overhaul — Progress

Branch: `feat/study-mvp` (current). Visual layer only. No logic/props/data changes.

## PHASE 0 — Audit (COMPLETE, awaiting go-ahead)

### Key correction to the brief
- There is **no `Hero.tsx`**. A mature design system already lives in
  [app/globals.css](app/globals.css) — `.lx-page`, `.glass`/`.glass-thin`/`.glass-thick`,
  `.lx-btn-amber`, `.lx-stagger`, `.lx-enter`, `.lx-skeleton`, motion presets, focus rings.
  So Phase 1 is **extract + consolidate**, not build-from-scratch.
- **Mobile fake-glass is ALREADY done**: `html:not(.lx-rich) *` strips `backdrop-filter`
  on phones; desktop gets real blur via `.lx-rich`. The perf rule the brief asks for exists.
- **No web font** is loaded — body uses the system stack. This is the single biggest
  "looks like millions" lever still untouched. Needs a decision (see questions).

### Tech context
- Next 16.2.6, React 19, Tailwind v4, all pages `force-dynamic`. PWA w/ versioned SW.
- Heavy deps: `leaflet` (admin live map, lodge map) — already client/lazy surfaces.

### The real problem: inline-style duplication
The `lx-*` CSS foundation is good, but component-level styling bypasses it. Same color
math is repeated 40-50× across ~15 files instead of living in one class. Top 3 offenders:
1. Amber accent card — `{ background:'rgba(245,166,35,0.1)', border:'1px solid rgba(245,166,35,0.2)' }` (50+×)
2. Conditional pill/button state — `{ background: active?'#F5A623':'rgba(255,255,255,0.06)', color: active?'#000':... }` (40+×)
3. Translucent input/container bg — `{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)' }` (30+×)

### Per-surface notes
- **Public home** ([app/page.tsx](app/page.tsx)) — already polished; only inline-amber repetition.
- **Vendor dashboard** ([app/vendor-dashboard/page.tsx](app/vendor-dashboard/page.tsx)) — PRIORITY.
  Header pills repeat the amber-chip inline style 3×, wrap awkwardly on small phones; everything
  capped at `max-w-lg` so desktop is a narrow column (no grid); status/button colors all inline.
- **Customer** (home/cart/vendor-menu/order-status/orders/profile/leaderboard) — heavy inline
  state styling; sticky headers repeat `rgba(10,10,11,0.9)+blur` verbatim; `Stars` hardcodes
  `#F5A623` in 5 places; no shared status-badge / scrim / sheet primitives.
- **Rider** — order-state cards inline; trust-tier colors inline; toast styled inline.
- **Admin** — MetricCard is good; icon-badge amber repeats 6+×; status filter pills inline;
  dispute/alert panels repeat red-accent inline.
- **Super-admin** — Toggle + StatCard well-encapsulated (reuse model); danger dialog + button
  groups still inline.

## PHASE 1 — Design system lock (COMPLETE, additive only — no surface touched)

Decisions: Bricolage Grotesque headings (self-hosted), responsive vendor dashboard.

Files added/changed:
- `app/fonts/bricolage-grotesque.woff2` — self-hosted latin variable woff2 (41KB).
- [app/layout.tsx](app/layout.tsx) — `next/font/local` → `--font-display` on `<html>`
  (swap, preload, system fallback; no runtime CDN request).
- [app/globals.css](app/globals.css) — added: `--font-display`, status vars
  (`--lx-green/blue/violet/red`); `h1-h4/.lx-display` use the display face; utilities
  `.lx-card-amber(-soft/-strong)`, `.lx-icon-badge`, `.lx-field`, `.lx-pill[data-active]`,
  `.lx-badge`. Colour/border only (no radius) so they compose with Tailwind rounding.
- [components/ui/badge.tsx](components/ui/badge.tsx) — `<Badge color>` tinted status chip.
- [components/ui/pill.tsx](components/ui/pill.tsx) — `<Pill active variant>` toggle button.
- [components/ui/info-card.tsx](components/ui/info-card.tsx) — `<InfoCard tone icon>` panel.

Verify: `next build` → `✓ Compiled successfully` + TypeScript clean. Build's final
page-data step fails ONLY on pre-existing missing env `SENDCHAMP_API_KEY` (no `.env.local`
key) via `validateEnv()` — unrelated to these changes.

## PHASE 2 — Surfaces
- [x] 1. Public home — display font on wordmarks/stats, amber utilities, live pulse badge. (commit c750e14)
- [x] 2. Vendor dashboard (priority) — responsive desktop grid (orders main / controls sidebar),
      header pills + status badge via primitives, lx-btn-amber actions, token colors. tsc clean.
- [x] 3. Customer — home (lx-page ambient + lx-topbar), vendor menu, cart, order-status,
      orders, leaderboard-client, profile-client (5 hand-rolled glass cards → glass-thin).
      Badge/Pill/lx-field/lx-card-amber/lx-icon-badge/lx-amber adopted. chow-ai left intact
      (already on-brand). New utility: .lx-topbar, .lx-amber. tsc clean.
- [x] 4. Rider — dashboard (active-order card, wallet/reviews links, picked-up action,
      empty-state icon → utilities), wallet page (flat bg → lx-page + lx-topbar), reviews
      avg → lx-amber. Semantic green status actions + online toggle left. tsc clean.
      (Shared components/wallet/WalletView left for now — used by customer + rider.)
- [x] 5. Admin — dashboard, orders, disputes, accounts (done in-session) + vendors, riders,
      wallets, audit, reviews, kyc, lodges, verify-receipt, new vendor/rider, live-client
      (fan-out agents): lx-page/glass-thin/lx-field/lx-btn-amber/Badge/Pill/lx-amber/lx-skeleton.
      admin/live Leaflet+realtime untouched. tsc clean.
- [x] 6. Super-admin — page, controls, financials, settings, features, pricing, announce,
      team/new, cron, security, usage, audit, sentinel(+client), launch-counter (fan-out
      agents): same utilities; encapsulated Toggle/StatCard left intact. tsc clean.

## Verification
- `tsc --noEmit` → exit 0 across the whole tree after every surface.
- Semantic red/green/blue (destructive/success/info/toggles), SVG fills, Leaflet colors,
  dynamic color lookups, and the Lumi (chow-ai) gradient component intentionally preserved.
- One shared token source (globals.css :root + utilities); no new npm deps; PWA SW untouched.

## Follow-up
- [x] Shared `components/wallet/WalletView.tsx` (customer + rider wallet) — 5 Tailwind glass
      cards → glass-thin, 4 amber filled buttons → lx-btn-amber, amber texts → lx-amber,
      PIN-prompt card → lx-card-amber-soft, download-receipt → lx-card-amber, skeleton →
      lx-skeleton, progress bar → var(--color-amber). Left: ghost buttons, modal solid bg
      (contrast), PIN-dot indicators, "YOU"/tier conditional chips, semantic green/red.
      Role-agnostic (no VENDOR/RIDER-specific change). tsc + next build green.
