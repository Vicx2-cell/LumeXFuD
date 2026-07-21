# Initial route inventory

Filesystem inventory on 2026-07-21: **99 UI pages** and **231 API route files**. Dynamic segments are shown in brackets. Route existence is not evidence of authorization or journey completeness.

Remediation update: the approved working tree added `POST /api/webhooks/resend`, bringing the current API handler count to 232. It is classified as a signature-authenticated webhook.

## UI pages

```text
/
/admin /admin/accounts /admin/audit /admin/customer-locations /admin/disputes
/admin/email-operations /admin/kyc /admin/live /admin/lodges /admin/orders
/admin/reviews /admin/riders /admin/riders/new /admin/vendors /admin/vendors/new
/admin/verified-places /admin/verify-receipt /admin/wallets
/apply/[kind]
/auth /auth/complete /auth/forgot-pin /auth/register /auth/setup
/campus-partners /cart /contact /faq
/feed-v2 /feed-v2/create /feed-v2/profile/[profileId]
/group/[code] /home /leaderboard /offline /order/[orderNumber] /orders /ping
/premium /privacy /profile /profile/locations /profile/places /profile/wallet
/referrals /refunds
/rider /rider/reviews /rider/settings /rider/wallet
/sponsor /study /study/courses /style-preview /style-preview/vendor
/super-admin /super-admin/announce /super-admin/audit /super-admin/consent
/super-admin/controls /super-admin/cron /super-admin/features /super-admin/feed-reports
/super-admin/feed-stories /super-admin/financials /super-admin/launch-counter
/super-admin/official-feed /super-admin/premium /super-admin/pricing /super-admin/rewards
/super-admin/security /super-admin/sentinel /super-admin/settings /super-admin/team/new
/super-admin/usage /super-admin/whatsapp
/terms /uturu/guides/[slug] /uturu/vendor/[slug]
/vendor/[id] /vendor/[id]/followers /vendor/[id]/following
/vendor-dashboard /vendor-dashboard/analytics /vendor-dashboard/boosts
/vendor-dashboard/earnings /vendor-dashboard/finance /vendor-dashboard/marketing
/vendor-dashboard/menu /vendor-dashboard/orders /vendor-dashboard/reviews
/vendor-dashboard/settings /vendor-dashboard/share /vendor-dashboard/store
/vendor-dashboard/support /vendor-dashboard/videos
/vendor-followers/[id] /vendor-following/[id]
```

## API surfaces

All handler files under `app/api/**/route.ts` were enumerated with exported HTTP methods. Major namespaces are: admin, AI, applications, auth, boosts/campaign, cron, customer/profile/wallet, feed, forecast, group-order, Lumi, notifications/push, orders/order-communications, Paystack, premium/rewards/referrals, rider, study, super-admin, uploads, vendor/vendors, and WhatsApp.

Authoritative coverage intent is documented in `lib/authz-policy.ts:3-25`; the test at `test/authz-coverage.test.ts:27-51` compares every handler path against that policy. Baseline result was 229/231 classified. Remediation now classifies both email routes as self-authorizing auth flows and the Resend endpoint as a webhook; the coverage test passes for all 232 current handlers. `lib/route-manifest.json:1-6` remains stale (generated 2026-06-12 with only 92 routes) and must not be treated as complete.

## Page protection boundary

`proxy.ts:7-16` protects `/home`, `/vendor-dashboard`, `/rider`, `/admin`, `/super-admin`, `/orders`, `/profile`, and `/cart` by role. API authorization remains handler/policy/RLS dependent and must be tested independently. Public and application-state inventories are deferred to Phase 2.
