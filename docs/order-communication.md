# Order Communication System

## Scope

Every conversation belongs to one order and one rider assignment. The only
channels are:

- `CUSTOMER_RIDER`
- `VENDOR_RIDER`

There is no customer/vendor channel, inbox, user search, or cross-order API.
Admins can read transcripts only for orders that have a dispute; staff cannot
send participant messages.

## Authorization model

LumeX app sessions use the existing httpOnly JWT. All browser operations call
authenticated server routes. The server uses service-role Supabase access only
after object-level ownership checks, then calls row-locking database functions
that recheck the actor against the current `orders.rider_id` in the same
transaction as the read/write.

Direct Supabase access is read-only, RLS-protected, and derived from the signed
Supabase JWT phone claim. Anon access and direct participant writes are revoked.

When `orders.rider_id` changes, the database trigger archives both former
conversations and creates versioned conversations for the new rider. Historical
threads remain immutable and are visible only in dispute review.

## Close window

`settings.id = 'order_chat_grace_period'` contains `{ "minutes": 60 }` by
default. For delivered/completed/disputed/refunded orders, the clock starts at
`delivered_at`; for cancelled orders it starts at `cancelled_at`. A terminal
order without a valid timestamp fails closed. History stays readable after the
deadline, but user sends return `409`.

## Transport and APIs

- `GET|POST /api/orders/[id]/messages`
- `PATCH /api/orders/[id]/messages/read`
- `GET /api/orders/[id]/messages/stream`
- `GET /api/order-communications/unread`
- `GET /api/admin/disputes/[id]/messages` (read-only)

The event stream relays only the authorized conversation. It rechecks session
liveness and current assignment every five seconds and also subscribes to order
and conversation changes so reassignment closes the stream immediately.

Messages are capped at 300 characters, stripped of links/phone numbers/markup,
idempotent by client UUID, immutable, and limited to 12 sends per participant
per order per minute by both Upstash and a serialized database fallback.

## Migrations

Apply migrations `122` through `129` in numeric order before deploying the app.
The migrations create the schema, RLS, Realtime publication, unread aggregate,
lifecycle trigger, dispute policies, indexes, and atomic authorization RPCs.

## Rollback

Application rollback is safe by redeploying the previous Vercel build; the new
tables are additive and unused by older code. Do not drop message tables during
an incident because transcripts are dispute evidence. After app rollback,
disable new writes by setting `order_chat_grace_period` minutes to `0` if needed,
then remove the `orders_communication_lifecycle` trigger only if assignment
updates are being affected. Schema removal requires a separately reviewed data
retention/export plan.
