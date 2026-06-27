import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { superAudit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'

// Typed editor for the gamification reward settings (migrations 082/083). Like
// /super-admin/pricing, it owns these specific settings rows and enforces their
// shapes + invariants, so the generic settings editor leaves them alone. Super
// admin only; every save is written to the super-audit log.

const SETTING_IDS = {
  outcomes: 'surprise_reward_outcomes',
  surpriseExpiry: 'surprise_reward_expiry_days',
  floor: 'reward_min_profit_kobo',
  referrer: 'referral_reward_referrer_kobo',
  referred: 'referral_reward_referred_kobo',
  creditExpiry: 'reward_credit_expiry_days',
  minOrder: 'reward_min_order_kobo',
  silver: 'tier_silver_orders_30d',
  gold: 'tier_gold_orders_30d',
  tierFreeDelivery: 'tier_free_delivery_kobo',
} as const

const DEFAULTS = {
  outcomes: [{ kobo: 0, weight: 55 }, { kobo: 10000, weight: 30 }, { kobo: 20000, weight: 15 }],
  surpriseExpiry: 7,
  floor: 25000,
  referrer: 30000,
  referred: 20000,
  creditExpiry: 30,
  minOrder: 50000,
  silver: 8,
  gold: 20,
  tierFreeDelivery: 50000,
}

const patchInput = z.object({
  surprise: z.object({
    outcomes: z.array(z.object({
      kobo: z.number().int().min(0).max(1_000_000),
      weight: z.number().min(0).max(1_000_000),
    })).min(1).max(10),
    expiry_days: z.number().int().min(1).max(90),
  }),
  floor_kobo: z.number().int().min(0).max(1_000_000),
  referral: z.object({
    referrer_kobo: z.number().int().min(0).max(1_000_000),
    referred_kobo: z.number().int().min(0).max(1_000_000),
  }),
  credit: z.object({
    expiry_days: z.number().int().min(1).max(365),
    min_order_kobo: z.number().int().min(0).max(10_000_000),
  }),
  tiers: z.object({
    silver_orders: z.number().int().min(1).max(1000),
    gold_orders: z.number().int().min(1).max(1000),
    free_delivery_kobo: z.number().int().min(0).max(1_000_000),
  }),
}).strict()

type SettingsRow = { id: string; value: unknown }

function amountKobo(rows: SettingsRow[], id: string, fallback: number): number {
  const v = rows.find((r) => r.id === id)?.value as { amount_kobo?: number } | undefined
  return typeof v?.amount_kobo === 'number' && Number.isFinite(v.amount_kobo) ? v.amount_kobo : fallback
}
function plainValue(rows: SettingsRow[], id: string, fallback: number): number {
  const v = rows.find((r) => r.id === id)?.value as { value?: number } | undefined
  return typeof v?.value === 'number' && Number.isFinite(v.value) ? v.value : fallback
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createSupabaseAdmin()
  const { data } = await db.from('settings').select('id, value').in('id', Object.values(SETTING_IDS))
  const rows = (data ?? []) as SettingsRow[]

  const rawOutcomes = (rows.find((r) => r.id === SETTING_IDS.outcomes)?.value as { outcomes?: Array<{ kobo?: number; weight?: number }> } | undefined)?.outcomes
  const outcomes = Array.isArray(rawOutcomes) && rawOutcomes.length
    ? rawOutcomes.map((o) => ({ kobo: Math.max(0, Math.floor(Number(o.kobo) || 0)), weight: Math.max(0, Number(o.weight) || 0) }))
    : DEFAULTS.outcomes

  return NextResponse.json({
    surprise: { outcomes, expiry_days: plainValue(rows, SETTING_IDS.surpriseExpiry, DEFAULTS.surpriseExpiry) },
    floor_kobo: amountKobo(rows, SETTING_IDS.floor, DEFAULTS.floor),
    referral: {
      referrer_kobo: amountKobo(rows, SETTING_IDS.referrer, DEFAULTS.referrer),
      referred_kobo: amountKobo(rows, SETTING_IDS.referred, DEFAULTS.referred),
    },
    credit: {
      expiry_days: plainValue(rows, SETTING_IDS.creditExpiry, DEFAULTS.creditExpiry),
      min_order_kobo: amountKobo(rows, SETTING_IDS.minOrder, DEFAULTS.minOrder),
    },
    tiers: {
      silver_orders: plainValue(rows, SETTING_IDS.silver, DEFAULTS.silver),
      gold_orders: plainValue(rows, SETTING_IDS.gold, DEFAULTS.gold),
      free_delivery_kobo: amountKobo(rows, SETTING_IDS.tierFreeDelivery, DEFAULTS.tierFreeDelivery),
    },
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`super-rewards:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = patchInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  const d = parsed.data

  // Invariants the UI also enforces, re-checked here (never trust the client).
  if (d.surprise.outcomes.reduce((s, o) => s + o.weight, 0) <= 0) {
    return NextResponse.json({ error: 'At least one surprise outcome must have a weight above 0.' }, { status: 400 })
  }
  if (d.tiers.gold_orders <= d.tiers.silver_orders) {
    return NextResponse.json({ error: 'Gold must require more orders than Silver.' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const now = new Date().toISOString()
  const rows = [
    { id: SETTING_IDS.outcomes,         value: { outcomes: d.surprise.outcomes } },
    { id: SETTING_IDS.surpriseExpiry,   value: { value: d.surprise.expiry_days } },
    { id: SETTING_IDS.floor,            value: { amount_kobo: d.floor_kobo } },
    { id: SETTING_IDS.referrer,         value: { amount_kobo: d.referral.referrer_kobo } },
    { id: SETTING_IDS.referred,         value: { amount_kobo: d.referral.referred_kobo } },
    { id: SETTING_IDS.creditExpiry,     value: { value: d.credit.expiry_days } },
    { id: SETTING_IDS.minOrder,         value: { amount_kobo: d.credit.min_order_kobo } },
    { id: SETTING_IDS.silver,           value: { value: d.tiers.silver_orders } },
    { id: SETTING_IDS.gold,             value: { value: d.tiers.gold_orders } },
    { id: SETTING_IDS.tierFreeDelivery, value: { amount_kobo: d.tiers.free_delivery_kobo } },
  ].map((r) => ({ ...r, updated_by: session.phone, updated_at: now }))

  const { error } = await db.from('settings').upsert(rows, { onConflict: 'id' })
  if (error) return NextResponse.json({ error: 'Failed to save reward settings' }, { status: 500 })

  await superAudit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'rewards_settings_update',
    target_table: 'settings',
    target_id: 'rewards',
    new_value: d,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
