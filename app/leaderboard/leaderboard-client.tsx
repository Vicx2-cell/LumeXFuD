'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export type LeaderEntry = { rank: number; name: string; count: number }
export type Board = {
  customers: LeaderEntry[]
  vendors: LeaderEntry[]
  riders: LeaderEntry[]
}

const TABS = [
  { key: 'customers', label: 'Orderers', unit: 'order', empty: 'No orders yet. Be the first!' },
  { key: 'vendors', label: 'Vendors', unit: 'order', empty: 'No vendor has completed an order yet.' },
  { key: 'riders', label: 'Riders', unit: 'delivery', empty: 'No deliveries yet.' },
] as const

type TabKey = (typeof TABS)[number]['key']

const medals = ['🥇', '🥈', '🥉']

function plural(unit: string, n: number): string {
  if (n === 1) return unit
  return unit === 'delivery' ? 'deliveries' : `${unit}s`
}

export function LeaderboardTabs({ board }: { board: Board }) {
  const router = useRouter()
  const [active, setActive] = useState<TabKey>('customers')
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

  return (
    <div className="max-w-lg mx-auto px-4 py-5">
      {/* Tab switcher */}
      <div
        className="flex gap-1 p-1 rounded-2xl mb-5"
        style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        {TABS.map((t) => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-colors"
              style={{
                background: isActive ? '#F5A623' : 'transparent',
                color: isActive ? '#000' : 'rgba(255,255,255,0.5)',
              }}
              aria-pressed={isActive}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Ranked list */}
      <div className="space-y-3">
        {entries.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🏆</p>
            <p className="text-white/40 text-sm">{tab.empty}</p>
          </div>
        ) : (
          entries.map((entry) => (
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
                  {entry.count} {plural(tab.unit, entry.count)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm" style={{ color: '#F5A623' }}>
                  {entry.count}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
