# Production-readiness specification ledger

Source: owner-supplied 2,195-line specification, SHA-256 `198BBF7D6A364BD927B2778A2D52F559B4581F47297EA381B0CDAE0C04A17266`.

This is the completion ledger. No requirement may disappear because it is inconvenient or inapplicable. Every item must end in one of: `VERIFIED`, `MISSING`, `PARTIAL`, `INCORRECT`, `INAPPLICABLE`, `UNSAFE`, `LEGAL_REVIEW`, `PRODUCT_DECISION`, `BLOCKED`, or `NEEDS_HUMAN_REVIEW`. A checkmark means evidence is recorded in the named durable document, not merely that code exists.

## Always-on safety and process

- [x] `PROC-001` Starting branch, commit, dirty state and pre-existing failures recorded (`BASELINE.md`).
- [x] `PROC-002` Dedicated `audit/production-readiness` branch created after owner approval (`DECISIONS.md`).
- [x] `PROC-003` All required durable memory files created; this ledger supplements them.
- [ ] `PROC-004` Before every batch: read memory, inspect status/diff, identify one coherent task, confirm prior evidence.
- [ ] `PROC-005` For every finding use the required ID/severity/evidence/reproduction/impact/root-cause/fix/rollback/test/status format.
- [ ] `PROC-006` For every batch reproduce, minimally remediate, add regression tests, run targeted/broad checks, adversarially review, update memory and commit.
- [ ] `PROC-007` Preserve secrets and user work; never weaken RLS/auth/tests or print credentials.
- [ ] `PROC-008` Never use real money, real notifications, production mutations, destructive migrations, impersonation or unapproved disclosure.
- [ ] `PROC-009` Stop for human review on production release, destructive schema, financial/KYC/privacy policy, evidence disclosure, law-enforcement action, background location, native permissions or material product change.
- [ ] `PROC-010` No production deploy without explicit approval; preview only after release gates.

## Phase 1 — repository discovery

- [x] `P01-001` Framework/App Router, proxy, handlers, components, tests and deployment structure inventoried (`ARCHITECTURE.md`).
- [x] `P01-002` Authentication/session/role implementation initially mapped (`ARCHITECTURE.md`).
- [ ] `P01-003` Every server action and background/scheduled job traced to actual call paths.
- [ ] `P01-004` Every database schema/table/view/function/RPC/trigger/grant/policy/index/FK/constraint/bucket inventoried.
- [ ] `P01-005` Every business domain traced: vendors, menus/modifiers/availability, carts/checkout/payments, orders/events/assignment/handover/chat/support/notifications/feed/verification/disputes/refunds/admin.
- [ ] `P01-006` Every external integration and failure behavior traced: Supabase/Postgres, Upstash, Paystack, Vercel, storage, cron, Sentry, analytics, email/SMS/WhatsApp, maps, AI.

## Phase 2 — routes, journeys and application states

- [x] `P02-001` Initial filesystem route inventory created (`ROUTE-INVENTORY.md`).
- [ ] `P02-002` Visitor journey states documented: prerequisites, happy/loading/empty/slow/offline/validation/auth/session/server/retry/duplicate/stale/interrupted/success/cancel/audit/mobile/PWA.
- [ ] `P02-003` Customer registration/login/phone/location/browse/menu/cart/pricing/checkout/payment/return/reconciliation/tracking/chat/cancel/dispute/account/deletion states verified.
- [ ] `P02-004` Vendor application/verification/approval/onboarding/menu/availability/orders/preparation/chat/fulfilment/settings/suspension states verified.
- [ ] `P02-005` Rider application/verification/approval/availability/assignment/navigation/chat/pickup/delivery-code/completion/reassignment/incidents/earnings states verified.
- [ ] `P02-006` Admin vendor/rider review, order/payment investigation, refund/dispute, reassignment, suspension, reports, security, audit and emergency-control states verified.

## Phase 3 — data and privacy

- [ ] `P03-001` Inventory identifiers/names/phones/emails/addresses/coordinates/landmarks/rider documents/vehicles/vendor data.
- [ ] `P03-002` Inventory device/session/IP/order/payment/ledger/message/support/location/media/security/admin-audit data.
- [ ] `P03-003` For every category record purpose, human-reviewed legal/contract basis, collection, access roles, storage, encryption/access, search/client exposure.
- [ ] `P03-004` For every category record retention, deletion/anonymization, legal hold, sharing, logging limits and store disclosure.
- [ ] `P03-005` Classify protection as access control/hash/tokenization/application encryption/storage encryption/redaction/minimization/short retention/no collection.
- [ ] `P03-006` Prove forbidden secrets/tokens/cookies/authorization/card data/private message bodies are not logged.

## Phase 4 — threat model

- [ ] `P04-001` Assets documented: accounts/sessions/personal data/documents/locations/orders/messages/codes/payments/payouts/admin/system accounts/secrets/deployment/logs.
- [ ] `P04-002` Actors documented: unauth attacker, malicious customer/vendor/rider, stale rider, suspended/compromised user/admin, bot, webhook attacker, insider, proxy/VPN/device attacker.
- [ ] `P04-003` Trust boundaries documented for browser/PWA/native, Next/Supabase/Redis/realtime/Paystack/cron/admin/upload/maps/notifications/store plugins.
- [ ] `P04-004` Concrete repository-backed attack paths and mitigations recorded; no generic/unproven vulnerability claims.

## Phase 5 — authentication, sessions and devices

- [ ] `P05-001` JWT algorithm/key strength/storage/expiry/replay/refresh/reissue verified.
- [ ] `P05-002` Cookie HttpOnly/Secure/SameSite, fixation, CSRF and redirect behavior verified.
- [ ] `P05-003` Logout/logout-all, revocation, role-change/suspension invalidation and stale-session behavior verified.
- [ ] `P05-004` OTP send/verify abuse, rate limits, replay, enumeration, brute force and recovery verified.
- [ ] `P05-005` WebAuthn/social/password/PIN recovery and session binding/suspicious-session handling verified.
- [ ] `P05-006` Proportionate device/session history and unfamiliar-session controls classified/implemented or marked inapplicable.

## Phase 6 — authorization and RLS

- [ ] `P06-001` Every table/view/function/RPC/bucket/API/action/realtime/cron/admin operation mapped to exposure, grants, RLS, server auth, ownership, roles and manipulable IDs.
- [x] `P06-002` All current API route files structurally classified by the coverage backstop; targeted tests pass (`FINDINGS.md` PR-001).
- [ ] `P06-003` Horizontal/vertical escalation, IDOR/BOLA, cross-customer/vendor/rider, stale-rider, suspended user and ordinary-user admin attempts executed.
- [ ] `P06-004` Direct API/Supabase/realtime bypass, mass assignment and service-role misuse attempts executed.
- [ ] `P06-005` Allow/deny tests cover permitted, unrelated same-role, wrong-role, unauthenticated, stale participant and manipulated identifier for every protected operation.
- [ ] `P06-006` Service-role use is server-only, narrowly authorized and absent from client bundles.

## Phase 7 — input, output and API security

- [ ] `P07-001` Every endpoint checked for schema/content-type/method/size/auth/rate/output/error/redirect/URL/pagination/query/idempotency/replay/CORS/cache/automation controls.
- [ ] `P07-002` SQL/command injection, stored/reflected/DOM XSS, HTML injection, SSRF, traversal, open redirect and prototype pollution attempts executed.
- [ ] `P07-003` Malformed/oversized/duplicate/reordered/Unicode/tampered state/role/price/ID enumeration attempts executed.
- [ ] `P07-004` One authoritative validation system is used; no competing framework added.

## Phase 8 — payments and financial integrity

- [ ] `P08-001` Actual Paystack model classified: checkout/init/verification/splits/subaccounts/transfers/refunds/internal balances/ledger.
- [ ] `P08-002` Server-derived integer minor-unit amount, currency, immutable price snapshot and unique reference verified.
- [ ] `P08-003` Raw-body HMAC/provider verification, amount/currency/order mapping and redirect independence verified.
- [ ] `P08-004` Webhook/retry/refund/payout/fulfilment idempotency and replay/concurrency verified.
- [ ] `P08-005` Partial failures, delayed webhook, abandoned redirect and paid-provider/unpaid-local reconciliation verified.
- [ ] `P08-006` Wallet/ledger immutability and custody/escrow/legal assumptions classified; policy changes stop for review.
- [ ] `P08-007` Refund mismatch/partial refund/dispute reconciliation and provider event history verified.

## Phase 9 — orders and logistics

- [ ] `P09-001` Repository-specific order state machine and authoritative transition actors mapped.
- [ ] `P09-002` Illegal/duplicate/concurrent transitions and assignment races prevented/tested.
- [ ] `P09-003` Cancel/pickup/completion/stale-rider/removed-rider/vendor/customer cross-order controls tested.
- [ ] `P09-004` Delivery-code reuse/brute force/premature completion tested.
- [ ] `P09-005` Historical order snapshots include items/modifiers/quantity/vendor/pickup/customer location/fees/discounts/currency/config version.
- [ ] `P09-006` Material transitions create append-only order events.

## Phase 10 — order communication

- [ ] `P10-001` Customer/current-rider, rider/customer/vendor, vendor/current-rider topology is enforced server-side and by RLS.
- [ ] `P10-002` Old rider loses access immediately; completion/cancellation read-only lifecycle and admin operational need verified.
- [ ] `P10-003` Membership, realtime/polling auth, XSS/length/spam/rate/unread/read-race/duplicate/reconnect/missed-event cleanup tested.
- [ ] `P10-004` Reassignment races, reports, admin viewing and retention tested.

## Phase 11 — realtime, notifications and recovery

- [ ] `P11-001` Authoritative initial fetch, secure updates, reconnect/missed-event reconciliation, duplicates/stale events/fallback/offline/multi-device/revocation/cleanup verified.
- [ ] `P11-002` Notification duplicates/order/stale links/removed rider/invalid tokens/preferences/quiet hours/lock-screen privacy/multi-device/deep links/fallback verified.
- [ ] `P11-003` Notification-open path always reconciles current server-authoritative state.

## Phase 12 — PWA

- [ ] `P12-001` Manifest id/name/short name/start/scope/display/colors/icons/maskable/screenshots/shortcuts/domain validated in browser tooling.
- [ ] `P12-002` Install prompt engagement/dismissal/repetition and Android/desktop/iOS guidance verified without invasive tracking.
- [ ] `P12-003` Lightweight install/precache budget verified; no bulk media/admin/private data precache.
- [ ] `P12-004` Cache strategy classified for build assets/fonts/icons/public data/media/order/messages/payment/profile/admin; private data not indiscriminately cached.
- [ ] `P12-005` Customer/rider/vendor offline states and stale/unsynced warnings verified; no false payment/order/delivery success.
- [ ] `P12-006` Waiting worker/old tabs/old clients/schema compatibility and checkout/payment/delivery/message/vendor-edit update deferral verified.
- [ ] `P12-007` Standalone back/payment return/external/deep/notification/duplicate-window/missing/session/safe-area navigation verified.

## Phase 13 — native and store readiness

- [ ] `P13-001` Capacitor/approved-runtime feasibility and platform adapters for location/notification/camera/storage/share/links/lifecycle/network/version/device/haptics/files classified.
- [ ] `P13-002` WebView cookie/auth callbacks/Paystack handoff/app links/universal links/push deep links/resume/safe areas/navigation verified or documented.
- [ ] `P13-003` Contextual permissions, denial/settings fallback and background-location/privacy decisions documented.
- [ ] `P13-004` In-app account deletion covers identity, active order/dispute/balance restrictions, revocation, deletion/anonymization/retention/job/confirmation/public route.
- [ ] `P13-005` Physical-food payments distinguished from future digital goods/store payment rules.
- [ ] `P13-006` Reviewer credentials/support/privacy links/icons/splash/screenshots/signing/crash/vitals/TestFlight/closed-track gaps documented.

## Phase 14 — performance

- [ ] `P14-001` Budgets defined for landing/feed/vendor/menu/cart/checkout/tracking/chat/rider/vendor/admin critical routes.
- [ ] `P14-002` JS/request/image/font/server/API/DB/LCP/INP/CLS/hydration/rerender/memory measurements captured where tooling permits.
- [ ] `P14-003` Client boundaries/effects/fetches/subscriptions/listeners/timers/images/fonts/animation/dependencies/splitting audited.
- [ ] `P14-004` Next rendering/cache/revalidation/metadata/streaming/Suspense/handler/proxy decisions audited.
- [ ] `P14-005` Database index/N+1/unbounded/pagination/count/query/transaction/lock/connection behavior audited.
- [ ] `P14-006` Redis keys/TTL/growth/consistency/stampede/failure/race and serverless cold-start/timeout/retry/overlap audited.
- [ ] `P14-007` Slow 3G/high latency/intermittent/low-end/background/data-saver/small-screen/installed tests run; no RUM claim without RUM.

## Phase 15 — reliability

- [ ] `P15-001` Close/loss after payment, delayed/duplicate webhook, DB/Redis/notification/realtime outage tested.
- [ ] `P15-002` Refresh/duplicate tap/resume/old client/multi-device/reassignment/item-unavailable interruption tested.
- [ ] `P15-003` Idempotency/backoff/timeout/circuit/dead-letter/replay/reconciliation/stale/conflict/pending/safe-degradation/alert controls justified and verified.
- [ ] `P15-004` No retry wraps a non-idempotent operation.

## Phase 16 — administration and operations

- [ ] `P16-001` Order/payment timelines/search/reconciliation/reassignment/cancellation/refund/dispute/suspension/session revocation/vendor override/delivery incident/report/review/support notes controls assessed.
- [ ] `P16-002` Incident banner/zone shutdown/kill switches/payment disable/security review/evidence hold assessed.
- [ ] `P16-003` Every privileged mutation records authoritative auth, reason, actor, timestamp, resource, old/new value, request/correlation ID and audit event.
- [ ] `P16-004` Least privilege among support/operations/fraud/security/admin/superadmin/developer verified.

## Phase 17 — forensics

- [ ] `P17-001` Required auth/session/device/role/suspension/authz/rate/suspicious/payment/webhook/order/assignment/handover/admin/export events verified.
- [ ] `P17-002` Event ID/time/type/severity/actor/role/session/device/request/correlation/network/UA/version/commit/route/method/resource/state/result/failure/provider/metadata fields assessed.
- [ ] `P17-003` Request/correlation IDs propagate browser→Next→DB→Redis→Paystack→order→notification→error.
- [ ] `P17-004` Append-only/restricted/no-update-delete/separate access/immutable export/hash/digest/logging-stop alerts/view/export audit assessed.
- [ ] `P17-005` Evidence package and chain-of-custody source/collector/time/hash/access/export/copy/reason/destination designed and tested without altering originals.

## Phase 18 — detection and incident response

- [ ] `P18-001` Detection rules cover login/enumeration/OTP/device/session/admin access/object enumeration/auth denial/delivery guessing/payment-webhook replay/settlement/refund/stale rider/export/role/privileged account/log interruption/service-role misuse.
- [ ] `P18-002` Graduated responses implemented without permanent accusation based solely on IP/UA/fingerprint/geolocation.
- [ ] `P18-003` Detect/triage/contain/preserve/investigate/eradicate/recover/notify/report/postmortem runbook completed.
- [ ] `P18-004` Lawful-request authority/minimization/approval/secure transfer/audit/preservation process completed; production disclosure requires review.

## Phase 19 — browser/platform protection

- [ ] `P19-001` CSP/HSTS/frame/content-type/referrer/permissions/cross-origin/cookies/CORS/private-cache/source-map/error/debug/robots/query controls audited.
- [ ] `P19-002` CSP derived from actual scripts/styles/images/APIs/payment/media and tested without broad unjustified directives or product breakage.

## Phase 20 — supply chain, secrets and CI/CD

- [ ] `P20-001` Committed secrets/env/NEXT_PUBLIC exposure/lock integrity/dependencies/install scripts/remote scripts/CDNs/build scripts audited.
- [ ] `P20-002` GitHub/Vercel permissions, branch protection, migration execution and preview parity audited where visible.
- [ ] `P20-003` CI gates typecheck/lint/tests/build/audit/secret/static/migration/auth/RLS/Playwright checks implemented or documented.
- [ ] `P20-004` Dependency advisories resolved through compatible, tested changes; no unproven mass upgrade.

## Phase 21 — migrations and old clients

- [ ] `P21-001` Every migration records purpose/lock/table-size/backward and old-client compatibility/rollback/backup/test/deploy order.
- [ ] `P21-002` Expand/additive → compatible code → backfill → authoritative switch → monitor → later contract pattern followed.
- [ ] `P21-003` No irreversible deletion ships with first-use code.

## Testing, preview and release gates

- [ ] `GATE-001` Matrix covers visitor, customer A/B, vendor A/B, rider A/B, reassigned rider, suspended user, admin, superadmin.
- [ ] `GATE-002` Allowed/denied/cross-object/stale/invalid/duplicate/concurrent/retry/payment-webhook replay/realtime/offline/PWA/mobile-installed tests pass.
- [ ] `GATE-003` Critical findings = 0 and High findings = 0; no financial-integrity defect remains.
- [ ] `GATE-004` Typecheck, lint, required tests and production build pass on the release commit.
- [ ] `GATE-005` PWA install/offline/update, accessibility and performance blockers verified/resolved or explicitly accepted.
- [ ] `GATE-006` Coherent changes committed; status clean; release SHA and changed files recorded.
- [ ] `GATE-007` Vercel Preview only: build/runtime logs inspected and prescribed landing/auth/customer/cart/checkout/payment/order/vendor/rider/chat/code/admin/unauthorized/PWA/offline/mobile/tablet/desktop smoke tests pass.
- [ ] `GATE-008` Release report contains branch/SHA/files/migrations/order/env/flags/findings/tests/build/preview/PWA/a11y/performance/store/privacy/retention/rollback/backup/deploy/postdeploy/monitoring/risks.
- [ ] `GATE-009` Rollback plan and required backups reviewed; release commit unchanged after preview proof.
- [ ] `GATE-010` Stop at `NEEDS_HUMAN_REVIEW — PRODUCTION RELEASE READY`; production remains undeployed until explicit approval.
