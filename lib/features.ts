import { createSupabaseAdmin } from './supabase/server'

// Feature flags live in the existing `settings` table (TEXT id + JSONB value),
// keyed `feature.<key>` with value { enabled: boolean }. A missing row means
// "use the catalog default", so toggles work before any row exists.

export interface FeatureDef {
  key: string
  label: string
  description: string
  default: boolean
  /** True if the server actually enforces this flag (not just display). */
  enforced: boolean
}

export const FEATURES: FeatureDef[] = [
  { key: 'ai',           label: 'AI features (master)', description: 'MASTER kill switch for everything that spends AI credit (Gemini OR Anthropic — whichever is active in Controls) — Lumi, leaderboard captions, dispute concierge, Sentinel, vendor/rider AI, menu reader, study ingestion, and more. OFF = zero AI API calls anywhere (no credit used). Turn ON only when the active provider has credit.', default: false, enforced: true },
  { key: 'ordering',     label: 'Ordering',        description: 'Allow customers to place new orders. Off = checkout is paused platform-wide.', default: true,  enforced: true },
  { key: 'signups',      label: 'New sign-ups',    description: 'Allow new customer accounts to be created.',                                       default: true,  enforced: true },
  { key: 'phone_verification', label: 'Phone verification (OTP)', description: 'Require new customers to verify their phone by OTP before sign-up. Turn OFF only while OTP delivery (Sendchamp) is unavailable — accounts created while off have an unverified phone.', default: true, enforced: true },
  { key: 'google_login', label: 'Continue with Google', description: 'Show the "Continue with Google" button on login + sign-up. New Google users still add and verify a phone, so we capture the same info as a phone sign-up. Needs GOOGLE_OAUTH_CLIENT_ID/SECRET set — keep OFF until configured.', default: false, enforced: true },
  { key: 'customer_wallet_enabled', label: 'Customer Wallet (top-up & pay-from-balance)', description: 'CUSTOMER-only LumeX Wallet: balance display, top-up (incl. parent/sponsor top-up) and pay-from-balance at checkout. OFF = the wallet disappears everywhere in the customer app and customers pay per order via Paystack; existing balances are preserved (hidden) and restored when re-enabled. Vendor & rider wallets/earnings are a separate system and are NOT affected.', default: false, enforced: true },
  { key: 'leaderboard',  label: 'Leaderboard',     description: 'Show the campus leaderboard and its bottom-nav tab.',                              default: true,  enforced: true },
  { key: 'streaks',      label: 'Streaks & badges', description: 'Show order streaks and achievement badges on customer profiles. Off = the panel is hidden (badges keep accruing in the background).', default: true, enforced: false },
  { key: 'referral',     label: 'Referral ("The Plug")', description: 'Both-sided referral: the referrer AND the new user each earn a reward credit on the new user’s 1st and 2nd completed order. Off = the share card is hidden and no new referrals are attached at sign-up (existing rewards still redeem).', default: true, enforced: true },
  { key: 'loyalty_tiers', label: 'Loyalty tiers', description: 'Bronze/Silver/Gold customer tier from 30-day completed orders, with a progress bar; Silver/Gold unlock a monthly free-delivery credit. Off = the tier card is hidden (tier still recomputes in the background).', default: true, enforced: false },
  { key: 'surprise_reward', label: 'Surprise reward', description: 'A server-decided scratch reward offered after a completed order (mostly small wins, some none). Outcome is fixed at creation — no fake odds. Off = no new surprises are rolled and the card is hidden.', default: true, enforced: true },
  { key: 'streak_challenges', label: 'Weekly streak challenges', description: 'Weekly order-streak challenges that pay out a free-delivery voucher (forgiving, 1 grace/week). OFF until order density exists — empty/dispiriting with few users. Scaffolded; not yet wired.', default: false, enforced: true },
  { key: 'hostel_leaderboard', label: 'Hostel leaderboard', description: 'Weekly hostel-vs-hostel (zone) leaderboard. OFF until enough orders per hostel to be a real contest. Scaffolded; needs a customer zone before it can be wired.', default: false, enforced: true },
  { key: 'demand_forecast', label: 'Demand forecast', description: 'Show the next-hour demand outlook to vendors (prep-ahead banner) and hotspots to riders. Off = both hidden.', default: true, enforced: false },
  { key: 'dispute_concierge', label: 'Dispute concierge', description: 'When a customer reports a problem, Lumi replies empathetically and pre-triages the case for the admin. Advisory only — never moves money. Off = plain confirmation, no AI triage.', default: true, enforced: false },
  { key: 'reviews',      label: 'Vendor reviews',  description: 'Let customers rate vendors (1–5 stars) and leave a public written review after a completed order. Off = the rating prompt and public reviews are hidden.', default: true, enforced: true },
  { key: 'face_id',      label: 'Face ID login',   description: 'Allow users to enrol Face ID / Touch ID as a second factor, and require it at login for enrolled accounts. Off = Face ID disabled platform-wide (PIN alone logs in).', default: false, enforced: true },
  { key: 'study',        label: 'Study (beta)',    description: 'Show the course-catalog study tool (faculty → programme → level → semester selector, then ask/practice). In development — off hides the /study section entirely.', default: true, enforced: true },
  { key: 'group_orders', label: 'Group ordering',   description: 'Let customers start a shared "order with friends" basket (host pays, one delivery). Off = the cart button and the group pages are hidden and no new group can be started.', default: true, enforced: true },
  { key: 'pickup_v1',    label: 'Pickup (Order Ahead)', description: 'Let customers order ahead and skip the queue — pay upfront (food + platform fee + ₦0 delivery), get a private 6-char collection code, and collect from the vendor. No riders needed. Held 1h25m once ready, then forfeited. Off = the Pickup option is hidden and pickup checkout is rejected.', default: false, enforced: true },
  { key: 'delivery_handover_v1', label: 'Delivery handover code', description: 'Require the rider to enter the customer’s private 6-char code at the door to confirm delivery and release funds (or an opt-in leave-at-gate drop with photo proof). Off = delivery completes the old way (no handover code).', default: false, enforced: true },
  { key: 'sponsor_topup', label: 'Parent / sponsor top-up', description: 'Public page where a parent/sponsor funds a student’s wallet, plus the "ask family to top up" share button on the wallet. Off = both are hidden and the page is disabled.', default: true, enforced: true },
  { key: 'founder', label: 'Founder spotlight', description: 'Show the "Why I built LumeX" founder section on the public landing page. Off = the section is removed from the page entirely.', default: true, enforced: true },
]

const settingId = (key: string) => `feature.${key}`

function coerce(value: unknown, fallback: boolean): boolean {
  if (value && typeof value === 'object' && 'enabled' in value) {
    return Boolean((value as { enabled: unknown }).enabled)
  }
  if (typeof value === 'boolean') return value
  return fallback
}

// In-memory cache so repeated flag reads in one request — and across requests on
// the same serverless instance — cost ONE settings query per TTL, not one per
// call. Flags change rarely; a toggle takes up to TTL to propagate (fine for a
// safety/visibility switch). Only successful fetches are cached.
let _flagCache: { at: number; values: Record<string, boolean> } | null = null
const FLAG_TTL_MS = 20_000

/** Read a single flag (server-side). Defaults to the catalog default if unset. */
export async function getFeature(key: string): Promise<boolean> {
  const all = await getAllFeatures()
  if (key in all) return all[key]
  return FEATURES.find((f) => f.key === key)?.default ?? true
}

/** Read every catalog flag merged with stored overrides (cached ~20s). */
export async function getAllFeatures(): Promise<Record<string, boolean>> {
  if (_flagCache && Date.now() - _flagCache.at < FLAG_TTL_MS) return _flagCache.values

  const out: Record<string, boolean> = {}
  for (const f of FEATURES) out[f.key] = f.default
  try {
    const db = createSupabaseAdmin()
    const { data } = await db
      .from('settings')
      .select('id, value')
      .in('id', FEATURES.map((f) => settingId(f.key)))
    for (const row of data ?? []) {
      const key = String(row.id).replace(/^feature\./, '')
      const def = FEATURES.find((f) => f.key === key)
      out[key] = coerce(row.value, def?.default ?? true)
    }
    _flagCache = { at: Date.now(), values: out } // cache only a successful read
  } catch {
    // fall back to defaults already in `out`; don't cache the failure
  }
  return out
}

export { settingId as featureSettingId }
