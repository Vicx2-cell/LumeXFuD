import { createSupabaseAdmin } from '@/lib/supabase/server'
import { BottomNav } from '@/components/nav-bottom'

export const revalidate = 300

export default async function LeaderboardPage() {
  const db = createSupabaseAdmin()

  const { data: leaders } = await db
    .from('customer_xp')
    .select(`
      customer_id, weekly_xp, level,
      customers ( name )
    `)
    .eq('customers.leaderboard_opt_out', false)
    .order('weekly_xp', { ascending: false })
    .limit(10)

  const top = (leaders ?? []).map((row, i) => {
    const customer = (Array.isArray(row.customers) ? row.customers[0] : row.customers) as { name: string | null } | null
    const rawName = customer?.name ?? 'Anonymous'
    const parts = rawName.trim().split(' ')
    const display =
      parts.length > 1
        ? `${parts[0]} ${parts[parts.length - 1][0]}.`
        : parts[0]
    return {
      rank: i + 1,
      name: display,
      weekly_xp: row.weekly_xp as number,
      level: row.level as number,
    }
  })

  const medals = ['🥇', '🥈', '🥉']

  return (
    <main className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="sticky top-0 z-40 border-b border-white/8 px-4 py-3"
        style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto">
          <h1 className="font-semibold">Weekly Leaderboard</h1>
          <p className="text-xs text-white/40 mt-0.5">Resets every Monday midnight</p>
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
                <p className="text-xs text-white/40 mt-0.5">Level {entry.level}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm" style={{ color: '#F5A623' }}>{entry.weekly_xp.toLocaleString()} XP</p>
              </div>
            </div>
          ))
        )}

        <p className="text-center text-xs text-white/30 pt-4">
          Only customers who opted in are shown. Manage in your profile.
        </p>
      </div>

      <BottomNav />
    </main>
  )
}
