import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { isAIAvailable, resolveProvider } from '@/lib/ai/providers'

export const runtime = 'nodejs'

// Vendor "how did today go?" recap. Numbers are computed SERVER-SIDE from real
// orders; an LLM only phrases a short, warm narrative around them (AI_SPEC: the
// model never computes money). Stats + narrative are cached together for 30 min
// so repeated opens are consistent and cheap.

interface DailyStats {
  date_label: string
  orders_count: number
  completed_count: number
  food_sales_naira: number   // vendor's food revenue (subtotal), what they earn
  gross_naira: number        // total the customers paid (incl. fees + delivery)
  top_item: { name: string; qty: number } | null
  busiest_hour: string | null
}

// Start of "today" in WAT (UTC+1, no DST), as a UTC ISO instant + a display label.
function todayWAT(): { startIso: string; label: string } {
  const watNow = new Date(Date.now() + 60 * 60_000)
  const y = watNow.getUTCFullYear(), m = watNow.getUTCMonth(), d = watNow.getUTCDate()
  const startUtcMs = Date.UTC(y, m, d) - 60 * 60_000 // WAT midnight expressed in UTC
  const label = watNow.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return { startIso: new Date(startUtcMs).toISOString(), label }
}

function watHourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12
  const ampm = h < 12 ? 'am' : 'pm'
  const next = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12
  const nextAmpm = (h + 1) % 24 < 12 ? 'am' : 'pm'
  return `${h12}${ampm}–${next}${nextAmpm}`
}

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

async function computeStats(db: ReturnType<typeof createSupabaseAdmin>, vendorId: string): Promise<DailyStats> {
  const { startIso, label } = todayWAT()

  // A "sale" = a paid order today (ignores abandoned PENDING_PAYMENT / cancelled).
  const { data: orders } = await db
    .from('orders')
    .select('id, subtotal, total_amount, created_at, status')
    .eq('vendor_id', vendorId)
    .eq('payment_status', 'PAID')
    .gte('created_at', startIso)

  const rows = (orders ?? []) as Array<{ id: string; subtotal: number; total_amount: number; created_at: string; status: string }>
  const foodKobo = rows.reduce((s, o) => s + (o.subtotal ?? 0), 0)
  const grossKobo = rows.reduce((s, o) => s + (o.total_amount ?? 0), 0)
  const completed = rows.filter((o) => o.status === 'COMPLETED').length

  // Busiest WAT hour
  const byHour = new Map<number, number>()
  for (const o of rows) {
    const h = (new Date(o.created_at).getUTCHours() + 1) % 24
    byHour.set(h, (byHour.get(h) ?? 0) + 1)
  }
  let busiest: string | null = null
  if (byHour.size > 0) {
    const [topHour] = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0]
    busiest = watHourLabel(topHour)
  }

  // Top-selling item from today's paid orders
  let topItem: { name: string; qty: number } | null = null
  if (rows.length > 0) {
    const { data: items } = await db
      .from('order_items')
      .select('name, quantity, order_id')
      .in('order_id', rows.map((o) => o.id))
    const byName = new Map<string, number>()
    for (const it of (items ?? []) as Array<{ name: string; quantity: number }>) {
      byName.set(it.name, (byName.get(it.name) ?? 0) + (it.quantity ?? 0))
    }
    if (byName.size > 0) {
      const [name, qty] = [...byName.entries()].sort((a, b) => b[1] - a[1])[0]
      topItem = { name, qty }
    }
  }

  return {
    date_label: label,
    orders_count: rows.length,
    completed_count: completed,
    food_sales_naira: Math.round(foodKobo / 100),
    gross_naira: Math.round(grossKobo / 100),
    top_item: topItem,
    busiest_hour: busiest,
  }
}

async function narrate(stats: DailyStats): Promise<string> {
  if (!(await isAIAvailable('vendor'))) return fallbackNarrative(stats)
  try {
    const provider = await resolveProvider('vendor')
    const out = await provider.generate({
      maxTokens: 180,
      system: `You write a short, warm end-of-day sales recap for a vendor on a Nigerian campus food app. 2–3 sentences, plain English, encouraging and specific. Use ONLY the numbers in the data — never invent figures. If it was a slow/zero day, be kind and motivating, not negative. You may add ONE short practical tip if the data suggests one (e.g. prep more of the top item before the busy hour). No markdown, no emoji spam (at most one).`,
      userText: `Today's data (JSON): ${JSON.stringify(stats)}`,
    })
    const text = out.text.trim()
    return text || fallbackNarrative(stats)
  } catch (err) {
    console.error('[vendor-ai] narrate failed:', err)
    return fallbackNarrative(stats)
  }
}

// Deterministic fallback so the card always says something useful without the LLM.
function fallbackNarrative(s: DailyStats): string {
  if (s.orders_count === 0) return "No orders yet today — make sure you're set to OPEN so students can find you. The lunch and evening rushes are your best windows."
  const parts = [`You've had ${s.orders_count} order${s.orders_count === 1 ? '' : 's'} today, ₦${s.food_sales_naira.toLocaleString()} in food sales.`]
  if (s.top_item) parts.push(`${s.top_item.name} is your top seller (${s.top_item.qty} sold).`)
  if (s.busiest_hour) parts.push(`Busiest around ${s.busiest_hour}.`)
  return parts.join(' ')
}

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const vendorId = session.userId!
  const rl = await rateLimitGeneric(`vendor-ai:summary:${vendorId}`, 15, 300)
  if (!rl.success) return NextResponse.json({ error: 'Please wait a moment and try again.' }, { status: 429 })

  const { label } = todayWAT()
  const cacheKey = `vendor:daily-summary:${vendorId}:${label}`
  const r = redis()
  if (r) {
    const cached = await r.get<{ stats: DailyStats; summary: string }>(cacheKey)
    if (cached) return NextResponse.json({ ...cached, cached: true })
  }

  const db = createSupabaseAdmin()
  const stats = await computeStats(db, vendorId)
  const summary = await narrate(stats)
  const payload = { stats, summary }
  if (r) await r.set(cacheKey, payload, { ex: 1800 }) // 30 min: consistent + cheap

  return NextResponse.json(payload)
}
