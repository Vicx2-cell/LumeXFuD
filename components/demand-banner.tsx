'use client'

import { useEffect, useState } from 'react'

type Level = 'quiet' | 'normal' | 'high' | 'surge'
type Forecast = {
  show: boolean
  learning?: boolean
  level: Level
  expectedNextHour: number
  recentLastHour: number
  sampleSize?: number
  advice: string
}

// Vendor "prep ahead" banner — the visible tip of the invisible demand model.
// Self-hides until there's enough history (server returns show:false). Refreshes
// every 5 min so it tracks the hour as it heats up.
const STYLE: Record<Level, { bg: string; border: string; fg: string; label: string }> = {
  surge:  { bg: 'rgba(245,166,35,0.16)', border: 'rgba(245,166,35,0.5)',  fg: '#F5A623', label: 'Surge incoming' },
  high:   { bg: 'rgba(245,166,35,0.10)', border: 'rgba(245,166,35,0.3)',  fg: '#F5A623', label: 'Picking up' },
  normal: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.7)', label: 'Steady' },
  quiet:  { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', fg: 'rgba(255,255,255,0.5)', label: 'Quiet' },
}

export function DemandBanner() {
  const [data, setData] = useState<Forecast | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/forecast/vendor', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Forecast | null) => { if (alive) setData(d?.show ? d : null) })
        .catch(() => {})
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  if (!data) return null
  const learning = !!data.learning
  const s = learning ? STYLE.normal : STYLE[data.level]
  const hot = !learning && (data.level === 'surge' || data.level === 'high')

  return (
    <div className="rounded-2xl p-4 flex items-start gap-3 lx-enter" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
      <span className={`text-xl shrink-0 ${!learning && data.level === 'surge' ? 'lx-flame-pulse' : ''}`} aria-hidden="true">
        {learning ? '🛰️' : hot ? '📈' : data.level === 'quiet' ? '🌙' : '📊'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: s.fg }}>
            {learning ? 'Demand radar' : s.label}
          </p>
          <span className="text-[11px] text-white/35">next hour</span>
        </div>
        <p className="text-sm text-white/80 mt-1 leading-snug">{data.advice}</p>
        <p className="text-[11px] text-white/35 mt-1 tabular-nums">
          {learning
            ? `Learning from ${data.sampleSize ?? 0} order${data.sampleSize === 1 ? '' : 's'} so far · ${data.recentLastHour} in the last hour`
            : `~${data.expectedNextHour} expected · ${data.recentLastHour} in the last hour`}
        </p>
      </div>
    </div>
  )
}
