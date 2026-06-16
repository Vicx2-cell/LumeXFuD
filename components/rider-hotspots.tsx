'use client'

import { useEffect, useState } from 'react'

type Level = 'quiet' | 'normal' | 'high' | 'surge'
type Hotspot = { shopName: string; level: Level; expectedNextHour: number }

// Rider "position near here" board. Shows only when the model sees vendors
// heating up — so an idle rider knows where to wait before orders drop.
export function RiderHotspots() {
  const [state, setState] = useState<{ enabled: boolean; hotspots: Hotspot[] } | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/api/forecast/hotspots', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { enabled: boolean; hotspots: Hotspot[] } | null) => { if (alive && d) setState(d) })
        .catch(() => {})
    load()
    const id = setInterval(load, 3 * 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  if (!state?.enabled) return null
  const spots = state.hotspots

  return (
    <div className="glass-thin mx-4 mb-5 p-4 lx-enter" style={{ border: '1px solid rgba(245,166,35,0.25)' }}>
      <div className="flex items-center gap-2 mb-2.5">
        <span aria-hidden="true">📍</span>
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#F5A623' }}>
          {spots.length > 0 ? 'Position near — heating up' : 'Demand radar'}
        </p>
      </div>

      {spots.length > 0 ? (
        <>
          <div className="space-y-2">
            {spots.map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <p className="text-sm text-white/85 truncate">{s.shopName}</p>
                <span
                  className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full tabular-nums"
                  style={{
                    background: s.level === 'surge' ? 'rgba(245,166,35,0.2)' : 'rgba(245,166,35,0.12)',
                    color: '#F5A623',
                  }}
                >
                  {s.level === 'surge' ? '🔥 ' : ''}~{s.expectedNextHour} soon
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-white/30 mt-2.5">Predicted from recent order patterns — get ahead of the drop.</p>
        </>
      ) : (
        <p className="text-sm text-white/55 leading-snug">
          Quiet right now — no surge predicted. We&apos;ll point you to the busiest vendors here as orders pick up.
        </p>
      )}
    </div>
  )
}
