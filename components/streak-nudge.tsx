'use client'

import { useEffect, useState } from 'react'

type Status = 'locked' | 'at_risk' | 'reset' | 'none'
type Nudge = { nudge: string | null; status: Status; current: number; best: number }

// Loss-aversion streak prompt on the home screen. Fetched client-side so the
// home page stays cacheable and the card simply doesn't render when there's
// nothing to say (logged out, AI off, no active streak).
export function StreakNudge() {
  const [data, setData] = useState<Nudge | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/streak/nudge', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Nudge | null) => { if (alive && d?.nudge) setData(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!data?.nudge) return null

  const urgent = data.status === 'at_risk'
  const style = urgent
    ? { background: 'rgba(245,166,35,0.14)', border: '1px solid rgba(245,166,35,0.45)', boxShadow: '0 0 24px rgba(245,166,35,0.22)' }
    : { background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)' }

  return (
    <div className="rounded-2xl p-4 flex items-center gap-3 lx-enter" style={style}>
      <span className={`text-2xl shrink-0 ${urgent ? 'lx-flame-pulse' : ''}`} aria-hidden="true">🔥</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug" style={{ color: '#F5A623' }}>{data.nudge}</p>
        {data.best > data.current && (
          <p className="text-xs text-white/45 mt-0.5">Your best run was {data.best} days — beat it.</p>
        )}
      </div>
      <a
        href="#vendors"
        className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full"
        style={{ background: '#F5A623', color: '#000' }}
      >
        Order
      </a>
    </div>
  )
}
