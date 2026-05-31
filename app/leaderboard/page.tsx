import { createSupabaseAdmin } from '@/lib/supabase/server'
import { BottomNav } from '@/components/nav-bottom'

export const revalidate = 300

export default async function LeaderboardPage() {
  const db = createSupabaseAdmin()

  // MVP leaderboard ranks customers by COMPLETED orders over a rolling
  // 7-day window (XP/levels were removed). Computed live from orders.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Paginate: a single PostgREST response caps at 1000 rows, which a busy
  // week of orders exceeds — an unpaginated query would skew the rankings.
  const PAGE = 1000
  const counts = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    const { data: orders } = await db
      .from('orders')
      .select('customer_id')
      .eq('status', 'COMPLETED')
      .gte('completed_at', sevenDaysAgo)
      .not('customer_id', 'is', null)
      .range(from, from + PAGE - 1)
    const batch = (orders ?? []) as Array<{ customer_id: string }>
    for (const o of batch) {
      counts.set(o.customer_id, (counts.get(o.customer_id) ?? 0) + 1)
    }
    if (batch.length < PAGE) break
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Resolve names for the ranked customers.
  const nameById = new Map<string, string | null>()
  if (ranked.length > 0) {
    const { data: customers } = await db
      .from('customers')
      .select('id, name')
      .in('id', ranked.map(([id]) => id))
      .is('deleted_at', null)
    for (const c of (customers ?? []) as Array<{ id: string; name: string | null }>) {
      nameById.set(c.id, c.name)
    }
  }

  const top = ranked.map(([customerId, orderCount], i) => {
    const rawName = nameById.get(customerId) ?? 'Anonymous'
    const parts = rawName.trim().split(' ')
    const display =
      parts.length > 1
        ? `${parts[0]} ${parts[parts.length - 1][0]}.`
        : parts[0]
    return { rank: i + 1, name: display, orders: orderCount }
  })

  const medals = ['🥇', '🥈', '🥉']

  return (
    <main className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="sticky top-0 z-40 border-b border-white/8 px-4 py-3"
        style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto">
          <h1 className="font-semibold">Weekly Leaderboard</h1>
          <p className="text-xs text-white/40 mt-0.5">Top orderers this week · resets Monday</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-3">
        {top.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🏆</p>
            <p className="text-white/40 text-sm">No orders this week yet. Be the first!</p>
          </div>
        ) : (
          top.map((entry) => (
            <div
              key={entry.rank}
              className="flex items-center gap-4 rounded-2xl px-4 py-4"
              style={{
                background: entry.rank <= 3 ? 'rgba(245,166,35,0.08)' : '#111113',
                border: `1px solid ${entry.rank <= 3 ? 'rgba(245,166,35,0.2)' : 'rgba(255,255,255,0.07)'}`,
              }}
            >
              <div className="w-8 text-center shrink-0">
                {entry.rank <= 3 ? (
                  <span className="text-xl">{medals[entry.rank - 1]}</span>
                ) : (
                  <span className="text-sm text-white/40 font-semibold">#{entry.rank}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{entry.name}</p>
                <p className="text-xs text-white/40 mt-0.5">
                  {entry.orders} order{entry.orders === 1 ? '' : 's'} this week
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm" style={{ color: '#F5A623' }}>{entry.orders}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <BottomNav />
    </main>
  )
}
