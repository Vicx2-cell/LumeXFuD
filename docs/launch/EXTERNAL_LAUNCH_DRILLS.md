# External launch drills

This is an operator runbook for an isolated staging project followed by a
controlled, low-value production drill. It does not authorize enabling ordering,
promotions, DVA, wallets, pickup, WhatsApp commerce, Study, AI, Premium, or
sponsor top-up. Never place secrets, full payment references, transfer recipient
codes, handover codes, or personal identity data in this document or a ticket.

## Common controls

Before every drill:

1. name an incident owner, database observer, provider-dashboard observer, and
   rollback owner;
2. record a unique drill ID and UTC start time;
3. use dedicated test identities and the minimum possible amount;
4. capture redacted request/event IDs, not payload secrets;
5. preserve the database audit trail; rollback by compensating operation, never
   by overwriting a money balance or deleting a ledger row;
6. keep maintenance mode on except for the explicitly bounded request window;
7. stop immediately on an unexplained debit, duplicate order, cross-role read,
   missing audit event, or signature-bypass result.

Expected logs must be present in the application host and Sentry without card
data, webhook bodies, authorization headers, identity documents, or full bank
details.

## Paystack drills

### Successful low-value card payment

- **Prerequisites:** Paystack live keys and webhook are configured outside Git;
  one approved vendor/item and delivery zone exist; maintenance exception is
  approved for the drill identity.
- **Action:** Create one low-value order, initialize once, complete the hosted
  card flow, and wait for verification/webhook processing.
- **Database effect:** one order and payment attempt; provider reference remains
  unique; verified amount/currency match the server total; order advances once;
  settlement components are snapshotted.
- **UI result:** a single paid order and tracking page, never a second order.
- **Logs / audit:** initialization, verified provider event, and status transition
  share correlation IDs; payment event records signature/requery outcome.
- **Pass:** Paystack dashboard, payment row, order total, and audit trail agree
  exactly in kobo.
- **Rollback:** keep the order for audit and perform the refund drill; return
  ordering to maintenance immediately.

### Failed payment

- **Prerequisites:** Paystack failure test path or a deliberately declined
  instrument; fresh checkout idempotency key.
- **Action:** submit once and complete the provider's failure path.
- **Database effect:** failed attempt is recorded; order is not paid; reservations
  are released once; no settlement or payout becomes payable.
- **UI result:** actionable failure with safe retry, no paid confirmation.
- **Logs / audit:** provider status and release transition, without card details.
- **Pass:** balances and payable totals are unchanged and retry cannot reuse the
  failed provider reference as a success.
- **Rollback:** expire the unpaid order through the normal operation.

### Abandoned payment

- **Prerequisites:** short documented staging expiry; a new checkout.
- **Action:** initialize, close the hosted page, and allow expiry processing.
- **Database effect:** pending attempt expires; every checkout reservation is
  released; no debit or settlement is committed.
- **UI result:** pending becomes expired/failed with a fresh-checkout option.
- **Logs / audit:** expiry job and reservation release are correlated.
- **Pass:** no indefinite reservation and repeated expiry is idempotent.
- **Rollback:** none beyond normal expiry; investigate any stranded reservation.

### Duplicate webhook

- **Prerequisites:** capture one valid signed test event in a secure operator
  tool; do not paste it into documentation.
- **Action:** deliver the identical signed request twice.
- **Database effect:** one webhook event/idempotency record and one business
  transition; the duplicate is acknowledged without mutation.
- **UI result:** one order/payment state.
- **Logs / audit:** first marked processed, second marked duplicate.
- **Pass:** no duplicate order, debit, notification, settlement, or payout.
- **Rollback:** halt webhooks and reconcile if any duplicate mutation occurs.

### Delayed webhook

- **Prerequisites:** a successful payment whose webhook delivery can be paused.
- **Action:** return from checkout, wait, then deliver the valid event.
- **Database effect:** server-side verification may establish payment; delayed
  event converges idempotently on the same state.
- **UI result:** pending state is honest until verified, then becomes paid once.
- **Logs / audit:** requery and delayed event share the provider reference.
- **Pass:** arrival order does not change money or final state.
- **Rollback:** maintenance on; manually reconcile from Paystack before any
  compensating refund.

### Invalid signature

- **Prerequisites:** webhook URL reachable from the controlled test client.
- **Action:** send a realistic body with a missing or altered signature.
- **Database effect:** no webhook/idempotency/business mutation.
- **UI result:** none.
- **Logs / audit:** security rejection with redacted source/correlation metadata.
- **Pass:** non-success HTTP response and zero state change.
- **Rollback:** block the source if repeated and review alert delivery.

### Replayed event or payment reference

- **Prerequisites:** one already-consumed event and reference; a second order with
  a different amount/customer.
- **Action:** replay the event and attempt to attach its reference to the second
  order.
- **Database effect:** unique/idempotency guards reject reuse; the second order
  remains unpaid.
- **UI result:** no success for the second order.
- **Logs / audit:** replay/cross-order mismatch is explicit.
- **Pass:** reference ownership, amount, currency, and order identity are all
  enforced.
- **Rollback:** freeze affected orders and reconcile if reuse is accepted.

### Refund

- **Prerequisites:** the successful drill order; refund authorization and provider
  access; no customer wallet credit path.
- **Action:** request the exact permitted refund through the supported admin
  operation and observe provider completion.
- **Database effect:** immutable refund attempt/event; refunded kobo never exceed
  captured kobo; settlement liability reverses/holds correctly.
- **UI result:** customer and admin see the final refund state.
- **Logs / audit:** requester identity, reason, provider reference, and transitions.
- **Pass:** Paystack refund and internal reconciliation totals agree.
- **Rollback:** refunds are not reversed by row editing; escalate provider errors
  and record a compensating accounting action if required.

### Transfer reversal (where supported)

- **Prerequisites:** Paystack test/live account supports transfer reversals and a
  low-value payout drill is approved.
- **Action:** cause or use a provider-supported reversal and deliver its event.
- **Database effect:** transfer attempt becomes reversed once; payable liability
  is restored/held, not double credited.
- **UI result:** finance/admin show reversed or held, never successful.
- **Logs / audit:** provider transfer/reference and reversal event correlate.
- **Pass:** ledger and dashboard reconcile and retry needs explicit authorization.
- **Rollback:** hold the beneficiary and do not retry until reconciliation.

### Guest Pay with Transfer

- **Prerequisites:** Pay with Transfer is enabled by Paystack; DVA remains off;
  isolated guest order and scoped token.
- **Action:** initiate a transaction-specific transfer, pay exactly once, and
  access tracking with and without the guest token.
- **Database effect:** transaction reference is tied to one guest order; no
  customer wallet or permanent DVA/account is created.
- **UI result:** scoped holder can track; guessed/missing token cannot.
- **Logs / audit:** transfer verification and guest-scope decisions are recorded.
- **Pass:** paid amount matches; no permanent account; enumeration is prevented.
- **Rollback:** refund through the supported flow and expire the guest token.

### Paystack reconciliation

- **Prerequisites:** all above drill IDs and Paystack export/dashboard access.
- **Action:** compare captured, failed, abandoned, refunded, transfer, and reversal
  records by reference and integer kobo.
- **Database effect:** reconciliation report records discrepancies and run
  identity; it does not overwrite balances.
- **UI result:** admin report totals and exception list match the evidence.
- **Logs / audit:** report generation and every disposition are attributable.
- **Pass:** zero unexplained variance and no duplicate reference.
- **Rollback:** keep maintenance on and freeze settlements until every variance is
  resolved by immutable adjustment.

## Settlement drills

| Drill | Prerequisites and exact action | Expected database/UI/log/audit effect | Pass criteria and rollback |
|---|---|---|---|
| Vendor commission | Paid low-value order with known commission setting; calculate independently from the stored snapshot. | One vendor gross/commission/net snapshot; finance UI displays it; audit identifies pricing version. | Exact kobo agreement. On mismatch, hold settlement, maintenance on, no direct edits. |
| Vendor-funded promotion | Promotions remain disabled for this certification. In a separately authorized staging exercise only, use a vendor-funded rule and one paid order. | Vendor liability bears discount; LumeX promo-fund ledger has no debit/reservation; logs identify funding source. | Zero LumeX movement. Kill campaign and hold settlement on variance. |
| LumeX-funded promotion while kill-switched | Keep the global/campaign kill switch on and attempt eligible checkout. | No promo reservation/debit; checkout either proceeds without it or safely rejects according to product rule; reason audited. | No promo-fund movement. Keep switch on and investigate any discount. |
| Rider payout | Complete a delivery using the handover workflow and independently calculate the configured payout. | One payable rider amount tied to order/delivery; wallet/ledger UI agrees; completion audit exists. | One exact kobo liability. Hold payout on mismatch. |
| Held settlement | Place the paid order/beneficiary under supported hold before settlement. | Liability remains, payable transfer is not created, admin shows reason/actor/time. | Provider has no transfer. Release only after review. |
| Failed payout | Use provider failure path for an authorized low-value payout. | Failed attempt is immutable; liability remains held/payable once; no success timestamp. | No lost or duplicated liability. Freeze retry on ambiguity. |
| Retry | After confirmed failure, authorize exactly one retry with a new attempt id and same underlying liability. | Linked retry; one eventual success at most; audit names authorizer. | Provider and ledger show one paid amount. Stop retries and reconcile otherwise. |
| Totals reconciliation | Aggregate gross, commission, refunds, vendor net, rider liability, held, failed, and paid for drill IDs. | Reconciliation report and exception audit only; no overwritten totals. | Accounting identity balances in kobo. Hold all affected settlements on variance. |

## Live authorization (BOLA/IDOR) drills

Use two identities per role and resource identifiers belonging to the other
identity. Exercise both UI navigation and the underlying HTTP endpoint; changing
an ID in a browser is insufficient coverage.

| Role | Exact action | Expected database/UI/log/audit result | Pass and rollback |
|---|---|---|---|
| Customer | Read/update another customer's order, address, profile, and receipt IDs. | RLS/API deny without revealing existence or PII; safe 403/404; security event has actor and resource class. | No returned row or mutation. Revoke session and maintenance on if exposed. |
| Guest | Guess sequential/random order IDs; reuse another guest token; alter order ID while retaining token. | Token hash/scope must bind to one order; no customer/session fallback. | No existence oracle or data. Expire all drill tokens on failure. |
| Vendor | Read/update another vendor's menu item, order, storefront controls, finance, or settlement. | Route authorization and RLS both deny; own resources remain usable. | Zero cross-vendor rows/mutations. Disable vendor account on failure. |
| Rider | Read another rider's private delivery/customer details; accept/update an ineligible delivery. | Only eligible/assigned fields are returned; private route denies. | No address/code leakage or mutation. Suspend assignment workflow on failure. |
| Admin | Call super-admin team, pricing, security, promotion-fund, or platform-control actions. | Explicit role check denies; no privileged DB mutation; attempt audited. | Ordinary admin cannot escalate. Revoke admin session on failure. |
| Super-admin | Verify intended intervention is attributable; attempt direct unsafe role/self-protection bypass. | Allowed operations require correct authorization/reason; protected invariants remain enforced. | Full actor/time/reason audit. Freeze admin access on missing attribution. |

## Delivery drills

| Drill | Prerequisites / action | Expected database, UI, logs, and audit | Pass criteria / rollback |
|---|---|---|---|
| Assignment | Ready paid order and eligible rider; assign/accept once, then concurrently repeat. | One assignment; vendor/customer/rider views converge; competing request loses safely. | Exactly one rider. Unassign through audited admin operation on error. |
| Pickup | Assigned rider and vendor confirmation; perform pickup transition once and replay it. | One valid status transition and timestamp; replay is no-op/rejected; notification once. | Transition graph preserved. Admin intervenes, never direct row rewrite. |
| Correct handover code | At delivery, customer supplies code to assigned rider. | Server validates protected code and completes once; settlement/payout eligibility follows. | One completion with actor/time. Dispute/hold if any mismatch. |
| Incorrect code | Submit wrong values and exceed the documented attempt control. | No completion; rate/attempt protection and safe error; no code in logs. | Order remains delivering. Lock/escalate through admin. |
| Reused code | Replay correct code after completion or against another order. | Bound hash/order and terminal-state checks reject it. | No second transition or disclosure. Hold affected payouts if accepted. |
| Completed delivery | Verify customer receipt, vendor order, rider history, admin operations, notifications, and liabilities. | All surfaces show the same terminal state; audit trail is ordered. | No stale/inconsistent state. Hold settlement pending repair. |
| Dispute after completion | Open supported dispute/admin intervention after completion. | Delivery history remains immutable; dispute/hold is additive and attributable. | Payout/settlement obey hold. Resolve with audited operation only. |

## External-service drills

| Service | Prerequisites and action | Expected effect and pass criteria | Rollback |
|---|---|---|---|
| Resend | Verified domain/API key outside Git; trigger one transactional order email and one provider failure. | Delivery ID/status logged without message body/PII; required workflow tolerates failure and exposes retry/alert. | Revoke test key if exposed; disable email integration, not ordering integrity. |
| Sendchamp | Approved sender/key outside Git; trigger one allowed transactional SMS and a failure. | One message attempt, redacted recipient, provider ID, and failure alert; no duplicate on replay. | Disable sender/integration and use documented operational fallback. |
| Upstash | Production REST credentials and rate-limit policy; burst one sensitive endpoint from controlled clients, then simulate outage. | Limits are shared across instances; fail-open/closed behavior matches endpoint risk; no token logged. | Rotate exposed key; apply provider block and maintenance for payment/auth uncertainty. |
| Sentry | Production project/release configured; emit a synthetic handled error with test marker. | Event includes release/correlation ID and excludes secrets, webhook body, stack in user UI, and PII. | Delete test event if policy requires; remove/rotate DSN only if compromised. |
| Cron health | Scheduler auth configured; invoke each required expiry/reconciliation/notification job, then invalid auth and overlapping invocation. | Valid run has bounded start/end/counts; invalid request denied; overlap is locked/idempotent; audit identifies job run. | Disable schedule and execute documented manual recovery under maintenance. |
| Webhook monitoring | Provider endpoint/alerts configured; send valid, invalid, delayed, and repeated events. | Availability, latency, signature failures, and processing failures alert with redacted IDs; successful duplicate does not page as mutation. | Pause provider delivery only if necessary, preserve events, repair, then replay idempotently. |

## Drill completion record

For each row, operators must record date, environment, build commit, drill ID,
roles, redacted provider/event references, database reconciliation query result,
screenshots with PII removed, log/Sentry links, result, incident link if failed,
and rollback completion. Launch ordering must remain closed until every
launch-gate drill is signed by both the technical owner and operations owner.
