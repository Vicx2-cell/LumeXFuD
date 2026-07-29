# Privacy rules for order-derived feed content

Only orders with `payment_status = PAID` and final `DELIVERED` or `COMPLETED`
state may contribute. Refunded, cancelled, test, fraud-flagged, failed, and
pending orders are excluded.

Aggregation is by area, vendor, and menu item over a configured period. A group
must meet the configured anonymity minimum (default five) before it is eligible.
Output contains aggregate count and marketplace entity IDs only. It never
contains customer ID/name, phone, address, room/lodge, exact order time,
instructions, payment reference, or an individual's sequence of actions.

Wording describes aggregated popularity or discovery. It does not imply
scarcity, urgency, an exact live customer action, or that a named individual
ordered. Customer-facing metadata excludes the outbox payload and generation
audit. Access to those tables is service-role only.
