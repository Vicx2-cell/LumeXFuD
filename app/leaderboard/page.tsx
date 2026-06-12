import { createSupabaseAdmin } from '@/lib/supabase/server'
import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { getFeature } from '@/lib/features'
import { LeaderboardTabs, type Board, type LeaderEntry } from './leaderboard-client'

// Realtime keeps an open board fresh; this is just a fallback re-fetch interval.
export const revalidate = 60

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

async function fetchTab(
  db: ReturnType<typeof createSupabaseAdmin>,
  type: 'customer' | 'vendor' | 'rider',
  table: 'customers' | 'vendors' | 'riders',
  nameCol: 'name' | 'shop_name' | 'full_name',
  format: (raw: string | null) => string,
): Promise<LeaderEntry[]> {
  const { data: rows } = await db
    .from('leaderboard_stats')
    .select('entity_id, delivered_count')
    .eq('entity_type', type)
    .order('delivered_count', { ascending: false })
    .limit(10)

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

  return list.map((r, i) => ({
    rank: i + 1,
    name: format(nameById.get(r.entity_id) ?? null),
    count: r.delivered_count,
  }))
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

  // Three independent ranking queries — one per tab. Lifetime totals, single
  // ABSU campus, no XP (counts come from the leaderboard_stats counter table).
  const [customers, vendors, riders] = await Promise.all([
    fetchTab(db, 'customer', 'customers', 'name', maskPerson),
    fetchTab(db, 'vendor', 'vendors', 'shop_name', vendorName),
    fetchTab(db, 'rider', 'riders', 'full_name', maskPerson),
  ])

  const board: Board = { customers, vendors, riders }

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

      <LeaderboardTabs board={board} />

      <BottomNav />
    </main>
  )
}
