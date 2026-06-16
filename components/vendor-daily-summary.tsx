'use client'

import { useEffect, useState, useCallback } from 'react'

interface DailyStats {
  date_label: string
  orders_count: number
  completed_count: number
  food_sales_naira: number
  gross_naira: number
  top_item: { name: string; qty: number } | null
  busiest_hour: string | null
}

const AMBER = '#F5A623'

export function VendorDailySummary() {
  const [stats, setStats] = useState<DailyStats | null>(null)
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(true)

  // Button refresh — setLoading here is fine (event handler, not an effect).
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/vendor-ai/daily-summary')
      if (res.ok) {
        const d = await res.json() as { stats: DailyStats; summary: string }
        setStats(d.stats)
        setSummary(d.summary)
      }
    } catch {
      // leave empty on failure
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load — state is only set inside the promise callback (not synchronously),
  // so this doesn't trip react-hooks/set-state-in-effect.
  useEffect(() => {
    let alive = true
    fetch('/api/vendor-ai/daily-summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stats: DailyStats; summary: string } | null) => {
        if (alive && d) { setStats(d.stats); setSummary(d.summary) }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <div className="mx-4 mt-4 rounded-2xl p-4" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.18)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <h3 className="text-sm font-semibold" style={{ color: AMBER }}>Today&apos;s summary{stats ? ` · ${stats.date_label}` : ''}</h3>
        </div>
        <button onClick={load} disabled={loading} className="text-xs text-white/45 hover:text-white/80 disabled:opacity-50">
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {loading && !stats ? (
        <div className="space-y-2">
          <div className="h-3 rounded bg-white/8 animate-pulse w-3/4" />
          <div className="h-3 rounded bg-white/8 animate-pulse w-1/2" />
        </div>
      ) : stats ? (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Tile label="Orders" value={String(stats.orders_count)} />
            <Tile label="Food sales" value={`₦${stats.food_sales_naira.toLocaleString()}`} highlight />
            {stats.top_item && <Tile label="Top seller" value={stats.top_item.name} sub={`${stats.top_item.qty} sold`} />}
            {stats.busiest_hour && <Tile label="Busiest" value={stats.busiest_hour} />}
          </div>
          {/* AI narrative */}
          {summary && <p className="text-sm text-white/75 leading-relaxed">{summary}</p>}
        </>
      ) : (
        <p className="text-sm text-white/45">Couldn&apos;t load your summary. Tap refresh to retry.</p>
      )}
    </div>
  )
}

function Tile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <p className="text-[11px] text-white/40">{label}</p>
      <p className="text-sm font-semibold truncate mt-0.5" style={highlight ? { color: AMBER } : undefined}>{value}</p>
      {sub && <p className="text-[11px] text-white/35">{sub}</p>}
    </div>
  )
}
