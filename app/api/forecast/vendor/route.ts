import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import { isAIAvailable, resolveProvider } from '@/lib/ai/providers'
import { forecastVendor, type DemandLevel } from '@/lib/demand'

// Next-hour demand outlook for the logged-in vendor → the "prep ahead" banner.
// The number is computed deterministically (lib/demand); Haiku only phrases the
// advice, and everything degrades to a plain line when AI is off.
export const dynamic = 'force-dynamic'

const EMPTY = { show: false as const }

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

function fallbackAdvice(level: DemandLevel, n: number): string {
  switch (level) {
    case 'surge': return `Busy hour incoming — about ${n} order${n === 1 ? '' : 's'} likely. Prep your fast-movers now.`
    case 'high':  return `Picking up — roughly ${n} order${n === 1 ? '' : 's'} expected. Get a head start.`
    case 'quiet': return `Quiet stretch ahead — a good time to restock or take a breather.`
    default:      return `Steady hour ahead — about ${n} order${n === 1 ? '' : 's'} expected.`
  }
}

const SYSTEM = `You write ONE short, practical line for a Nigerian campus food vendor's dashboard about the coming hour's order volume. Tone: calm, useful, like a sharp kitchen manager. Max 18 words. No emoji. Use ONLY the numbers given; never invent. Output ONLY the line.`

export async function GET() {
  const session = await getCurrentUser()
  if (!session || (session.role !== 'vendor' && session.role !== 'admin' && session.role !== 'super_admin') || !session.userId) {
    return NextResponse.json(EMPTY)
  }
  if (!(await getFeature('demand_forecast'))) return NextResponse.json(EMPTY)

  const db = createSupabaseAdmin()
  const f = await forecastVendor(db, session.userId)

  // Visible + honest: always render when enabled. When history is thin we say
  // "still learning" rather than hide, so the vendor can see the radar is live.
  const learning = f.confidence === 'low' || f.sampleSize < 8

  const advice = learning
    ? 'Still learning your rush hours — this sharpens as you sell more.'
    : await advise(f.vendorId, f.level, f.expectedNextHour)

  return NextResponse.json({
    show: true,
    learning,
    level: f.level,
    expectedNextHour: f.expectedNextHour,
    recentLastHour: f.recentLastHour,
    sampleSize: f.sampleSize,
    advice,
  })
}

async function advise(vendorId: string, level: DemandLevel, n: number): Promise<string> {
  const fallback = fallbackAdvice(level, n)
  if (!(await isAIAvailable('forecast'))) return fallback

  // One call per vendor per (level, rounded count) per 10-min slot — cheap + snappy.
  const slot = Math.floor(Date.now() / (10 * 60_000))
  const key = `forecast:advice:${vendorId}:${level}:${n}:${slot}`
  const r = redis()
  try {
    if (r) {
      const cached = await r.get<string>(key)
      if (cached) return cached
    }
    const provider = await resolveProvider('forecast')
    const res = await provider.generate({
      maxTokens: 50,
      system: SYSTEM,
      userText: `Demand level: ${level}\nExpected orders next hour: ${n}`,
    })
    const text = res.text.trim().replace(/^["']|["']$/g, '')
    const out = text ? text.slice(0, 140) : fallback
    if (r && text) await r.set(key, out, { ex: 900 })
    return out
  } catch {
    return fallback
  }
}
