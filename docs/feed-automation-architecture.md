# Automatic feed architecture

LumeX Fud uses the existing `posts`, `social_profiles`, `post_menu_items`, and
official-feed tables. Migration 155 extends them; it does not create a second
feed. Migration 156 adds authoritative bundle sources, order test/fraud flags,
and explicit area coverage anchors.

## Data flow

1. A committed vendor, menu, inventory, price, or paid-completion transition
   writes a unique event to `feed_automation_outbox`.
2. The database trigger catches and logs enqueue failures without failing the
   marketplace transaction. No post is created in a payment webhook or critical
   order transaction.
3. `/api/cron/official-feed` atomically claims jobs with `FOR UPDATE SKIP
   LOCKED`. Retries therefore cannot claim the same row concurrently.
4. The worker reloads current vendor, storefront, menu, price, availability,
   configuration, order evidence, and vendor opt-out facts.
5. Eligibility, daily limits, cooldown, stable idempotency key, and duplicate
   checks run before deterministic template rendering.
6. The post and menu snapshot are written with full provenance. A failed menu
   link archives the incomplete post rather than leaving a broken CTA.
7. Five failed attempts move a job to `dead`; super admins can inspect and rerun
   it idempotently.
8. The same worker expires pins and disables CTAs whose current item/vendor is
   no longer orderable.

Scheduled official collections fail closed unless latitude, longitude, and a
coverage radius are configured for the area. Vendor coordinates are checked
against that circle before an item can enter a collection.

Bundles use an active `menu_bundles` record and owned `menu_bundle_items`. The
advertised bundle price must equal its available primary menu item, so the feed
CTA enters checkout at the same price shown in the post.

The global setting starts with `enabled = false`. Applying the migration does
not publish anything. Operations must explicitly enable it after validation.

## Provenance and moderation

Automatic posts store generation mode, type, event and entity source, stable
idempotency key, area, generated/published/expiry time, template version,
moderation state, link target, and CTA state. Customer APIs do not return job
payloads, generation audit entries, or internal errors.

Manual posts continue to use `generation_mode = manual`. An automatic vendor
post is authored by that vendor's verified social profile, but deterministic
copy avoids claiming it was personally typed. Official automatic and manual
posts share the single protected official profile and remain distinguishable by
generation mode.

## Availability and historical integrity

Snapshots preserve what was published. Current menu and vendor state controls
orderability. If the source becomes invalid, the worker disables the CTA; it
does not rewrite historical price/name facts. Time-sensitive official
collections receive expiry timestamps.

## Feed supply

Stored posts provide event and scheduled layers. If no post is visible, the
server builds non-persistent discovery cards from currently approved vendors,
available menu items, valid mandatory add-ons, open status, and real
categories. No fallback card fabricates activity or creates duplicate rows.
