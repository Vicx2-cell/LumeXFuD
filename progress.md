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

## PHASE 2 — Surfaces (planned)
- [ ] 1. Public home
- [ ] 2. Vendor dashboard (priority)
- [ ] 3. Customer
- [ ] 4. Rider
- [ ] 5. Admin
- [ ] 6. Super-admin
