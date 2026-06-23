'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export type LeaderEntry = {
  rank: number
  name: string
  count: number
  // Top badge the person publicly carries (customers only) — a visible flex.
  badge?: { emoji: string; name: string }
}
export type Board = {
  customers: LeaderEntry[]
  vendors: LeaderEntry[]
  riders: LeaderEntry[]
  streaks: LeaderEntry[]
}
export type Commentary = { customers: string; vendors: string; riders: string; streaks: string }

const TABS = [
  { key: 'streaks', label: '🔥 Streaks', unit: 'day', empty: 'No active streaks. Order daily to top this board.' },
  { key: 'customers', label: 'Orderers', unit: 'order', empty: 'No orders yet. Be the first!' },
  { key: 'vendors', label: 'Vendors', unit: 'order', empty: 'No vendor has completed an order yet.' },
  { key: 'riders', label: 'Riders', unit: 'delivery', empty: 'No deliveries yet.' },
] as const

type TabKey = (typeof TABS)[number]['key']

// Metallic gradients for the top-3 rank badges (gold / silver / bronze).
const podium = [
  { bg: 'linear-gradient(135deg,#FFE08A,#F5A623)', ring: 'rgba(245,166,35,0.5)', fg: '#3a2400' },
  { bg: 'linear-gradient(135deg,#E8E8EE,#9AA0AE)', ring: 'rgba(200,205,215,0.45)', fg: '#23262e' },
  { bg: 'linear-gradient(135deg,#E8A87C,#B06A3B)', ring: 'rgba(176,106,59,0.45)', fg: '#2c1709' },
]

function plural(unit: string, n: number): string {
  if (n === 1) return unit
  return unit === 'delivery' ? 'deliveries' : `${unit}s`
}

export function LeaderboardTabs({
  board,
  commentary,
  showStreaks = true,
}: {
  board: Board
  commentary?: Commentary
  showStreaks?: boolean
}) {
  const router = useRouter()
  const visibleTabs = showStreaks ? TABS : TABS.filter((t) => t.key !== 'streaks')
  const [active, setActive] = useState<TabKey>(showStreaks ? 'streaks' : 'customers')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Realtime: leaderboard_stats is anon-readable (public counts), so the browser
  // client receives bumps as deliveries happen. Counter changes don't carry the
  // entity name, so we re-fetch the server component (which resolves names via
  // the service role) instead of patching client state. Bursts of deliveries are
  // coalesced into one refresh.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel('leaderboard')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leaderboard_stats' },
        () => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current)
          refreshTimer.current = setTimeout(() => router.refresh(), 1500)
        },
      )
      .subscribe()

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [router])

  const tab = TABS.find((t) => t.key === active)!
  const entries = board[active]
  const isStreak = active === 'streaks'

  return (
    <div className="max-w-lg mx-auto px-4 py-5">
      {/* Tab switcher */}
      <div className="glass-thin flex gap-1 p-1 mb-5" style={{ borderRadius: 16 }}>
        {visibleTabs.map((t) => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className="flex-1 min-w-0 rounded-xl py-2.5 px-1 text-xs sm:text-sm font-semibold whitespace-nowrap transition-all active:scale-[0.97]"
              style={{
                background: isActive ? '#F5A623' : 'transparent',
                color: isActive ? '#000' : 'rgba(255,255,255,0.55)',
                boxShadow: isActive ? '0 0 18px rgba(245,166,35,0.35)' : 'none',
              }}
              aria-pressed={isActive}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* AI caption for the active tab */}
      {commentary && entries.length > 0 && (
        <div className="lx-card-amber-soft flex items-start gap-2 mb-4 px-3.5 py-2.5 rounded-2xl">
          <span className="text-sm shrink-0">✨</span>
          <p className="text-sm leading-snug" style={{ color: 'rgba(255,255,255,0.85)' }}>{commentary[active]}</p>
        </div>
      )}

      {/* Ranked list */}
      <div className="space-y-3 lx-stagger" key={active}>
        {entries.length === 0 ? (
          <div className="text-center py-16">
            <div className="lx-icon-badge w-16 h-16 rounded-2xl mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
            </div>
            <p className="font-medium text-white/80">The podium&apos;s empty</p>
            <p className="text-white/45 text-sm mt-1">{tab.empty}</p>
          </div>
        ) : (
          entries.map((entry) => {
            const top = entry.rank <= 3
            return (
            <div
              key={entry.rank}
              className={`lx-tap flex items-center gap-4 px-4 py-4 ${top ? 'glass lx-card-amber-soft' : 'glass-thin'}`}
            >
              <div className="w-9 flex items-center justify-center shrink-0">
                {top ? (
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: podium[entry.rank - 1].bg, color: podium[entry.rank - 1].fg, boxShadow: `0 0 14px ${podium[entry.rank - 1].ring}` }}
                  >
                    {entry.rank}
                  </span>
                ) : (
                  <span className="text-sm text-white/40 font-semibold tabular-nums">#{entry.rank}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                  <span className="truncate">{entry.name}</span>
                  {entry.badge && (
                    <span className="shrink-0" title={entry.badge.name} aria-label={entry.badge.name}>
                      {entry.badge.emoji}
                    </span>
                  )}
                </p>
                <p className="text-xs text-white/45 mt-0.5 tabular-nums">
                  {entry.count} {plural(tab.unit, entry.count)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="lx-amber font-bold text-base tabular-nums">
                  {isStreak ? `🔥 ${entry.count}` : entry.count}
                </p>
              </div>
            </div>
            )
          })
        )}
      </div>
    </div>
  )
}
