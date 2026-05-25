CORE DOCUMENT
LumeX Fud — Project Memory (Core)
What This Is
Campus food delivery platform for Abia State University (ABSU), Nigeria.
Three-sided marketplace: students order → vendors fulfill → riders deliver.
Web-only (Next.js). Mobile-first PWA. Digital payments only (Paystack). No cash on delivery.
This is the first product from Lumex — building the operating system for student life in Southeast Nigeria.
Tagline: "Campus life, simplified."
Document Map (READ FIRST)
This CLAUDE.md is the core. When implementing specific subsystems, read the matching doc:
• docs/auth.md — OTP, sessions, JWT, role detection, guest checkout
• docs/payments.md — Paystack init, webhook handling, refunds
• docs/wallet.md — LumeX Wallet, trust tiers, withdrawals, reconciliation
• docs/messaging.md — in-app order messaging
• docs/ratings.md — vendor + rider rating system
• docs/vendor-ranking.md — performance scoring algorithm, visibility tiers
• docs/gamification.md — streaks, badges, XP, leaderboard
• docs/admin.md — admin + super admin separation
• docs/notifications.md — every Termii WhatsApp/SMS message
• docs/security.md — full security hardening + penetration testing
• docs/database.md — complete SQL schema for every table
When the task involves any of these areas — read the matching doc BEFORE writing code.
Tech Stack (LOCKED — DO NOT CHANGE)
• Framework: Next.js 15.5.18 OR 16.2.6 minimum (May 2026 patches 13 CVEs — required)
• Language: TypeScript (strict mode, never use any)
• Database: Supabase (PostgreSQL) — RLS enabled on every table
• Auth: Custom phone OTP via Termii + JWT in httpOnly cookie
• Payments: Paystack (Cards + Bank Transfer + USSD)
• Notifications: Termii (WhatsApp + SMS)
• Rate Limiting: Upstash Redis
• Image Processing: sharp (server-side)
• Phone Normalization: libphonenumber-js
• Validation: Zod (every API input)
• Error Tracking: Sentry (with PII filter)
LUMEX FUD — COMPLETE BUILD PACKAGE PAGE 7
• Deployment: Vercel
• PWA: native browser APIs (manifest + service worker)
Verify Version Before Every Deploy
npx next --version
Must be 15.5.18+ or 16.2.6+. Anything below = do not deploy.
The Core Loop (North Star)
Every feature must serve this loop:
Step 1: Hunger
Step 2: App opens → ranked vendor list shown
Step 3: Food selected (smart suggestions)
Step 4: Order placed
Step 5: Live status tracking
Step 6: Delivery completed
Step 7: Reward (streak + badge + XP)
Step 8: Social visibility
Step 9: Repeat behavior
The Bezos Design Filter
Before adding ANY feature, ask:
1. Does this increase order frequency?
2. Does this reduce delivery time?
3. Does this increase platform trust?
If NO to all three → do not build it. No exceptions.
Brand Identity
• Tagline: "Campus life, simplified."
• Position as infrastructure, not just food delivery
• No "Coming Soon" tabs for Internet/Energy
• Nigerian English throughout
• "Preparing" not "Processing"
• "Order" not "Transaction"
• "You" or first name, not "User"
UI Design
• Dark glassmorphism theme
• Amber accent: #F5A623
• Background: #0A0A0B (near black)
• Mobile-first, 375px baseline
• All tap targets minimum 44px
• Bottom mobile navigation
LUMEX FUD — COMPLETE BUILD PACKAGE PAGE 8
• Loading skeletons on every data list
• Empty states everywhere
• Toast notifications for actions
Pricing (LOCKED — read from settings table, never hardcode)
Platform food markup: ■250 per order
Bike delivery: ■500 (rider gets ■400, platform ■100)
Door delivery: ■1,000 (rider gets ■800, platform ■200)
Minimum order: ■500
Platform hours: 7am – 10pm
Vendor Subscription Tiers
• Founding (first 3): ■10,000/month, no setup, locked 12 months
• Early (vendors 4-10): ■25,000 setup + ■12,000/month
• Standard (vendor 11+): ■50,000 setup + ■15,000/month
Holds
• Rider payments: 24-hour hold after delivery confirmed
• Vendor payments: 3-day hold after order completed
• Customer dispute window: 15 minutes after DELIVERED status
Order Status Flow (strict whitelist)
PENDING (vendor must accept within 5 mins or auto-cancel)
 ↓
VENDOR_ACCEPTED
 ↓
PREPARING
 ↓
READY (waiting for rider)
 ↓
RIDER_ASSIGNED
 ↓
PICKED_UP
 ↓
DELIVERED (15-min customer dispute window opens)
 ↓
COMPLETED (auto after 15 mins, rider paid)
Alternative paths:
• PENDING → CANCELLED (auto-cancel timer or customer cancel)
• VENDOR_ACCEPTED → CANCELLED (vendor rejection)
• DELIVERED → DISPUTED (customer raises dispute within 15 mins)
• DISPUTED → REFUNDED (admin resolves in customer favor)
• DISPUTED → COMPLETED (admin resolves in vendor favor)
Transitions outside this whitelist must be rejected by the API.
LUMEX FUD — COMPLETE BUILD PACKAGE PAGE 9
File Structure
app/
 /auth OTP login flow
 / Customer homepage
 /vendor/[id] Vendor menu page
 /cart Cart page
 /order/[orderNumber] Order status page
 /orders Order history
 /profile Profile + gamification
 /leaderboard Weekly customer leaderboard
 /vendor-dashboard Vendor area (protected)
 /rider Rider area (protected)
 /admin Admin (protected)
 /super-admin Super admin (separate from admin)
 /privacy NDPR privacy policy
 /terms Terms of service
 /offline PWA offline fallback
 /api/ All API routes (see API list below)
components/
 /ui Reusable UI components
 /forms Form components
lib/
 /supabase/ client.ts, server.ts, middleware.ts
 /paystack/ init.ts, webhook.ts, transfer.ts
 /termii/ sms.ts, whatsapp.ts
 /upstash/ redis.ts
 money.ts toNaira, toKobo, formatPrice
 phone.ts normalizePhone (E.164)
 order-number.ts LXF-2026-XXXXXX generator
 rate-limit.ts Upstash rate limit helpers
 audit.ts Audit log writer
 validators.ts All Zod schemas
 security.ts HMAC, sanitize, input cleaning
 session.ts JWT verify, role check, helpers

types/
 /index.ts All DB table types
middleware.ts Auth + security headers
next.config.ts Security headers + CSP
vercel.json Cron schedules
public/
 manifest.json PWA manifest
 sw.js Service worker
 icon-192.png
 icon-512.png
 apple-touch-icon.png
NON-NEGOTIABLE RULES
1. Next.js MUST be 15.5.18+ or 16.2.6+
2. Phone numbers normalized to E.164 BEFORE storage/lookup
3. JWT in httpOnly cookie ONLY — never localStorage
4. ALWAYS calculate order prices server-side
5. ALWAYS verify Paystack HMAC before processing webhooks
6. ALWAYS check idempotency before processing webhook (processed_webhooks table)
7. ALWAYS return 200 to Paystack within 30 seconds — process async
LUMEX FUD — COMPLETE BUILD PACKAGE PAGE 10
8. ALWAYS verify ownership in every data-fetching route (BOLA prevention)
9. ALWAYS validate with Zod before touching DB
10. ALWAYS rate limit OTP routes (Upstash)
11. ALWAYS log admin actions to audit_logs
12. ALWAYS log super admin actions to super_audit_logs
13. ALWAYS use SELECT FOR UPDATE for race-sensitive operations
14. NEVER SELECT * — select only needed fields
15. NEVER expose bank account numbers or Paystack subaccount codes to non-admins
16. NEVER log full phone numbers, bank details, or tokens
17. NEVER hardcode prices — read from settings table
18. NEVER allow status transitions outside the whitelist
19. NEVER store prices in localStorage (cart manipulation risk)
20. NEVER hardcode bank codes — use Paystack List Banks API (cached in Redis)
21. NEVER use any type in TypeScript — fix the actual type
22. NEVER use ignoreBuildErrors: true in next.config.ts
23. NEVER use USING (true) in RLS policies (fake security)
24. NEVER put SUPABASE_SERVICE_ROLE_KEY in any client-accessible code
25. RLS enabled on every table — including service_role queries
26. npm audit before every deploy — fix critical + high
27. Image uploads: validate magic bytes, resize server-side (sharp)
28. Admin actions over ■50,000 require re-authentication
29. New device login → alert via WhatsApp
30. Every refund must go through audit_logs
31. Failed payments → automatic order cancellation
32. Wallet operations bank account MUST be separate from personal account
33. All wallet actions logged to wallet_transactions AND audit_logs
Failure Prevention Rules
These come from documented startup deaths (Jumia Food, Bolt Food, Chowdeck contractor layoffs):
1. Profitable on every order, from order #1. Never subsidize.
2. Zero permanent discounts. No "always 50% off" features. Promos must be one-time per user, capped.
3. Vendor concentration cap. No vendor exceeds 40% of total revenue by Month 3.
4. 30-30-30 expansion rule. Don't expand to a second campus until ABSU has 30+ orders/day for 30
consecutive days at 30%+ profit margin.
5. Hire one person at a time. Only when a specific bottleneck is provably hurting business.
6. Pay riders every Friday without fail. One missed payout = irreversible trust damage.
7. Average delivery time under 25 minutes. Above 30 = rider supply problem.
8. Dispute rate under 3%. Above = systemic problem requiring 24-hour investigation.
9. Repeat order rate target 40%+. Below 25% = retention crisis, fix before expanding.
10. Daily wallet reconciliation. If wallet_balances total ≠ Paystack balance: STOP everything.
LUMEX FUD — COMPLETE BUILD PACKAGE PAGE 11
Daily Metrics Dashboard
Admin landing page MUST show daily:
• Orders today (target: 50+ by Month 3, 200+ by Month 12)
• Profit per order (must be positive)
• Average delivery time (under 25 mins)
• Riders online right now
• Active disputes (zero target, above 3% = investigate)
• Wallet float (vendor + rider held funds)
Weekly review (Sundays):
• Repeat order rate
• Revenue per vendor (concentration check)
• Rider retention vs last week
• Vendor complaints
Monthly review:
• GMV (Gross Merchandise Value)
• Take rate (target 15-20%)
• Customer churn rate
• Vendor subscription MRR
Complete API Routes List
Auth (see docs/auth.md)
POST /api/auth/send-otp
POST /api/auth/verify-otp
POST /api/auth/logout
GET /api/auth/me
DELETE /api/auth/account
GET /api/auth/export
Orders (see docs/payments.md + docs/messaging.md)
POST /api/orders Create order
PATCH /api/orders/[id]/status Status transition
POST /api/orders/[id]/dispute Dispute order
POST /api/orders/[id]/confirm Early delivery confirmation
POST /api/orders/[id]/cancel Cancel order
POST /api/orders/[id]/rate Rate vendor + rider
POST /api/orders/[id]/reorder Rebuild cart from past order
POST /api/orders/[id]/delivery-photo Rider submits proof
POST /api/orders/[id]/messages Send order message
GET /api/orders/[id]/messages Get message thread
PATCH /api/orders/[id]/messages/read Mark as read
GET /api/orders/history Customer order history
Paystack (see docs/payments.md)
POST /api/paystack/webhook
LUMEX FUD — COMPLETE BUILD PACKAGE PAGE 12
POST /api/paystack/refund
POST /api/paystack/subscription
Vendors
GET /api/vendors List for homepage (sorted by score)
GET /api/vendors/[id] Single vendor + menu
POST /api/vendors/[id]/status OPEN/BUSY/CLOSED toggle
POST /api/vendors/[id]/pause Pause orders (15/30/60 mins)
POST /api/vendors/subscription/pay Pay monthly fee
GET /api/vendors/subscription/status Subscription info
Riders
POST /api/riders/[id]/status ONLINE/OFFLINE
POST /api/riders/[id]/accept Accept order (SELECT FOR UPDATE)
Wallet (see docs/wallet.md)
GET /api/wallet/balance
POST /api/wallet/withdraw
GET /api/wallet/banks Paystack List Banks API (cached 24h)
POST /api/wallet/verify-account
POST /api/wallet/set-pin
Menu
POST /api/upload/menu-image Magic bytes + sharp resize
GET /api/menu/[vendor_id]
Cron (see vercel.json)
POST /api/cron/release-payments Every minute
POST /api/cron/vendor-auto-cancel Every minute
POST /api/cron/subscription-check Daily 9am
POST /api/cron/reset-daily-limits Midnight
POST /api/cron/wallet-reconciliation Daily 6am
POST /api/cron/recalculate-vendor-scores Weekly Sunday midnight
POST /api/cron/reset-weekly-leaderboard Monday midnight
Admin (see docs/admin.md)
GET /api/admin/dashboard
GET /api/admin/vendors
PATCH /api/admin/vendors/[id]
GET /api/admin/riders
PATCH /api/admin/riders/[id]
GET /api/admin/orders
GET /api/admin/disputes
POST /api/admin/disputes/[id]/resolve
GET /api/admin/audit
POST /api/admin/boost/[vendor_id]
Super Admin (see docs/admin.md)
GET /api/super-admin/financials
PATCH /api/super-admin/settings
POST /api/super-admin/team
GET /api/super-admin/super-audit
All cron routes protected with Authorization: Bearer ${CRON_SECRET}.
LUMEX FUD — COMPLETE BUILD PACKAGE PAGE 13
All admin routes verify role from JWT.
All super admin routes verify SUPER_ADMIN_PHONE match.
Database (see docs/database.md for full schema)
Core tables:
• customers, vendors, riders, admins (users)
• orders, order_items, order_messages
• payments, refunds, processed_webhooks
• vendor_subscriptions, vendor_scores
• wallet_balances, wallet_transactions
• ratings
• customer_xp, customer_badges, badges
• audit_logs, super_audit_logs
• sessions, otp_attempts, admin_devices
• notifications, trending_data
• settings (live-editable)
All tables have RLS enabled with proper policies (never USING (true)).
All foreign keys properly indexed.
All timestamps use TIMESTAMPTZ (not TIMESTAMP).
Realtime Subscriptions
• vendors table: homepage live open/closed updates
• orders table filtered by customer_id: order status page live updates
• orders table filtered by vendor_id: vendor dashboard inbox
• orders table where status = 'READY' AND rider_id IS NULL: rider available orders
• order_messages table filtered by order_id: in-app messaging
• trending_data row 1: homepage trending section
Environment Variables (.env.local)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY= # server-only, NEVER in client code
PAYSTACK_SECRET_KEY= # sk_live_... in production
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY= # pk_live_...
PAYSTACK_WEBHOOK_SECRET=
TERMII_API_KEY=
TERMII_SENDER_ID=LumeXFud
NEXT_PUBLIC_APP_URL= # https://lumexfud.com.ng in production
UPSTASH_REDIS_REST_URL=
LUMEX FUD — COMPLETE BUILD PACKAGE PAGE 14
UPSTASH_REDIS_REST_TOKEN=
CRON_SECRET= # 32-char random
JWT_SECRET= # 64-char random
ADMIN_PHONE=+234XXXXXXXXXX # operational admin
SUPER_ADMIN_PHONE=+234XXXXXXXXXX # Chibuike — god mode
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
Validate at app startup: throw if any required var is missing.
High-Level Build Order
1. Foundation (next.config, deps, lib helpers, types) — see SESSION_2 prompt
2. Database (all tables + RLS) — see docs/database.md
3. Auth (OTP, sessions, middleware) — see docs/auth.md
4. Customer experience (homepage, menu, cart, checkout) — see SESSION_3 prompt
5. Payments (Paystack init, webhook, refund) — see docs/payments.md
6. Order flow + messaging + ratings — see docs/messaging.md, docs/ratings.md
7. Vendor dashboard + subscription billing
8. Rider system + wallet — see docs/wallet.md
9. Admin + Super Admin — see docs/admin.md
10. Cron jobs (all 7)
11. Notifications wire-up — see docs/notifications.md
12. Gamification — see docs/gamification.md
13. Vendor ranking algorithm — see docs/vendor-ranking.md
14. PWA (manifest, sw.js, offline page)
15. Security hardening + penetration testing — see docs/security.md
16. Clean build with zero errors
Sound Alert and Notification Patterns
• Vendor dashboard: browser Notification API for new orders + sound
• Rider dashboard: vibration + sound for incoming order assignment
• Admin dashboard: WhatsApp alerts for urgent events (disputes, reconciliation mismatch, suspicious
activity)
END OF CORE CLAUDE.md
For any subsystem implementation — READ the matching doc in docs/ first
