'use client'

import { useEffect, useState } from 'react'

// Small "students onboard before we go live" progress widget. Fetches the public
// /api/launch-counter (aggregate integers only) and renders nothing unless the
// counter is enabled and the numbers come back.
type CounterData = { enabled: boolean; count?: number; goal?: number }

export function LaunchCounter() {
  const [data, setData] = useState<CounterData | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/launch-counter', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CounterData | null) => { if (alive) setData(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!data?.enabled || typeof data.count !== 'number' || typeof data.goal !== 'number') return null

  const { count, goal } = data
  const pct = goal > 0 ? Math.min(100, Math.round((count / goal) * 100)) : 0
  const reached = count >= goal

  return (
    <div
      className="rounded-2xl p-4 lx-enter"
      style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.25)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl shrink-0" aria-hidden="true">🚀</span>
        <p className="text-sm font-semibold" style={{ color: '#F5A623' }}>
          {reached
            ? `${count.toLocaleString()} students onboard — we're live!`
            : `${count.toLocaleString()} of ${goal.toLocaleString()} students onboard before we go live`}
        </p>
      </div>

      {/* Progress bar */}
      <div
        className="mt-3 h-2 w-full rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-label="Launch progress"
        style={{ background: 'rgba(255,255,255,0.1)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: '#F5A623', boxShadow: '0 0 12px rgba(245,166,35,0.5)' }}
        />
      </div>

      <p className="text-[11px] text-white/40 mt-1.5 tabular-nums">{pct}% there</p>
    </div>
  )
}
