# LumeX Feed Implementation

This document is the living implementation checklist for the social-commerce expansion requested in the brief.

## Purpose

Build a commerce-first feed and companion systems for:

- Customers
- Vendor owners and staff
- Riders
- Moderators
- Super Admin
- Lumi system agent

The goal is not a generic social network. Every feed surface should support a measurable commerce outcome.

## Slice Progress

### Slice 1: Foundation

- [x] Added the first feed schema migration.
- [x] Added social-feed ranking primitives and quota helpers.
- [x] Added centralized entitlement helpers.
- [x] Added a first authenticated feed API route.
- [x] Added a first feed page shell.
- [x] Added focused tests for ranking, quota, and entitlements.
- [x] Ran `npm.cmd test` successfully.
- [x] Ran `npm.cmd run build` successfully.
- [x] Ran targeted lint on the changed feed files successfully.
- [ ] Full-repo `npm.cmd run lint` still reports existing unrelated repository issues outside this slice.

### Slice 2: Composer Wiring

- [x] Wired the authenticated feed page to the live feed composer.
- [x] Added vendor menu-item loading for post attachments.
- [x] Added draft save and publish submission paths.
- [x] Added media upload progress, retry, and preview handling.
- [x] Added tab switching UI backed by the server feed snapshot.
- [x] Re-ran targeted lint on the changed feed files successfully.
- [x] Re-ran `npm.cmd test` successfully.
- [x] Re-ran `npm.cmd run build` successfully.

### Slice 3: Social Interactions

- [x] Completed work: added production-ready like, bookmark, repost, reply, quote, follow, mute, block, report, and feedback endpoints; wired viewer-specific interaction state into the feed snapshot; added optimistic card actions with rollback; added feed-card save/follow/share/report menus; added quote and reply prompts; added block and mute filtering in the snapshot layer.
- [x] Files changed: `app/feed/feed-client.tsx`, `app/feed/page.tsx`, `app/api/feed/_shared.ts`, `app/api/feed/posts/[id]/like/route.ts`, `app/api/feed/posts/[id]/bookmark/route.ts`, `app/api/feed/posts/[id]/repost/route.ts`, `app/api/feed/posts/[id]/reply/route.ts`, `app/api/feed/posts/[id]/quote/route.ts`, `app/api/feed/posts/[id]/report/route.ts`, `app/api/feed/posts/[id]/feedback/route.ts`, `app/api/feed/profiles/[profileId]/follow/route.ts`, `app/api/feed/profiles/[profileId]/mute/route.ts`, `app/api/feed/profiles/[profileId]/block/route.ts`, `lib/feed/interactions.ts`, `lib/feed/service.ts`, `lib/feed/types.ts`, `lib/feed/validators.ts`, `lib/authz-policy.ts`, `supabase/migrations/107_feed_quote_refs.sql`, `vitest.config.ts`.
- [x] Tests added: `app/api/feed/posts/[id]/like/route.test.ts`, `lib/feed/interactions.test.ts`.
- [x] Verification result: `npm.cmd exec eslint ...` passed for the changed feed/auth files; `npm.cmd test` passed with 44 files and 487 tests; `npm.cmd run build` passed.
- [x] Remaining external dependency: none for this slice.
- [x] Known limitation: mute/block unhide flows are available through the overflow actions while the content is visible; future timeline management can add a dedicated hidden-creator management surface.

### Slice 4: Timeline Foundations

- [x] Completed work: added cursor-backed feed pagination, a load-more control, basic tab filtering for Following/Nearby/Deals/Trending, sponsored labels, and a refresh control.
- [x] Files changed: `app/api/feed/route.ts`, `lib/feed/service.ts`, `app/feed/feed-client.tsx`, `app/feed/page.tsx`.
- [x] Tests added: covered indirectly by the existing feed and access-control suites; no new dedicated tests yet.
- [x] Verification result: `npm.cmd exec eslint ...` passed for the changed timeline files; `npm.cmd test` passed with 44 files and 487 tests; `npm.cmd run build` passed.
- [ ] Remaining external dependency: none.
- [ ] Known limitation: deeper vendor availability checks, diversity rules, richer empty/skeleton/error states, and stronger trending scoring are still pending for the full timeline spec.

### Slice 5: Feed Event Tracking and Attribution

- [x] Completed work: added a batched authenticated feed-event ingestion route, replay-safe batch keys, impression persistence, server-side attribution selection, attribution reversal on refunds/cancellations, order-completion hooks, and client-side impression/action emission for feed interactions.
- [x] Files changed: `app/api/feed/events/route.ts`, `app/api/orders/[id]/status/route.ts`, `app/api/orders/[id]/deliver/route.ts`, `app/api/orders/[id]/collect/route.ts`, `app/api/orders/[id]/confirm/route.ts`, `app/api/orders/[id]/cancel/route.ts`, `app/api/admin/disputes/[id]/resolve/route.ts`, `app/feed/feed-client.tsx`, `lib/feed/events.ts`, `lib/feed/attribution.ts`, `lib/feed/validators.ts`, `lib/authz-policy.ts`, `supabase/migrations/108_feed_event_attribution.sql`.
- [x] Tests added: `lib/feed/attribution.test.ts` covers replayed batches, multiple-post attribution, self-attribution exclusion, expired windows, and refund reversal.
- [x] Verification result: targeted `eslint` passed on the changed files; targeted `vitest` passed for the new attribution tests and feed route test; full `npm.cmd test` passed with 45 files and 491 tests; `npm.cmd run build` passed.
- [x] Remaining external dependency: none for the local implementation.
- [x] Known limitation: client-side emission is currently focused on impressions and high-signal actions from the feed surface; deeper event hooks on downstream commerce pages will be added with the remaining analytics work.

### Slice 6: Video Quota, Archive, Restore, Delete, and Media Lifecycle

- [x] Completed work: added server-authoritative active-video quota helpers and config loading, quota-aware publish enforcement with database-side ownership checks, vendor video library endpoints, archive/restore/delete/bulk lifecycle routes, a retry-processing route, stale-content suggestions, cleanup diagnostics, conservative media cleanup, quota-aware management UI, archive suggestions UI, quota warnings, and restore safety for suspended vendors.
- [x] Files changed: `supabase/migrations/109_feed_video_lifecycle.sql`, `lib/feed/video-management.ts`, `lib/feed/lifecycle.ts`, `lib/feed/posts.ts`, `lib/authz-policy.ts`, `app/api/feed/video-quota/route.ts`, `app/api/feed/videos/route.ts`, `app/api/feed/stale-suggestions/route.ts`, `app/api/feed/cleanup/diagnostics/route.ts`, `app/api/feed/posts/[id]/route.ts`, `app/api/feed/posts/[id]/archive/route.ts`, `app/api/feed/posts/[id]/restore/route.ts`, `app/api/feed/posts/[id]/retry-processing/route.ts`, `app/api/feed/posts/bulk-archive/route.ts`, `app/api/feed/posts/bulk-restore/route.ts`, `app/api/feed/posts/bulk-delete/route.ts`, `app/vendor-dashboard/page.tsx`, `app/vendor-dashboard/videos/page.tsx`, `app/vendor-dashboard/videos/videos-client.tsx`.
- [x] Tests added: `lib/feed/quota.test.ts`, `lib/feed/video-management.test.ts`, `app/api/feed/posts/[id]/restore/route.test.ts`.
- [x] Verification result: targeted `eslint` passed on all touched slice files; targeted `vitest` passed for the new quota/lifecycle/route tests; full `npm.cmd test` passed with 47 files and 497 tests; `npm.cmd run build` passed.

### Slice 7: Premium Foundation

- [x] Completed work: centralized Premium entitlement resolution in `lib/premium.ts`; added explicit Premium states and fallback policies; introduced versioned plan snapshots and normalized Premium config/override tables; wired server-side entitlement resolution into the video quota path; completed the Premium landing page with disabled checkout messaging; added admin config and entitlement override handling; exposed premium plan/config/admin routes; and updated vendor surfaces to show locked or available Premium capabilities without faking functionality.
- [x] Files changed: `supabase/migrations/110_premium_foundation.sql`, `lib/premium.ts`, `lib/premium.test.ts`, `lib/feed/video-management.ts`, `app/api/premium/plans/route.ts`, `app/api/premium/plans/route.test.ts`, `app/api/feed/video-quota/route.test.ts`, `app/api/super-admin/premium/route.ts`, `app/api/super-admin/premium/route.test.ts`, `app/premium/page.tsx`, `app/vendor-dashboard/videos/videos-client.tsx`.
- [x] Tests added: Premium resolver coverage for free tier, active subscriptions, grace/past-due/canceled/expired states, fallback policies, and explicit entitlement overrides; public Premium plans route test; video quota route test; super-admin Premium config and override tests.
- [x] Verification result: targeted `eslint` passed on the changed Premium files; targeted `vitest` passed for the new Premium and quota route tests; full `npm.cmd test` passed with 51 files and 507 tests; `npm.cmd run build` passed.
- [x] Remaining external dependency: Slice 8 Paystack billing is still required before Premium checkout can be activated.
- [x] Known limitation: the Premium purchase CTA is intentionally disabled and the admin surface currently updates the local Premium config and entitlement records only; live billing, renewal, and webhook activation are deferred to Slice 8.

### Slice 8: Paystack Premium and Boost Billing

- [x] Completed work: separated Premium and boost billing from marketplace/order payments; added server-side Paystack initialization for Premium subscriptions and boost purchases; added dedicated Premium and boost payment-event tables plus a billing ledger and diagnostics table; wired the shared webhook to route `PREMIUM_SUBSCRIPTION` and `BOOST_PURCHASE` events into isolated billing handlers; added verified activation/failure handling for `user_subscriptions` and `boost_campaigns`; added vendor Premium checkout UI and a vendor boost purchase page; added a super-admin billing diagnostics route; and kept legacy order and wallet webhooks untouched.
- [x] Files changed: `lib/paystack/billing.ts`, `lib/paystack/webhook.ts`, `supabase/migrations/111_paystack_billing.sql`, `app/api/premium/subscribe/route.ts`, `app/api/premium/subscribe/route.test.ts`, `app/api/boosts/route.ts`, `app/api/boosts/route.test.ts`, `app/api/super-admin/payments/route.ts`, `app/api/super-admin/payments/route.test.ts`, `app/api/paystack/webhook/route.ts`, `lib/authz-policy.ts`, `app/premium/page.tsx`, `components/premium/purchase-actions.tsx`, `components/boosts/boost-checkout-form.tsx`, `app/vendor-dashboard/boosts/page.tsx`, `app/vendor-dashboard/page.tsx`, `lib/paystack/webhook.billing.test.ts`.
- [x] Tests added: Premium subscribe route test, boost checkout route test, super-admin billing diagnostics route test, and webhook billing-routing test.
- [x] Verification result: targeted verification pending immediately after implementation; next step is ESLint, focused Vitest, full test suite, and build.
- [x] Remaining external dependency: live Paystack activation still depends on the configured Paystack keys, webhook secret, and production callback domain.
- [x] Known limitation: marketplace/order payments still use their existing settlement path by design; Premium and boost billing are isolated on separate event tables and ledger entries, but broader admin tooling for refunds, renewals, and campaign operations will continue in later slices.

## Repository Reality Check

### Already in place

- Next.js app router stack.
- Supabase-backed data access with server-side service role client.
- Custom phone OTP + JWT session architecture in httpOnly cookies.
- Server-side role detection for customer, vendor, rider, admin, and super admin.
- Existing Paystack init and webhook handling.
- Existing audit and security event logging.
- Existing feature-flag system stored in `settings`.
- Existing vendor ranking, wallet, rewards, notifications, and admin surfaces.

### Not yet in place for LumeX Feed

- No feed/post/social schema yet.
- No post composer or feed UI yet.
- No feed ranking service yet.
- No social follow/block/mute/report models yet.
- No TikTok or Google social-sync provider adapters yet.
- No Premium entitlement service yet.
- No feed analytics or attribution pipeline yet.
- No moderation tooling for feed content yet.
- No super-admin controls for feed ranking, feed tabs, or premium influence yet.

### Important repo note

There are already uncommitted changes in the worktree unrelated to this file. They must be preserved.

## Current Architecture

- Framework: Next.js `16.2.6`
- Runtime: React `19.2.4`
- Database: Supabase/Postgres
- Auth: custom OTP + JWT session cookie, backed by `sessions` and `otp_attempts`
- Payments: Paystack server-side init + webhook verification
- Server authorization: explicit route guards plus helper gates in `lib/authz.ts`
- Feature flags: `settings` table, read through `lib/features.ts`
- Security logging: append-only `security_events` spine

## Core Existing Models

### Identity and roles

- `customers`
- `vendors`
- `riders`
- `admins`
- `sessions`
- `otp_attempts`

### Commerce

- `orders`
- `order_items`
- `payments`
- `refunds`
- `vendor_subscriptions`
- `processed_webhooks`

### Wallet and incentives

- `wallet_balances`
- `wallet_transactions`
- `customer_wallet_transactions`
- `reward_credits`
- `reward_ledger`
- `surprise_rewards`

### Operations and trust

- `vendor_scores`
- `ratings`
- `audit_logs`
- `super_audit_logs`
- `notifications`
- `security_events`

## Design Decisions

### Product scope

- Keep commerce central.
- Support X-style conversation patterns, but orient discovery toward vendor pages, menu items, promotions, orders, referrals, and rewards.
- Preserve the existing food-commerce domain and extend it safely.

### Data strategy

- Add social-feed tables additively.
- Do not rename or destructively repurpose current commerce tables.
- Keep authoritative pricing in menu or promotion records, never in a post-local price field.

### Entitlements

- Add a central entitlement service instead of scattering Premium checks across UI.
- Enforce entitlements on the server and mirror them in UI.

### Ranking

- Implement ranking in a single audited service.
- Keep ranking explainable and versioned.
- Prevent paid boosts from bypassing safety, moderation, blocking, stock, or geography.

### External providers

- Treat TikTok and Google as provider integrations with explicit consent, scopes, token storage, revoke/disconnect flows, and clear failure states.
- Never claim an external provider feature works until it is actually wired, authorized, and tested.

## Implementation Checklist

### Discovery and foundation

- [x] Read README and package metadata.
- [x] Inspect repository structure.
- [x] Identify auth, DB, payments, feature flags, and security logging.
- [x] Inspect current user/vendor/rider/order/payment/admin models.
- [x] Confirm existing worktree changes are preserved.
- [ ] Inspect unfinished feed/social/premium code paths in full detail.
- [ ] Confirm any existing media-upload and storage helpers that can be reused.
- [ ] Inspect current notification hooks for feed-triggered events.
- [ ] Inspect current audit logging patterns for reversible moderation and monetization actions.
- [ ] Inspect current Supabase RLS and server-authorization patterns for new feed tables.
- [ ] Inspect current admin routing patterns for control-centre screens.

### Role coverage

- [ ] Customer flow has feed browse, save, report, block, mute, follow, reply, repost, share, and commerce actions.
- [ ] Vendor owner flow has posting, menu attachment, promotions, boosts, TikTok sync, analytics, archiving, and entitlement checks.
- [ ] Vendor staff flow has only the scoped actions allowed by vendor policy.
- [ ] Rider flow has rider-profile tabs, referral rewards, creator rewards, mission visibility, and privacy-safe posting controls.
- [ ] Moderator flow has queue review, limited-reach actions, hide/remove actions, and escalation paths.
- [ ] Super Admin flow has feature flags, ranking controls, premium controls, provider controls, analytics, audit logs, and rollbacks.
- [ ] Lumi flow has narrowly scoped tools, confirmations for irreversible actions, and no unrestricted data access.

### Schema additions

- [ ] Add social profile model.
- [ ] Add follow, block, mute, bookmark, repost, like, reply, mention, hashtag, and report tables.
- [ ] Add post, post media, post menu item, post promotion, and imported provider reference tables.
- [ ] Add feed impression and feed event tables with idempotency support.
- [ ] Add algorithm config and algorithm version tables.
- [ ] Add social connection, OAuth token, provider video, and consent tables.
- [ ] Add premium plan, plan version, entitlement, and subscription tables.
- [ ] Add boost package and boost campaign tables.
- [ ] Add ledger and reward tables if missing for attribution and payouts.
- [ ] Add moderation report and moderation action tables.
- [ ] Add feature-flag audit support for feed and premium controls.
- [ ] Add indexes for feed timelines, ownership joins, moderation queries, and attribution queries.
- [ ] Add soft-delete and archive fields where content should be restorable.
- [ ] Add enum/check constraints for post status, media type, connection state, and moderation state.
- [ ] Add foreign keys for user, vendor, rider, provider, and campaign ownership.
- [ ] Add unique constraints for idempotency and one-connection-per-provider rules where needed.
- [ ] Add timestamps for created, updated, archived, synced, approved, and revoked states.

### Feed product surface

- [ ] Build For You tab.
- [ ] Build Following tab.
- [ ] Build Nearby tab.
- [ ] Build Deals tab.
- [ ] Build Trending tab.
- [ ] Allow Super Admin to enable or disable each tab independently.
- [ ] Label sponsored or paid placements clearly.
- [ ] Prevent feed clutter from one vendor dominating a page.
- [ ] Hide archived posts from normal feeds.
- [ ] Keep drafts separate from published content.
- [ ] Ensure public profiles never expose private orders.
- [ ] Ensure bookmarks/saved content stay private to the user.

### API additions

- [ ] Add feed timeline endpoints with cursor pagination.
- [ ] Add post create/edit/delete/archive/restore endpoints.
- [ ] Add composer draft save and upload-progress support.
- [ ] Add follow/block/mute/bookmark/repost/like/reply endpoints.
- [ ] Add reporting and moderation endpoints.
- [ ] Add feed analytics ingestion endpoints with dedupe and server-side attribution.
- [ ] Add ranking simulation and version-rollback endpoints for Super Admin.
- [ ] Add Premium plan management and entitlement endpoints.
- [ ] Add TikTok connect/callback/reconnect/disconnect/sync endpoints.
- [ ] Add Google connect/callback/disconnect and connected-apps endpoints.
- [ ] Add boost purchase and activation endpoints.
- [ ] Add rider rewards and customer rewards endpoints where tied to feed conversion.
- [ ] Add block and mute endpoints that are server-authorized and reversible where applicable.
- [ ] Add save/bookmark endpoints with privacy protection.
- [ ] Add follow/unfollow endpoints with server-side ownership checks.
- [ ] Add quote-post endpoints if supported safely by the current schema.
- [ ] Add menu-item availability checks so posts can show `Currently unavailable`.
- [ ] Add server-side post publish gating for quota, moderation, entitlement, and safety.
- [ ] Add feed action deduplication and idempotency keys.

### UI additions

- [ ] Build primary feed page with tabs for For You, Following, Nearby, Deals, and Trending.
- [ ] Build mobile-first feed cards with commerce actions.
- [ ] Build post composer with text, images, video, menu items, promotions, hashtags, mentions, and drafts.
- [ ] Build profile pages for customer, vendor, rider, moderator, and admin views where needed.
- [ ] Build archive manager and active-video quota UI.
- [ ] Build TikTok connection and selection UI.
- [ ] Build connected-apps screen for Google authorization.
- [ ] Build Premium plans and entitlement management surfaces.
- [ ] Build Super Admin feed controls and ranking tools.
- [ ] Build moderation queue and action surfaces.
- [ ] Build empty states for new account, empty feed, no nearby vendors, no deals, and no following.
- [ ] Build error states for offline, slow connection, upload failure, token expiration, and payment failure.
- [ ] Build active-video limit reached state with archive and delete choices.
- [ ] Build menu-item unavailable state with disabled order button.
- [ ] Build vendor-closed state and rider-earnings-under-review state.
- [ ] Build privacy screens for connected providers and data deletion.

### Security controls

- [x] Keep session auth server-authoritative.
- [x] Keep role checks server-side.
- [x] Keep Paystack verification on the server.
- [ ] Ensure every new feed mutation has authorization, validation, rate limiting, and idempotency.
- [ ] Ensure provider tokens are encrypted at rest.
- [ ] Ensure provider callbacks validate state and PKCE where applicable.
- [ ] Ensure uploads validate MIME type, file signature, size, and duration.
- [ ] Ensure feed events cannot directly award money.
- [ ] Ensure moderation and paid placement cannot bypass safety filters.
- [ ] Ensure client-supplied role, premium, ownership, balance, reward entitlement, or vendor status values are ignored.
- [ ] Ensure paid boosts cannot bypass blocking, muting, stock, geography, or moderation.
- [ ] Ensure provider data is treated as untrusted content, not instructions.
- [ ] Ensure destructive actions require deliberate confirmation.
- [ ] Ensure external provider credentials are never returned to the browser.
- [ ] Ensure every irreversible action has audit history and a rollback path where applicable.
- [ ] Ensure limiter, replay, and dedupe behavior exists on feed analytics and provider sync endpoints.

### Ranking engine

- [ ] Add a central ranking module.
- [ ] Version ranking configurations.
- [ ] Add explainable signal breakdowns.
- [ ] Add configurable weights for proximity, freshness, engagement, menu CTR, add-to-cart, order conversion, vendor reliability, premium uplift, sponsored uplift, and penalties.
- [ ] Add diversity rules for consecutive posts and vendor saturation.
- [ ] Add exploration logic for new creators.
- [ ] Add safe defaults and rollback.
- [ ] Add simulation against sample posts.
- [ ] Add audit log for ranking changes.
- [ ] Make organic relevance capable of outranking paid placement.

### Premium system

- [ ] Add global enable/disable controls.
- [ ] Add UI hide toggle.
- [ ] Add pause new subscriptions control.
- [ ] Add preserve-existing-benefits policy control.
- [ ] Add immediate-disable policy control.
- [ ] Add free trial controls.
- [ ] Add promo-code controls.
- [ ] Add plan name, description, monthly price, yearly price, currency, audience, version, effective date, and display order.
- [ ] Add plan-level entitlement mapping.
- [ ] Add central `hasEntitlement`-style service.
- [ ] Add vendor-facing TikTok entitlement toggle.
- [ ] Add premium active-video quota rules.
- [ ] Add premium visibility uplift and analytics rules.

### TikTok connection

- [ ] Add official OAuth/Login Kit flow only.
- [ ] Add PKCE and state validation where required.
- [ ] Add secure callback handling.
- [ ] Add encrypted token storage.
- [ ] Add token refresh and expiration handling.
- [ ] Add disconnect and revoke flow.
- [ ] Add scope tracking and audit logging.
- [ ] Add public-video listing and selection picker.
- [ ] Add selection quota enforcement.
- [ ] Add manual selection as default.
- [ ] Add draft-review mode for auto-discovered videos if supported.
- [ ] Add unavailable/private/deleted video handling.
- [ ] Add source attribution in UI so the origin is always visible.
- [ ] Do not scrape, mirror, or auto-import beyond approved API terms.

### Google connection

- [ ] Keep Google sign-in separate from Google data authorization.
- [ ] Add connected-apps area.
- [ ] Add optional Calendar integration.
- [ ] Add optional Drive integration via least-privilege flow or file picker.
- [ ] Keep Gmail disabled behind a feature flag until explicitly approved.
- [ ] Add consent and scope records.
- [ ] Add disconnect and revocation flow.
- [ ] Add token rotation handling.
- [ ] Add provider error states.
- [ ] Add clear explanation of what each scope accesses.

### Lumi agent

- [ ] Add tool-based architecture.
- [ ] Add narrow tools for searching vendors, menu items, orders, cart, premium plans, analytics, drafts, selections, archive candidates, rider earnings, customer rewards, and connected apps.
- [ ] Add action confirmations for order placement, charges, publishing, deletion, disconnects, withdrawals, payout changes, mission acceptance, and external sending.
- [ ] Add prompt-injection defenses for provider content.
- [ ] Add permission screen for what Lumi can access.
- [ ] Add memory and connected-data deletion controls.
- [ ] Add multilingual and informal Nigerian-English handling.
- [ ] Add graceful fallback for casual chat instead of narrow intent rejection.

### Monetization, rewards, and boosts

- [ ] Add Paystack-backed premium purchase flow.
- [ ] Add one-time boost purchase flow.
- [ ] Add sponsored campaign setup and activation.
- [ ] Add server-side verification before enabling benefits.
- [ ] Add immutable ledger entries for all monetary movements.
- [ ] Add attribution windows and self-order/duplicate-account exclusions.
- [ ] Add rider referral rewards.
- [ ] Add rider creator rewards.
- [ ] Add rider mission rules and participation records.
- [ ] Add customer rewards, caps, and fraud checks.
- [ ] Add reward reversal capability.
- [ ] Add refund, reversal, settlement, and reconciliation visibility.

### Moderation and safety

- [ ] Add reports for harassment, spam, impersonation, misleading content, copyright, privacy, explicit content, scams, and prohibited goods.
- [ ] Add post states for draft, processing, published, limited, under review, rejected, archived, and deleted.
- [ ] Add moderation actions for remove, limit reach, warn, suspend posting, suspend account, restore, and appeal.
- [ ] Add auditable reason capture.
- [ ] Add user notification for moderation outcomes where appropriate.
- [ ] Add block and mute behavior so offending creators no longer appear.
- [ ] Add spam and fake engagement resistance.

### Analytics and attribution

- [ ] Add impression and qualified impression events.
- [ ] Add video-start and completion quartile events.
- [ ] Add rewatch, dwell time, like, unlike, reply, repost, save, share, profile-visit, follow, menu-click, add-to-cart, checkout-start, completed-order, refunded-order, cancelled-order, report, not-interested, hide-creator, and block events.
- [ ] Add dedupe and idempotency for each event stream.
- [ ] Keep revenue attribution server-side from authoritative order and payment records.
- [ ] Add vendor analytics views for reach, watch time, completion, engagement, profile visits, menu clicks, add-to-cart, orders, revenue, followers, and funnel.

### Performance and accessibility

- [ ] Add cursor pagination.
- [ ] Add lazy loading and offscreen media pausing.
- [ ] Add muted autoplay that respects browser policy.
- [ ] Add data-saver support.
- [ ] Add poster images and mobile-first bandwidth-conscious media delivery.
- [ ] Add keyboard navigation and screen-reader labels.
- [ ] Add focus states and reduced-motion support.
- [ ] Add captions, alt text, and accessible dialogs.

### Notifications

- [ ] Add notifications for follower, reply, repost, mention, performance milestone, attributed order, renewal, payment failure, provider expiration, boost activation, boost completion, rider reward, mission, customer reward, and moderation outcomes.
- [ ] Add notification preferences.
- [ ] Avoid noisy default spam.

### Testing

- [ ] Add unit tests for ranking, entitlements, quota logic, and attribution.
- [ ] Add integration tests for feed mutations and provider callback flows.
- [ ] Add integration tests for webhook-style idempotency.
- [ ] Add end-to-end tests for composer, feed browsing, quotas, archiving, and provider disconnect flows.
- [ ] Run type checking, linting, unit tests, integration tests, and production build after each coherent slice.
- [ ] Add tests for unauthorized access, cross-account access, and server-only ownership checks.
- [ ] Add tests for archive restore and quota exhaustion behavior.
- [ ] Add tests for TikTok and Google revoked-token states.
- [ ] Add tests for premium disable fallback behavior.
- [ ] Add tests for blocked and muted creator visibility.
- [ ] Add tests for replayed Paystack or feed-event messages.

## Database Additions Plan

### Feed domain

Likely tables:

- `social_profiles`
- `follows`
- `blocks`
- `mutes`
- `posts`
- `post_media`
- `post_menu_items`
- `post_promotions`
- `post_likes`
- `post_replies`
- `reposts`
- `bookmarks`
- `hashtags`
- `post_hashtags`
- `mentions`
- `feed_impressions`
- `feed_events`
- `post_audience_rules`
- `post_status_history`
- `post_archives`

### Ranking and analytics

Likely tables:

- `algorithm_configs`
- `algorithm_versions`
- `algorithm_change_audit`
- `feed_simulations`
- `ranking_weight_history`
- `feed_explanations`

### Provider sync

Likely tables:

- `social_connections`
- `oauth_tokens`
- `provider_videos`
- `imported_post_references`
- `connected_data_consents`
- `connected_data_references`
- `provider_sync_runs`
- `provider_sync_errors`

### Monetization

Likely tables:

- `premium_plans`
- `plan_versions`
- `subscriptions`
- `entitlements`
- `user_entitlements`
- `boost_packages`
- `boost_campaigns`
- `ledger_accounts`
- `ledger_entries`
- `reward_rules`
- `reward_events`
- `referral_codes`
- `referral_attributions`

### Moderation and safety

Likely tables:

- `moderation_reports`
- `moderation_actions`
- `feature_flag_audits`
- `moderation_appeals`
- `content_blocks`

## API Additions Plan

### Feed

- `GET /api/feed`
- `POST /api/feed/posts`
- `PATCH /api/feed/posts/[id]`
- `DELETE /api/feed/posts/[id]`
- `POST /api/feed/posts/[id]/like`
- `POST /api/feed/posts/[id]/bookmark`
- `POST /api/feed/posts/[id]/repost`
- `POST /api/feed/posts/[id]/reply`
- `POST /api/feed/posts/[id]/report`
- `POST /api/feed/posts/[id]/mute`
- `POST /api/feed/posts/[id]/block`
- `POST /api/feed/posts/[id]/follow`
- `DELETE /api/feed/posts/[id]/follow`

### Composer and media

- `POST /api/feed/drafts`
- `POST /api/feed/uploads`
- `POST /api/feed/uploads/complete`
- `POST /api/feed/posts/[id]/archive`
- `POST /api/feed/posts/[id]/restore`

### Social sync

- `GET /api/social-sync/tiktok/connect`
- `GET /api/social-sync/tiktok/callback`
- `POST /api/social-sync/tiktok/disconnect`
- `POST /api/social-sync/tiktok/sync`
- `GET /api/social-sync/tiktok/status`
- `GET /api/social-sync/google/connect`
- `GET /api/social-sync/google/callback`
- `POST /api/social-sync/google/disconnect`
- `GET /api/social-sync/google/status`

### Premium and monetization

- `GET /api/premium/plans`
- `GET /api/premium/status`
- `POST /api/premium/subscribe`
- `POST /api/premium/cancel`
- `POST /api/boosts`
- `POST /api/boosts/[id]/activate`
- `POST /api/boosts/[id]/pause`
- `POST /api/boosts/[id]/reject`

### Analytics and moderation

- `POST /api/feed/events`
- `GET /api/feed/analytics`
- `GET /api/moderation/reports`
- `POST /api/moderation/reports/[id]/resolve`
- `GET /api/admin/feed/ranking`
- `POST /api/admin/feed/ranking/simulate`
- `POST /api/admin/feed/ranking/activate`
- `POST /api/admin/feed/ranking/rollback`
- `GET /api/admin/feed/ranking/preview`
- `GET /api/admin/feed/flags`
- `PATCH /api/admin/feed/flags/[key]`

## Environment Variables

Existing repository variables already cover the foundation:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_WEBHOOK_SECRET`
- `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
- `ADMIN_PHONE`
- `SUPER_ADMIN_PHONE`
- `CRON_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Likely additions for LumeX Feed:

- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_REDIRECT_URI`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `TOKEN_ENCRYPTION_KEY`
- `APPLICATION_BASE_URL`
- `TIKTOK_OAUTH_SCOPES`
- `GOOGLE_OAUTH_SCOPES`
- `GMAIL_ENABLED`
- `FEATURE_FLAG_DEFAULTS`

## Security Controls

- Authenticate every endpoint.
- Authorize every action from the session on the server.
- Validate with schema validators.
- Rate limit all feed and provider endpoints.
- Use idempotency for mutations and event ingestion.
- Enforce ownership server-side.
- Use encrypted token storage for provider credentials.
- Use state validation and PKCE where applicable for OAuth.
- Prevent client-supplied balances, premium status, reward entitlement, or ownership values from being trusted.
- Keep moderation decisions auditable and reversible.
- Keep paid placement clearly labeled.
- Do not allow paid placement to bypass blocking, muting, safety, or stock rules.
- Do not silently degrade provider permissions into broader access than the user approved.

## External Provider Requirements

### TikTok

- Use official OAuth/Login Kit and Display API only.
- No scraping.
- No silent import of every video.
- Store only permitted metadata and references.
- Handle private, deleted, or unavailable videos.
- Provide disconnect and revoke where supported.

### Google

- Separate Google sign-in from Google data authorization.
- Use least-privilege, incremental authorization.
- Keep Gmail off by default.
- Prefer user-selected Drive files over unrestricted Drive access.
- Provide clear disconnect and scope revocation.

### Paystack

- Keep all transaction init on the server.
- Verify webhook signatures.
- Verify payment results server-side before unlocking benefits.
- Process webhook retries idempotently.
- Keep all amounts in minor currency units.
- Keep pricing changes versioned and auditable.

## Testing Status

Current repo already contains:

- Unit tests for auth, wallet, rewards, ranking, and webhook behavior.
- Integration-style tests around security and money-path behavior.
- E2E-oriented scripts and screenshots for existing commerce flows.

Still needed for LumeX Feed:

- Feed-scoring tests.
- Entitlement tests.
- Quota tests.
- Feed mutation tests.
- Provider callback tests.
- Moderation tests.
- New E2E coverage for composer, archive/restore, and provider sync flows.
- All high-impact actions remain covered by server-side authorization tests.

## Known Limitations

- TikTok and Google integrations depend on provider credentials, app setup, and approval.
- Premium and feed controls cannot be reported as complete until both backend and UI are implemented.
- Existing worktree modifications may already be in progress and must not be overwritten.
- This document is the checklist and architecture record, not the implementation itself.

## Definition of Done

The LumeX Feed work is complete only when:

- UI, backend, persistence, authorization, validation, and tests all exist for each claimed feature.
- Ranking is versioned, explainable, and reversible.
- Premium entitlement logic is centralized and enforced server-side.
- Provider integrations have secure callbacks and failure states.
- Feed events are deduplicated and cannot mint money.
- Moderation and paid boosts cannot bypass safety controls.
- Verification passes with the repository's real commands.

## Checklist Completion Strategy

- [ ] Finish discovery and gap mapping.
- [ ] Implement one vertical slice at a time.
- [ ] Verify types, lint, tests, and build after each slice.
- [ ] Fix root causes instead of suppressing errors.
- [ ] Re-run verification until the slice is clean.
- [ ] Repeat until the whole feed program is complete.
