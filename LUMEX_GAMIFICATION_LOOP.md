# LumeX Fud — Gamification & Engagement Loop

How the engagement system works, why it can't break wallet reconciliation, and
how to sequence it across launch phases. Every mechanic is flag-gated and every
reward is a tracked liability in a dedicated kobo ledger.

> **Schema:** migration `082_gamification_loop.sql` (must be run in Supabase).
> **Flags:** registered in `lib/features.ts` (the `settings`-backed catalog the
> super-admin toggles at `/super-admin/features`). There is no separate
> `system_controls` table in this codebase — the `FEATURES` catalog is it.

---

## The integrity model (read this first)

The platform's non-negotiable rule #10 is **daily wallet reconciliation**: the
money in Paystack must cover everything we owe users. Gamification money rewards
were previously *banned* because untracked wallet credits would inflate the
customer-wallet float above the Paystack balance.

We resolve this with a **separate promo-credit liability ledger** — rewards are
**never** dropped into `customer_wallets` as cash:

- `reward_credits` — one row per issued credit "lot" (kobo), with a status
  lifecycle: `ACTIVE → RESERVED → REDEEMED` (or `EXPIRED`/`VOID`).
- `reward_ledger` — append-only, signed double-entry trail (`ISSUE` +,
  `REDEEM`/`EXPIRE`/`VOID` −). Outstanding liability = Σ over the ledger.
- A credit is **redeemed as an order-level discount**, capped so every order
  still clears a **guaranteed minimum platform profit** (`reward_min_profit_kobo`,
  default ₦250) — i.e. `cap = max(0, platform_margin − floor)` where
  `platform_margin = markup + our delivery cut`. **Vendor and rider payouts are
  never touched** (read from `orders.subtotal` / `rider_delivery_cut` /
  `tip_amount`); only platform margin above the floor is given up, so **no order
  is ever subsidized** (Failure Prevention Rule #1). A credit larger than one
  order's cap simply **spreads across future orders**, each still above the floor.
- `customer_wallets` stays exactly backed by Paystack top-ups → **reconciliation
  is untouched.** The reconciliation cron now also *reports* outstanding promo
  liability for exposure visibility, but deliberately keeps it **out** of the
  withdrawal-shortfall freeze math (it isn't custodied user cash).

**Redemption flow (drift-proof):** the order route *reserves* the best eligible
credit after the order row exists and reduces `total_amount` to the net the
customer pays. DB triggers then **commit** the reservation to a real `REDEEM`
when the order hits `payment_status = 'PAID'`, or **release** it back to `ACTIVE`
if the order is cancelled/deleted. Because commit/release are triggers, they fire
once regardless of which pay path (wallet / card / split) settles the order — the
same pattern streaks (037) and the leaderboard (024) use.

---

## Mechanics

### 1. Referral — "The Plug" · flag `referral` · **ON at launch**
- **Reward:** referrer **+** new user both get a credit on the new user's **1st**
  and **2nd** completed order. Defaults: referrer ₦300 each time, new user ₦200
  (settings `referral_reward_referrer_kobo` / `referral_reward_referred_kobo`).
- **How:** each customer has a unique code (`referral_codes`); `/auth/register?ref=CODE`
  attaches a `referrals` row at sign-up via the `attach_referral` RPC. The
  `trg_order_completed_rewards` trigger issues both credits on the referred
  user's 1st/2nd `COMPLETED` order.
- **Abuse guards:** schema `CHECK (referrer_id <> referred_id)` (no self-referral);
  `UNIQUE (referred_id)` (one referral per genuine new account); rewards keyed by
  unique `source_ref` so they can't be issued twice; all validation server-side;
  sign-up IP/device recorded for review; rewards only on **completed** (paid &
  settled) orders, so a fake order can't farm them.
- **Analytics:** `referral_sent` (attach), `referral_converted` (milestone 1/2).

### 2. Loyalty tiers · flag `loyalty_tiers` · **ON at launch**
- **Reward:** Bronze / Silver / Gold from **completed orders in the last 30 days**
  (`tier_silver_orders_30d` = 8, `tier_gold_orders_30d` = 20). Silver/Gold unlock
  a **monthly free-delivery credit** (`tier_free_delivery_kobo`, idempotent per
  tier+month). Progress bar on Profile.
- **How:** `recompute_customer_tier` runs on every `COMPLETED` order (trigger).
  Tier state is stored server-side in `customer_tiers`.
- **Abuse guards:** recomputed server-side from real completed orders; the monthly
  perk credit is idempotent (`source_ref = tier:<TIER>:<customer>:<YYYY-MM>`).
- **Analytics:** `tier_up`.

### 3. Surprise reward (scratch) · flag `surprise_reward` · **ON at launch**
- **Reward:** a server-decided discount rolled after each completed order — odds
  55% nothing / 27% ₦100 / 14% ₦200 / 4% ₦500. Expires in 7 days
  (`surprise_reward_expiry_days`).
- **How:** `roll_surprise_reward` (trigger) creates an `UNOPENED` row with the
  outcome **fixed at creation**. The customer opens it (`POST /api/rewards/surprise/[id]/open`),
  which only *reveals* it and issues the credit if it's a win.
- **No dark patterns:** outcome is decided before opening (no "you almost won"),
  expiry is enforced server-side, one prize per order, single-claim (UNOPENED→OPENED lock).
- **Analytics:** `reward_claimed` (phase `issued` / `opened`).

### 4. One-tap reorder ("Your Usual") · **ON at launch (already shipped)**
- `components/reorder-button.tsx` + `POST /api/orders/[id]/reorder`: rebuilds the
  cart from a past order, server-priced, availability-checked, ownership-bound,
  rate-limited. No changes needed — included here for completeness.

### 5. Weekly streak challenges · flag `streak_challenges` · **OFF until density**
- **Planned reward:** weekly order-streak challenge paying a free-delivery
  voucher; forgiving (1 grace/week), never shames, never nudges unaffordable spend.
- **Status:** flag scaffolded; **not yet wired.** Builds on the existing cosmetic
  streak engine (`lib/streaks.ts`, migration 037). Flip on at **≥ 30 orders/day
  sustained for 7 days** — below that a "streak" is empty/dispiriting.
- **Analytics (reserved):** `streak_continue`, `streak_break`.

### 6. Hostel-vs-hostel leaderboard · flag `hostel_leaderboard` · **OFF until density**
- **Planned:** weekly leaderboard grouped by `customers.hostel` (the column
  already exists), privacy-safe (masked display names, never personal data —
  reuse `maskPerson` in `app/leaderboard/page.tsx`).
- **Status:** flag scaffolded; **not yet wired.** Flip on once **multiple hostels
  each have ≥ ~20 orders/week**, otherwise it's a one-hostel walkover.
- **Analytics:** `leaderboard_view` (already emitted on the individual board).

---

## Analytics

All funnel events land in `gamification_events` (append-only, aggregate-friendly,
`customer_id` server-side only — never exposed to other users). Emitted by DB
triggers (issue/convert/tier-up) and app code (`trackGamification` for
`leaderboard_view`, surprise `opened`). Measure conversion (referral_sent →
referral_converted), tier movement, and reward uptake against repeat-order rate.
**Anything we can't measure gets cut.**

---

## Launch sequencing — default flags

| Flag | Default | Flip-on threshold |
|---|---|---|
| `referral` | **ON** | works from user #1 |
| `loyalty_tiers` | **ON** | works from user #1 |
| `surprise_reward` | **ON** | works from user #1 |
| reorder | **ON** (no flag) | already live |
| `streak_challenges` | **OFF** | ≥ 30 orders/day for 7 consecutive days |
| `hostel_leaderboard` | **OFF** | ≥ ~20 orders/week in 2+ hostels |
| vendor subscription | (existing) | per the 30-30-30 expansion rule |

Tune any reward amount/threshold live via the `settings` rows seeded in migration
082 — no redeploy.

---

## Files

**New:** `supabase/migrations/082_gamification_loop.sql`, `lib/rewards.ts`,
`app/api/rewards/route.ts`, `app/api/rewards/surprise/[id]/open/route.ts`,
`components/rewards-card.tsx`, `components/cart-reward-hint.tsx`, this doc.

**Edited:** `lib/features.ts` (5 flags), `lib/validators.ts` (`apply_reward`,
`referral_code`), `app/api/orders/route.ts` (reserve + net-total split),
`app/api/auth/register/route.ts` (attach referral), `app/auth/register/page.tsx`
(capture `?ref=`), `app/profile/profile-client.tsx` (mount card),
`app/cart/page.tsx` (reward hint), `app/leaderboard/page.tsx` (`leaderboard_view`),
`app/api/cron/wallet-reconciliation/route.ts` (report promo liability).

## Known follow-ups (not in this pass)
- Google sign-up doesn't attach a referral code yet (`/api/auth/social/complete`).
- Wire `streak_challenges` and `hostel_leaderboard` when density thresholds hit.
- Optional: show the reward discount as its own line on the order receipt.
- Optional: a `/super-admin` panel reading `gamification_events` for funnels.
