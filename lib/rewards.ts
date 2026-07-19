import { createSupabaseAdmin } from './supabase/server'
import { getAllFeatures } from './features'

// Server-side helpers for the gamification / engagement loop (migration 082).
// The money-correct parts (issuing, redeeming, tier, referral rewards) live in
// Postgres functions/triggers so they can't drift across order code paths; this
// module is the read model + the few app-driven actions (referral code, surprise
// open) and analytics.

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L ambiguity

// Reward mechanics that, when ANY is on, make a checkout eligible to redeem a
// credit. Used by the orders route to skip all reward work when fully disabled.
export const REWARD_FEATURE_KEYS = ['referral', 'loyalty_tiers', 'surprise_reward'] as const

export async function anyRewardFeatureOn(): Promise<boolean> {
  const f = await getAllFeatures()
  if (!f.customer_rewards_enabled) return false
  return REWARD_FEATURE_KEYS.some((k) => f[k])
}

/** Append a funnel analytics event (fire-and-forget; never throws). */
export function trackGamification(event: string, customerId: string | null, meta: Record<string, unknown> = {}): void {
  try {
    const db = createSupabaseAdmin()
    void db.rpc('log_gamification_event', { p_event: event, p_customer: customerId, p_meta: meta }).then(() => {}, () => {})
  } catch { /* never throw */ }
}

function randomCode(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

/** Get (or lazily create) the customer's referral code. */
export async function ensureReferralCode(customerId: string): Promise<string> {
  const db = createSupabaseAdmin()
  const { data: existing } = await db
    .from('referral_codes')
    .select('code')
    .eq('customer_id', customerId)
    .maybeSingle()
  if (existing?.code) return existing.code as string

  // Insert with a few retries on the unlikely UNIQUE collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode()
    const { error } = await db.from('referral_codes').insert({ customer_id: customerId, code })
    if (!error) return code
    // Someone else may have just created this customer's row (PK conflict) — re-read.
    const { data: again } = await db.from('referral_codes').select('code').eq('customer_id', customerId).maybeSingle()
    if (again?.code) return again.code as string
  }
  throw new Error('Could not allocate referral code')
}

export interface RewardSummary {
  enabled: { referral: boolean; tiers: boolean; surprise: boolean }
  tier: {
    tier: 'BRONZE' | 'SILVER' | 'GOLD'
    orders_30d: number
    silver_at: number
    gold_at: number
    next_tier: 'SILVER' | 'GOLD' | null
    orders_to_next: number | null
  }
  credits: { total_kobo: number; items: Array<{ amount_kobo: number; label: string; expires_at: string | null }> }
  referral: {
    code: string
    link: string
    referred_count: number
    qualified_count: number
    reward_referrer_kobo: number
    reward_referred_kobo: number
  }
  surprise: { id: string; expires_at: string } | null
}

function settingKobo(rows: Array<{ id: string; value: { amount_kobo?: number; value?: number } }>, id: string, fallback: number): number {
  const r = rows.find((x) => x.id === id)?.value
  const v = r?.amount_kobo ?? r?.value
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Everything the profile Rewards card needs, in one round of queries. */
export async function getRewardSummary(customerId: string): Promise<RewardSummary> {
  const db = createSupabaseAdmin()
  const features = await getAllFeatures()
  const customerRewardsOn = !!features.customer_rewards_enabled
  const customerReferralOn = customerRewardsOn && !!features.customer_referrals_enabled && !!features.referral
  const loyaltyOn = customerRewardsOn && !!features.loyalty_tiers
  const surpriseOn = customerRewardsOn && !!features.surprise_reward

  // Lazy expiry hygiene — retire any lapsed credits before we read them.
  void db.rpc('expire_reward_credits').then(() => {}, () => {})

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  const code = await ensureReferralCode(customerId)

  const [{ data: settings }, { data: tierRow }, { data: creditRows }, refStats, { data: surpriseRow }] = await Promise.all([
    db.from('settings').select('id, value').in('id', [
      'tier_silver_orders_30d', 'tier_gold_orders_30d',
      'referral_reward_referrer_kobo', 'referral_reward_referred_kobo',
    ]),
    db.from('customer_tiers').select('tier, orders_30d').eq('customer_id', customerId).maybeSingle(),
    db.from('reward_credits')
      .select('remaining_kobo, label, expires_at')
      .eq('customer_id', customerId)
      .eq('status', 'ACTIVE')
      .gt('remaining_kobo', 0)
      .order('expires_at', { ascending: true, nullsFirst: false }),
    db.from('referrals').select('status', { count: 'exact' }).eq('referrer_id', customerId),
    db.from('surprise_rewards')
      .select('id, expires_at')
      .eq('customer_id', customerId)
      .eq('status', 'UNOPENED')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const sRows = (settings ?? []) as Array<{ id: string; value: { amount_kobo?: number; value?: number } }>
  const silverAt = settingKobo(sRows, 'tier_silver_orders_30d', 8)
  const goldAt = settingKobo(sRows, 'tier_gold_orders_30d', 20)
  const tier = ((tierRow as { tier?: string } | null)?.tier ?? 'BRONZE') as 'BRONZE' | 'SILVER' | 'GOLD'
  const orders30 = Number((tierRow as { orders_30d?: number } | null)?.orders_30d ?? 0)

  let nextTier: 'SILVER' | 'GOLD' | null = null
  let toNext: number | null = null
  if (tier === 'BRONZE') { nextTier = 'SILVER'; toNext = Math.max(0, silverAt - orders30) }
  else if (tier === 'SILVER') { nextTier = 'GOLD'; toNext = Math.max(0, goldAt - orders30) }

  const credits = (creditRows ?? []) as Array<{ remaining_kobo: number; label: string; expires_at: string | null }>
  const referralRows = (refStats.data ?? []) as Array<{ status: string }>
  const qualified = referralRows.filter((r) => r.status === 'QUALIFIED_1' || r.status === 'QUALIFIED_2').length

  return {
    enabled: { referral: customerReferralOn, tiers: loyaltyOn, surprise: surpriseOn },
    tier: { tier, orders_30d: orders30, silver_at: silverAt, gold_at: goldAt, next_tier: nextTier, orders_to_next: toNext },
    credits: {
      total_kobo: credits.reduce((s, c) => s + Number(c.remaining_kobo), 0),
      items: credits.map((c) => ({ amount_kobo: Number(c.remaining_kobo), label: c.label, expires_at: c.expires_at })),
    },
    referral: {
      code,
      link: `${appUrl}/auth/register?ref=${code}`,
      referred_count: refStats.count ?? referralRows.length,
      qualified_count: qualified,
      reward_referrer_kobo: settingKobo(sRows, 'referral_reward_referrer_kobo', 30000),
      reward_referred_kobo: settingKobo(sRows, 'referral_reward_referred_kobo', 20000),
    },
    surprise: surpriseRow ? { id: (surpriseRow as { id: string }).id, expires_at: (surpriseRow as { expires_at: string }).expires_at } : null,
  }
}

export type SurpriseResult =
  | { ok: true; outcome_kobo: number; label: string }
  | { ok: false; error: string }

/**
 * Open a surprise reward. The outcome was decided server-side at creation; this
 * only reveals it and (if a prize) materializes the credit. Expiry + ownership
 * are enforced here. Idempotent: re-opening returns the same already-issued result.
 */
export async function openSurprise(customerId: string, surpriseId: string): Promise<SurpriseResult> {
  const db = createSupabaseAdmin()
  const { data: row } = await db
    .from('surprise_rewards')
    .select('id, customer_id, outcome_kobo, status, expires_at')
    .eq('id', surpriseId)
    .maybeSingle()

  const s = row as { id: string; customer_id: string; outcome_kobo: number; status: string; expires_at: string } | null
  if (!s || s.customer_id !== customerId) return { ok: false, error: 'Reward not found' }

  const kobo = Number(s.outcome_kobo) || 0
  const label = kobo > 0 ? `Surprise: ₦${Math.round(kobo / 100)} off` : 'Surprise'

  if (s.status === 'OPENED') return { ok: true, outcome_kobo: kobo, label } // idempotent reveal
  if (s.status === 'EXPIRED' || new Date(s.expires_at).getTime() <= Date.now()) {
    await db.from('surprise_rewards').update({ status: 'EXPIRED' }).eq('id', s.id).eq('status', 'UNOPENED')
    return { ok: false, error: 'This surprise has expired' }
  }

  // Claim the open (UNOPENED → OPENED) so a double-tap can't double-issue.
  const { data: claimed } = await db
    .from('surprise_rewards')
    .update({ status: 'OPENED', opened_at: new Date().toISOString() })
    .eq('id', s.id)
    .eq('status', 'UNOPENED')
    .select('id')
  if (!claimed || claimed.length === 0) return { ok: true, outcome_kobo: kobo, label } // someone else just opened it

  if (kobo > 0) {
    const { data: settings } = await db.from('settings').select('id, value').in('id', ['reward_credit_expiry_days', 'reward_min_order_kobo'])
    const sRows = (settings ?? []) as Array<{ id: string; value: { amount_kobo?: number; value?: number } }>
    const expDays = settingKobo(sRows, 'reward_credit_expiry_days', 7)
    const minOrder = settingKobo(sRows, 'reward_min_order_kobo', 0)
    const expiresAt = new Date(Date.now() + expDays * 86_400_000).toISOString()
    const { data: creditId } = await db.rpc('issue_reward_credit', {
      p_customer: customerId,
      p_amount_kobo: kobo,
      p_kind: 'SURPRISE',
      p_source_ref: `surprise:${s.id}`,
      p_expires_at: expiresAt,
      p_min_order: minOrder,
      p_label: label,
    })
    if (creditId) await db.from('surprise_rewards').update({ reward_credit_id: creditId }).eq('id', s.id)
  }
  return { ok: true, outcome_kobo: kobo, label }
}

export function canSaveReward(outcome_kobo: number, status: 'UNOPENED' | 'OPENED' | 'EXPIRED' | string, reward_credit_id: string | null): boolean {
  if (outcome_kobo <= 0) return false
  if (reward_credit_id) return false
  return status === 'UNOPENED' || status === 'OPENED'
}
