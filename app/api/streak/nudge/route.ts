import { NextResponse } from 'next/server'
import { Redis } from '@upstash/redis'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getFeature } from '@/lib/features'
import { getAnthropic, MODELS } from '@/lib/ai/client'
import { getLumiMemory } from '@/lib/lumi-memory'
import { lagosDate, streakStatus, type StreakStatus } from '@/lib/streaks'

// Personalized streak nudge for the home screen. The addictive core is LOSS
// AVERSION: when a streak is one day from breaking we say so, in the student's
// own taste ("your jollof streak"). AI is garnish — every path has a
// deterministic fallback, and a missing key / quota just uses it.
export const dynamic = 'force-dynamic'

type NudgePayload = {
  nudge: string | null
  status: StreakStatus
  current: number
  best: number
}

const EMPTY: NudgePayload = { nudge: null, status: 'none', current: 0, best: 0 }

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

// Deterministic copy so the card always works without the LLM.
function fallbackNudge(status: StreakStatus, current: number, fave: string | null): string | null {
  const food = fave ? ` Your ${fave} is calling.` : ''
  switch (status) {
    case 'at_risk':
      return `🔥 Your ${current}-day streak ends tonight — order today to make it ${current + 1}.${food}`
    case 'locked':
      return `🔥 ${current}-day streak locked in. Come back tomorrow to keep it climbing.`
    case 'reset':
      return `Your streak slipped. Order today and start a fresh run.${food}`
    default:
      return null
  }
}

const SYSTEM = `You write ONE short push-style line to keep a Nigerian campus student's food-ordering STREAK alive. Tone: warm, hype, a little competitive — like a friend who won't let them lose their run. Rules: max 16 words; at most one emoji (a 🔥 fits "at_risk"/"locked"); use their name and favourite ONLY if given; never invent numbers — use the streak length provided; for "at_risk" lean into the fear of losing it TODAY. Output ONLY the line, no quotes.`

export async function GET() {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer' || !session.userId) return NextResponse.json(EMPTY)
  if (!(await getFeature('streaks'))) return NextResponse.json(EMPTY)

  const db = createSupabaseAdmin()
  const { data: row } = await db
    .from('customer_streaks')
    .select('current_streak_days, best_streak_days, last_order_date')
    .eq('customer_id', session.userId)
    .maybeSingle()

  const current = (row?.current_streak_days as number) ?? 0
  const best = (row?.best_streak_days as number) ?? 0
  const status = streakStatus(current, (row?.last_order_date as string | null) ?? null)

  // Only nudge when there's something to act on. Brand-new users ('none') get
  // no nag — they meet streaks naturally after their first order.
  if (status === 'none') return NextResponse.json({ ...EMPTY, best })

  const mem = await getLumiMemory(db, session.userId)
  const fave = mem?.favourites?.[0] ?? null
  const name = mem?.preferred_name ?? null

  const fallback = fallbackNudge(status, current, fave)
  let nudge = fallback

  const anthropic = await getAnthropic()
  if (anthropic && fallback) {
    // Cache by what actually changes the copy: who, the state, the count, the
    // local day. One LLM call per student per day per state — cheap + snappy.
    const key = `streak:nudge:${session.userId}:${status}:${current}:${lagosDate()}`
    const r = redis()
    try {
      const cached = r ? await r.get<string>(key) : null
      if (cached) {
        nudge = cached
      } else {
        const facts = [
          name ? `Name: ${name}` : null,
          fave ? `Favourite: ${fave}` : null,
          `Streak state: ${status}`,
          `Current streak: ${current} day(s)`,
        ].filter(Boolean).join('\n')
        const res = await anthropic.messages.create({
          model: MODELS.fast,
          max_tokens: 60,
          system: SYSTEM,
          messages: [{ role: 'user', content: facts }],
        })
        const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim().replace(/^["']|["']$/g, '')
        nudge = text ? text.slice(0, 140) : fallback
        if (r) await r.set(key, nudge, { ex: 3600 })
      }
    } catch {
      nudge = fallback
    }
  }

  return NextResponse.json({ nudge, status, current, best } satisfies NudgePayload)
}
