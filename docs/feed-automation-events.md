# Automatic feed event catalogue

| Type | Source and trigger | Required evidence | Dedupe |
| --- | --- | --- | --- |
| `vendor_welcome` | Approval or later eligible menu event | Approved, active, complete storefront and at least one available item | Once per vendor |
| `new_menu_item` | New publicly available menu row | Live vendor and valid current item/price | Once per item event; menu batching window is configurable |
| `item_back_in_stock` | unavailable → available | Minimum verified paid/completed item orders and cooldown | Event key plus topic cooldown |
| `price_drop` | current price decreases | Minimum amount or basis-point reduction | Event key plus topic cooldown |
| `new_bundle` | Active bundle publication | Live bundle, components, price, vendor | Once per bundle publication |
| `popular_item` | Verified order threshold crossing | Paid/completed, non-refunded aggregate | Once per threshold |
| `vendor_reopened` | CLOSED → OPEN after meaningful closure | Approved, active, available menu | Topic cooldown |
| `order_milestone` | Paid completed-order count reaches configured value | Exact configured count | Once per vendor/milestone |
| `cheap_eats` | Scheduled official area window | Honest minimum orderable price including required add-ons | Once per area/window |
| `breakfast_collection` | Morning window | Available suitable items | Once per area/window |
| `lunch_collection` | Lunch window | Available suitable items | Once per area/window |
| `evening_collection` | Evening window | Available suitable items | Once per area/window |
| `late_night_collection` | After configured cutoff | Vendor genuinely open and accepting orders | Once per area/window |
| `new_on_lumex` | Scheduled/event collection | Newly approved live vendors or menus | Source event/window |
| `popular_near_you` | Area order aggregate | Paid/completed orders and anonymity threshold | Area/window |
| `back_in_stock` | Scheduled returned-stock aggregate | Meaningful return evidence | Area/window |
| `lumex_picks` | Scheduled transparent rules | Live eligibility, fair rotation, no undisclosed sponsorship | Area/window |
| `order_activity_collection` | Area aggregate | Minimum anonymous valid orders | Area/window |

Cancelled, unpaid, failed, refunded, test, fraud-flagged, or individually
identifiable customer activity is never eligible. The migrations install
durable triggers for approval, menu creation, stock return, price reduction, and
paid completion. Migration 156 adds the authoritative `menu_bundles` and
`menu_bundle_items` source tables and emits `new_bundle` only when a real bundle
is activated.
