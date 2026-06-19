import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { trackFeature } from '@/lib/usage'
import { isAIAvailable, resolveProvider, type LLMMessage, type LLMTool, type LLMToolResult } from '@/lib/ai/providers'
import { getTierAndCount, getHoldPolicy, tierHoldLabel, type TrustTier } from '@/lib/wallet'
import { toNaira } from '@/lib/money'

export const runtime = 'nodejs'

// Rider earnings & payout assistant. Read-only, grounded in the rider's REAL
// wallet/holds via tools — the model phrases plain-English answers but never
// invents a figure (AI_SPEC: money is computed in code, the LLM only explains).

const SYSTEM = `You are the LumeX earnings assistant for delivery riders on a Nigerian campus food app. Riders ask you about their earnings, payouts, and money that's on hold. Be warm, clear, and brief — 1–3 short sentences, plain English.

TOOLS:
- get_earnings: the rider's balances (available, held, lifetime), trust tier, and whether a bank is connected / wallet frozen.
- get_upcoming_releases: money still on hold and when each part becomes available.

RULES:
- Answer ONLY using numbers returned by the tools. NEVER invent, estimate, or round a money figure yourself.
- Use get_earnings for balance / "how much have I made" / tier questions; use get_upcoming_releases for "why is my money held" / "when do I get it".
- Explain simply: after a delivery, earnings are HELD for a short window, then become AVAILABLE. You withdraw available money to your bank with the Withdraw button anytime (a bank must be added first; a newly added bank has a 24-hour wait). Higher trust tiers release money faster.
- If the wallet is frozen, say so and tell them to contact support — don't speculate beyond the reason given.
- You only handle earnings/payout questions. For delivery, app, or order problems, tell them to contact support. Never give tax or financial advice.
- Encourage them — they did the work.`

const tools: LLMTool[] = [
  { name: 'get_earnings', description: "The rider's current balances, trust tier and bank/frozen status.", parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'get_upcoming_releases', description: 'Money still on hold for this rider and when each portion is released.', parameters: { type: 'object', properties: {}, required: [] } },
]

type DB = ReturnType<typeof createSupabaseAdmin>

async function getEarnings(db: DB, riderId: string) {
  const { data } = await db
    .from('wallet_balances')
    .select('available_balance, held_balance, lifetime_earned, total_withdrawals, is_frozen, frozen_reason, bank_account_number, trust_tier')
    .eq('user_id', riderId)
    .eq('user_type', 'RIDER')
    .maybeSingle()
  const w = data as {
    available_balance: number; held_balance: number; lifetime_earned: number; total_withdrawals: number
    is_frozen: boolean; frozen_reason: string | null; bank_account_number: string | null; trust_tier: TrustTier
  } | null
  const { tier, count } = await getTierAndCount(riderId, 'RIDER')
  return {
    available_naira: Math.round(toNaira(w?.available_balance ?? 0)),
    held_naira: Math.round(toNaira(w?.held_balance ?? 0)),
    lifetime_earned_naira: Math.round(toNaira(w?.lifetime_earned ?? 0)),
    total_withdrawn_naira: Math.round(toNaira(w?.total_withdrawals ?? 0)),
    trust_tier: tier,
    tier_release_speed: tierHoldLabel(tier),
    completed_deliveries: count,
    bank_connected: !!w?.bank_account_number,
    is_frozen: !!w?.is_frozen,
    frozen_reason: w?.is_frozen ? (w?.frozen_reason ?? 'No reason given') : null,
  }
}

async function getUpcomingReleases(db: DB, riderId: string) {
  const nowIso = new Date().toISOString()
  const { data } = await db
    .from('wallet_transactions')
    .select('amount, release_at, order_id')
    .eq('user_id', riderId)
    .eq('user_type', 'RIDER')
    .eq('type', 'HOLD')
    .not('release_at', 'is', null)
    .gt('release_at', nowIso)
    .order('release_at', { ascending: true })
    .limit(10)
  const holds = ((data ?? []) as Array<{ amount: number; release_at: string }>).map((h) => ({
    amount_naira: Math.round(toNaira(h.amount)),
    releases_at: new Date(h.release_at).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }),
  }))
  const { tier, count } = await getTierAndCount(riderId, 'RIDER')
  const policy = await getHoldPolicy()
  const isNew = count < policy.newAccountThreshold
  return {
    upcoming_releases: holds,
    count: holds.length,
    policy_note: isNew
      ? `This rider is still new (under ${policy.newAccountThreshold} completed deliveries), so earnings are held longer (about ${Math.round(policy.riderNewMin / 60)}h) while the account is verified. After that, holds get much shorter.`
      : `Established rider on ${tier} tier — earnings release fast (${tierHoldLabel(tier).toLowerCase()}).`,
  }
}

interface ChatMessage { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'rider') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  trackFeature('rider_ai', 'rider')

  const riderId = session.userId!
  const rl = await rateLimitGeneric(`rider-ai:${riderId}`, 20, 300)
  if (!rl.success) return NextResponse.json({ error: 'Slow down a bit — try again in a moment.' }, { status: 429 })

  if (!(await isAIAvailable('rider'))) return NextResponse.json({ error: 'The assistant is not configured yet.' }, { status: 503 })

  let body: { messages?: ChatMessage[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
  const history = (body.messages ?? []).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-8)
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Ask me something first.' }, { status: 400 })
  }

  const db = createSupabaseAdmin()
  const provider = await resolveProvider('rider')
  const messages: LLMMessage[] = history.map((m) => ({ role: m.role, text: m.content }))

  try {
    for (let turn = 0; turn < 4; turn++) {
      const res = await provider.chat({ system: SYSTEM, tools, messages, maxTokens: 400 })

      if (res.toolCalls.length === 0) {
        return NextResponse.json({ reply: res.text.trim() || 'Ask me about your balance, payouts, or money on hold.' })
      }

      messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls })
      const results: LLMToolResult[] = []
      for (const b of res.toolCalls) {
        const data = b.name === 'get_earnings' ? await getEarnings(db, riderId)
          : b.name === 'get_upcoming_releases' ? await getUpcomingReleases(db, riderId)
          : { error: 'unknown tool' }
        results.push({ id: b.id, name: b.name, content: JSON.stringify(data) })
      }
      messages.push({ role: 'user', toolResults: results })
    }
    return NextResponse.json({ reply: 'Sorry, I got a bit stuck — please ask again.' })
  } catch (err) {
    console.error('[rider-ai] error:', err)
    return NextResponse.json({ error: 'The assistant had a hiccup. Try again.' }, { status: 500 })
  }
}
