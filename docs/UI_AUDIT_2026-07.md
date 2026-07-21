# LumeX Fud UI audit

Date: 2026-07-21

## Product language to preserve

LumeX is a warm, amber-led, near-black food product with restrained glass surfaces, compact mobile-first layouts, rounded interactive controls, and an operational console treatment for vendor, rider, admin, and super-admin work. The existing semantic `--lx-*` tokens, `lx-page`, `lx-console`, shared UI primitives, and role shells are the design system. This polish pass extends those foundations; it does not add another system.

## Review coverage

The audit covers every rendered `page.tsx`, route-level loading/error state, and the substantial client components used by thin route wrappers.

- Customer/public: landing, auth and recovery, home, vendor/menu, cart, checkout/group order, orders/tracking, feed/profile/create, leaderboard, premium, profile/locations/wallet, referrals, study, sponsor, partners, FAQ/contact/legal/offline, and Uturu SEO pages.
- Vendor: overview, orders, menu, store/settings, earnings/finance/analytics, reviews, boosts/marketing/share/videos/support, followers/following, and vendor application.
- Rider: dashboard/live jobs, reviews, wallet, settings, and rider application.
- Admin: overview, accounts, vendors, riders, orders/live operations, disputes, wallets, KYC, lodges/locations/verified places, reviews, audit, receipt verification, and creation flows.
- Super-admin: overview, team, financials/pricing/premium/rewards, controls/features/settings, security/sentinel/audit/consent, cron/usage, announcements/launch counter, WhatsApp, and official feed/story/report operations.

## Prioritized findings

### P0 — system-wide consistency and accessibility

- Customer light mode is only partially respected by shared navigation, page-header text, loading routes, and a few fixed-color utility surfaces. This can create unreadable or visually disconnected transitions.
- Several custom dialogs/sheets do not establish initial keyboard focus. Some icon-only dismiss controls are smaller than the app's 44px touch-target convention.
- Many feature pages remove native outlines. The global focus ring catches standard controls, but shared components should preserve it and not rely on route-local styling.
- Root and route loading screens use fixed dark backgrounds, causing a visible theme flash and weakening perceived performance in light mode.

### P1 — navigation, hierarchy, and responsive structure

- The customer bottom navigation is visually strong in dark mode but uses fixed icon/text/background colors and six destinations at phone widths. It needs theme-safe colors, resilient label sizing, and clear current-page semantics without changing its information architecture.
- Role dashboards are more consistent where they use `PageHeader`, `StatCard`, `EmptyState`, and `lx-surface`; legacy admin and super-admin screens still contain one-off headers, fields, button radii, and card fills.
- Vendor has a coherent responsive shell. Rider/admin/super-admin rely more heavily on per-page navigation and need shared spacing/touch-target alignment, not a new shell.
- Long operational pages need reliable horizontal table containment and sticky controls that respect safe areas.

### P1 — states and perceived performance

- Customer high-traffic routes have good skeleton coverage, but most admin/super-admin nested routes fall back to a generic full-screen spinner. This loses page context during navigation.
- Empty states exist as a shared primitive but are not consistently used by legacy list surfaces.
- Async controls commonly change text while loading, but `aria-busy`, stable button width, and inline failure placement are inconsistent.

### P2 — visual refinement

- Hardcoded `#F5A623`, white alpha values, radii, and shadows remain widespread alongside equivalent semantic tokens. Consolidation will improve dark/light behavior and future consistency.
- Some public utility/legal/offline pages use raw inline styling and feel visually detached from the core app.
- Icon language is split between Lucide and route-local SVGs/emoji. Brand-specific marks may remain custom; generic actions/statuses should converge on Lucide or existing shared icons.
- Small uppercase metadata is occasionally below comfortable mobile reading size or too faint. Operational density is appropriate, but contrast needs a consistent floor.

### P2 — motion and interaction polish

- Reduced-motion handling is already strong globally.
- Universal active scaling gives useful feedback, but compound components sometimes stack transforms. Shared controls should own their press behavior to prevent exaggerated motion.
- Hover elevation is appropriate for pointer devices; it should not imply clickability on static cards.

## Batch plan and acceptance checks

1. Shared foundation: semantic colors, customer nav, shared dialog focus, touch targets, and loading surfaces. Check dark/light, keyboard focus, reduced motion, mobile/tablet/desktop, build.
2. Customer/public: high-traffic purchase journey first, then account/feed/utility pages. Check safe-area spacing, fixed navigation overlap, empty/loading/error states, and light/dark.
3. Vendor: shell and all delegated dashboard clients. Check desktop sidebar, mobile bottom nav, data density, forms, empty states, and order urgency.
4. Rider: live dashboard, wallet, reviews, settings, and gates. Check one-handed use, online-state clarity, job-card actions, and safety-critical contrast.
5. Admin: all operational lists/forms. Check table overflow, action hierarchy, filters, destructive confirmations, and scanability.
6. Super-admin: all system/finance/feed controls. Check dense-form hierarchy, technical metadata, irreversible actions, and responsive containment.
7. Final regression: route inventory reconciliation, production build, tests relevant to changed components, and working-tree review.

## Verification and completed batches

- Shared foundation: semantic navigation/focus colors, responsive customer nav distribution, theme-aware header/KPI/back controls, 44px alert dismissal, and labelled confirmation-dialog focus management.
- Customer states: theme-aware, announced skeletons for the root fallback and high-traffic home, cart, orders, leaderboard, profile, wallet, menu, order, and group routes.
- Public utility states: contact, legal/policy, offline, error, and 404 surfaces aligned to the existing LumeX customer theme and button/icon hierarchy.
- Role states: responsive console skeletons for vendor, rider, admin, and super-admin navigation, including inherited nested-route coverage.
- Customer compatibility: auth, recovery, registration, application, sponsor, wallet, and group-order fallback canvases converted from fixed dark fills to existing semantic page tokens.
- `next build`: passed, including TypeScript, all 144 static pages, and final route optimization.
- Full-project ESLint: passed.
- Vitest: 89 files and 651 tests passed.
- Runtime production inspection: representative landing, auth, contact, and offline routes captured successfully at 375px; landing and auth also captured at 1024px. No overflow, contrast, hierarchy, or spacing regression was found in the completed surfaces.

## Visible polish follow-up

After review feedback that the first pass was too subtle during normal use, a second pass targeted the primary visible journey:

- Home: promoted the marketplace question to a real page heading, simplified the crowded top bar, replaced utility emoji with Lucide icons, enlarged vendor cards, and introduced a responsive two-column tablet/desktop marketplace.
- Vendor storefront: widened the content frame, added a clear menu heading and item count, and scales menu cards from two columns on phones to three/four columns on larger screens.
- Orders: added vendor imagery, delivery/pickup metadata, stronger amount/status hierarchy, responsive two-column history, and standardized empty/error/pagination states.
- Profile: added a clearer header, responsive wallet/location shortcut grid, wider tablet frame, and consistent action icons.
- Cart: clarified the header, widened the tablet frame, increased section breathing room, and standardized visible utility icons.
- All roles: strengthened shared glass-card depth, topbar separation, field hover/focus treatment, and pill interaction feedback without changing dashboard structure.
