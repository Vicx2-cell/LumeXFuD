'use client'

import { useCallback, useEffect, useState } from 'react'
import { BackButton } from '@/components/back-button'

interface Feature { key: string; label: string; total: number; roles: Record<string, number>; last_used: string | null }

const ROLE_COLORS: Record<string, string> = {
  customer: '#F5A623', vendor: '#22C55E', rider: '#7c3aed', guest: '#6B7280',
}
const ROLE_LABEL: Record<string, string> = {
  customer: 'Customers', vendor: 'Vendors', rider: 'Riders', guest: 'Guests',
}

export default function FeatureUsagePage() {
  const [features, setFeatures] = useState<Feature[]>([])
  const [totalEvents, setTotalEvents] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/super-admin/feature-usage', { cache: 'no-store' })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not load usage.'); return }
      setFeatures(d.features ?? [])
      setTotalEvents(d.total_events ?? 0)
      setError('')
    } catch { setError('Connection error.') } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const max = features.reduce((m, f) => Math.max(m, f.total), 0) || 1

  return (
    <div className="min-h-dvh px-5 py-10" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <BackButton fallback="/super-admin" />
          <button onClick={load} disabled={loading} className="rounded-xl px-4 py-2 text-sm font-semibold text-black disabled:opacity-50" style={{ background: '#F5A623' }}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <h1 className="text-2xl font-bold text-white mb-1">Feature usage</h1>
        <p className="text-sm text-white/45 mb-6">What gets used most, and by whom — customers, vendors and riders. {totalEvents.toLocaleString()} total uses recorded.</p>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
        {loading && features.length === 0 && <p className="text-sm text-white/40">Loading…</p>}
        {!loading && features.length === 0 && !error && (
          <p className="text-sm text-white/40">No usage recorded yet. Once people use the app (and migration 066 is applied), the most-used features show here.</p>
        )}

        <div className="space-y-3">
          {features.map((f, i) => (
            <div key={f.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {i === 0 && <span title="Most used">🔥</span>}
                  <p className="font-semibold text-white truncate">{f.label}</p>
                </div>
                <span className="text-sm font-bold shrink-0" style={{ color: '#F5A623' }}>{f.total.toLocaleString()}</span>
              </div>

              {/* Total bar */}
              <div className="h-2 rounded-full overflow-hidden mb-2.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round((f.total / max) * 100)}%`, background: '#F5A623' }} />
              </div>

              {/* Per-role breakdown */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(f.roles).sort((a, b) => b[1] - a[1]).map(([role, n]) => (
                  <span key={role} className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1.5"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: ROLE_COLORS[role] ?? '#6B7280' }} />
                    <span className="text-white/70">{ROLE_LABEL[role] ?? role}</span>
                    <span className="text-white font-medium">{n.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
