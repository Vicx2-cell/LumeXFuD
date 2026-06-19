import crypto from 'crypto'
import { Redis } from '@upstash/redis'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { getFeature } from '@/lib/features'
import { isAIAvailable, resolveProvider } from '@/lib/ai/providers'
import { LeaderboardTabs, type Board, type LeaderEntry, type Commentary } from './leaderboard-client'

// Always render fresh; Realtime keeps an open board live after first paint.
export const dynamic = 'force-dynamic'

type StatRow = { entity_id: string; delivered_count: number }

/** "First L." — masks a person's surname for public display. */
function maskPerson(raw: string | null): string {
  const name = (raw ?? '').trim()
  if (!name) return 'Anonymous'
  const parts = name.split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]
}

/** Vendors are businesses — show the shop name in full. */
function vendorName(raw: string | null): string {
  return (raw ?? '').trim() || 'Unknown vendor'
}

// Prestige order for "which badge to show next to a name" — rarest first. The
// public leaderboard flexes a person's single most impressive badge.
const BADGE_PRESTIGE = [
  'monthly-master', 'two-week-legend', 'weekly-warrior', 'loyal', 'foodie',
  'consistent', 'big-spender', 'regular', 'night-owl', 'early-bird', 'first-bite',
]

/** Map each customer id → their single top (most prestigious) earned badge. */
async function topBadgeByCustomer(
  db: ReturnType<typeof createSupabaseAdmin>,
  ids: string[],
): Promise<Map<string, { emoji: string; name: string }>> {
  const out = new Map<string, { emoji: string; name: string }>()
  if (ids.length === 0) return out

  const { data } = await db
    .from('customer_badges')
    .select('customer_id, badge_id, badges(emoji, name)')
    .in('customer_id', ids)

  type Row = { customer_id: string; badge_id: string; badges: { emoji: string; name: string } | null }
  const byCust = new Map<string, Array<{ id: string; emoji: string; name: string }>>()
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.badges) continue
    const arr = byCust.get(r.customer_id) ?? []
    arr.push({ id: r.badge_id, emoji: r.badges.emoji, name: r.badges.name })
    byCust.set(r.customer_id, arr)
  }
  const rank = (id: string) => { const i = BADGE_PRESTIGE.indexOf(id); return i === -1 ? 999 : i }
  for (const [cust, arr] of byCust) {
    arr.sort((a, b) => rank(a.id) - rank(b.id))
    out.set(cust, { emoji: arr[0].emoji, name: arr[0].name })
  }
  return out
}

async function fetchTab(
  db: ReturnType<typeof createSupabaseAdmin>,
  type: 'customer' | 'vendor' | 'rider',
  table: 'customers' | 'vendors' | 'riders',
  nameCol: 'name' | 'shop_name' | 'full_name',
  format: (raw: string | null) => string,
  withBadges = false,
): Promise<LeaderEntry[]> {
  const { data: rows } = await db
    .from('leaderboard_stats')
    .select('entity_id, delivered_count')
    .eq('entity_type', type)
    .order('delivered_count', { ascending: false })
    .limit(3)

  const list = (rows ?? []) as StatRow[]
  if (list.length === 0) return []

  const { data: names } = await db
    .from(table)
    .select(`id, ${nameCol}`)
    .in('id', list.map((r) => r.entity_id))
    .is('deleted_at', null)

  const nameById = new Map<string, string | null>()
  for (const n of (names ?? []) as Array<Record<string, string | null>>) {
    nameById.set(n.id as string, n[nameCol])
  }

  const badges = withBadges ? await topBadgeByCustomer(db, list.map((r) => r.entity_id)) : null

  return list.map((r, i) => ({
    rank: i + 1,
    name: format(nameById.get(r.entity_id) ?? null),
    count: r.delivered_count,
    badge: badges?.get(r.entity_id),
  }))
}

// Streaks rank from customer_streaks (current run), not the delivered-count table.
async function fetchStreaks(db: ReturnType<typeof createSupabaseAdmin>): Promise<LeaderEntry[]> {
  const { data: rows } = await db
    .from('customer_streaks')
    .select('customer_id, current_streak_days')
    .gt('current_streak_days', 0)
    .order('current_streak_days', { ascending: false })
    .limit(3)

  const list = (rows ?? []) as Array<{ customer_id: string; current_streak_days: number }>
  if (list.length === 0) return []

  const { data: names } = await db
    .from('customers')
    .select('id, name')
    .in('id', list.map((r) => r.customer_id))
    .is('deleted_at', null)

  const nameById = new Map<string, string | null>()
  for (const n of (names ?? []) as Array<{ id: string; name: string | null }>) nameById.set(n.id, n.name)

  const badges = await topBadgeByCustomer(db, list.map((r) => r.customer_id))

  return list.map((r, i) => ({
    rank: i + 1,
    name: maskPerson(nameById.get(r.customer_id) ?? null),
    count: r.current_streak_days,
    badge: badges.get(r.customer_id),
  }))
}

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

const COMMENTARY_PROMPT = `You write a short, lively one-line caption for each section of a Nigerian campus food leaderboard: streaks (longest current daily-order streaks), customers (orderers), vendors (kitchens), riders (deliveries). Use ONLY the names and numbers given — never invent any. Each line max 14 words, fun and a little competitive, at most one emoji. For "streaks" lean into keeping the run alive. Output ONLY JSON: {"streaks": string, "customers": string, "vendors": string, "riders": string}.`

// Deterministic fallback so the board always has a caption without the LLM.
function fallbackCommentary(board: Board): Commentary {
  const lead = (arr: LeaderEntry[], unit: string) =>
    arr[0] ? `${arr[0].name} leads with ${arr[0].count} ${unit} 🏆` : 'Wide open — claim the top spot!'
  return {
    streaks: board.streaks[0]
      ? `${board.streaks[0].name} is on a ${board.streaks[0].count}-day streak 🔥 — who can catch them?`
      : 'No streaks yet — order daily and own this board.',
    customers: lead(board.customers, 'orders'),
    vendors: lead(board.vendors, 'orders'),
    riders: lead(board.riders, 'deliveries'),
  }
}

// AI captions for each tab, computed from the (already public, masked) top-3.
// Cached in Redis keyed by the standings, so the LLM only runs when they change.
async function getCommentary(board: Board): Promise<Commentary> {
  const fallback = fallbackCommentary(board)
  if (!(await isAIAvailable('leaderboard'))) return fallback

  const key = 'leaderboard:ai:' + crypto.createHash('sha1').update(JSON.stringify(board)).digest('hex')
  const r = redis()
  if (r) {
    const cached = await r.get<Commentary>(key)
    if (cached) return cached
  }
  try {
    const provider = await resolveProvider('leaderboard')
    const res = await provider.generate({
      maxTokens: 220,
      system: COMMENTARY_PROMPT,
      userText: `Top 3 per section (JSON): ${JSON.stringify(board)}`,
      jsonMode: true,
    })
    const text = res.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    const parsed = JSON.parse(text) as Partial<Commentary>
    const out: Commentary = {
      streaks: typeof parsed.streaks === 'string' && parsed.streaks.trim() ? parsed.streaks.trim().slice(0, 120) : fallback.streaks,
      customers: typeof parsed.customers === 'string' && parsed.customers.trim() ? parsed.customers.trim().slice(0, 120) : fallback.customers,
      vendors: typeof parsed.vendors === 'string' && parsed.vendors.trim() ? parsed.vendors.trim().slice(0, 120) : fallback.vendors,
      riders: typeof parsed.riders === 'string' && parsed.riders.trim() ? parsed.riders.trim().slice(0, 120) : fallback.riders,
    }
    if (r) await r.set(key, out, { ex: 3600 })
    return out
  } catch {
    return fallback
  }
}

export default async function LeaderboardPage() {
  // Super admin can switch the leaderboard off platform-wide.
  if (!(await getFeature('leaderboard'))) {
    return (
      <main className="lx-page pb-24 flex flex-col items-center justify-center text-center px-6 overflow-hidden">
        <div className="relative z-10 lx-enter">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/><path d="M4 22h16"/></svg>
          </div>
          <p className="font-semibold text-white/80">Leaderboard is taking a break</p>
          <p className="text-sm text-white/45 mt-1">Check back soon.</p>
        </div>
        <BottomNav />
      </main>
    )
  }

  const db = createSupabaseAdmin()

  // The streaks tab is gated by the same super-admin flag as the profile panel.
  const streaksOn = await getFeature('streaks')

  // Independent ranking queries — one per tab. Lifetime delivered totals come
  // from the leaderboard_stats counter; the live "streaks" tab reads the
  // current run from customer_streaks (migration 037). Single ABSU campus, no XP.
  const [customers, vendors, riders, streaks] = await Promise.all([
    fetchTab(db, 'customer', 'customers', 'name', maskPerson, streaksOn),
    fetchTab(db, 'vendor', 'vendors', 'shop_name', vendorName),
    fetchTab(db, 'rider', 'riders', 'full_name', maskPerson),
    streaksOn ? fetchStreaks(db) : Promise.resolve([] as LeaderEntry[]),
  ])

  const board: Board = { customers, vendors, riders, streaks }
  const commentary = await getCommentary(board)

  return (
    <main className="lx-page pb-24 overflow-hidden">
      <div className="sticky top-0 z-40 glass-thin px-4 py-3" style={{ borderRadius: 0, boxShadow: 'none', borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <BackButton />
          <div>
            <h1 className="font-semibold">Leaderboard</h1>
            <p className="text-xs text-white/40 mt-0.5">All-time champions on campus</p>
          </div>
        </div>
      </div>

      <LeaderboardTabs board={board} commentary={commentary} showStreaks={streaksOn} />

      <BottomNav />
    </main>
  )
}
