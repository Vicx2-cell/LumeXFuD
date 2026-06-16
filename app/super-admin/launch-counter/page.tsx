'use client'

import { useEffect, useState } from 'react'
import { BackButton } from '@/components/back-button'

interface FlagRow {
  key: string
  enabled: boolean
  config: { goal?: number } | null
  updated_by: string | null
  updated_at: string | null
}
interface Stats { customers: number; vendors: number; riders: number }

export default function SuperAdminLaunchCounter() {
  const [flag, setFlag] = useState<FlagRow | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [goalInput, setGoalInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  async function load() {
    const [fRes, sRes] = await Promise.all([
      fetch('/api/admin/feature-flags?key=launch_counter'),
      fetch('/api/admin/stats'),
    ])
    if (fRes.ok) {
      const d = await fRes.json() as { flag: FlagRow }
      setFlag(d.flag)
      setGoalInput(String(d.flag.config?.goal ?? 500))
    }
    if (sRes.ok) setStats(await sRes.json() as Stats)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function save(patch: { enabled?: boolean; config?: { goal: number } }) {
    setBusy(true)
    const res = await fetch('/api/admin/feature-flags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'launch_counter', ...patch }),
    })
    if (res.ok) {
      const d = await res.json() as { flag: { enabled: boolean; config: { goal?: number } } }
      setFlag((prev) => prev ? { ...prev, enabled: d.flag.enabled, config: d.flag.config } : prev)
      showToast('Saved')
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      showToast(d.error ?? 'Failed to save')
      load() // resync to truth on failure
    }
    setBusy(false)
  }

  function saveGoal() {
    const goal = Number(goalInput)
    if (!Number.isInteger(goal) || goal < 1) { showToast('Goal must be a positive whole number'); return }
    save({ config: { goal } })
  }

  return (
    <div className="lx-page px-4 py-8 overflow-hidden">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium lx-scale-in"
          role="status" aria-live="polite" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="relative z-10 mx-auto max-w-2xl lx-enter">
        <div className="flex items-center gap-3 mb-6">
          <BackButton />
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-xs font-bold mb-1" style={{ background: '#F5A623', color: '#000' }}>Super Admin</span>
            <h1 className="text-xl font-bold text-white">Launch Counter</h1>
            <p className="text-sm text-white/45">Show the &ldquo;students onboard before we go live&rdquo; progress bar</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="lx-skeleton h-20" style={{ borderRadius: 20 }} />)}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Live account counts (always visible to super-admin) */}
            <div className="grid grid-cols-3 gap-3">
              {([['Customers', stats?.customers], ['Vendors', stats?.vendors], ['Riders', stats?.riders]] as const).map(([label, n]) => (
                <div key={label} className="glass-thin p-4 text-center">
                  <p className="text-2xl font-bold text-white tabular-nums">{(n ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-white/45 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* On/off toggle */}
            <div className="glass-thin p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-white">Show launch counter</p>
                <p className="text-xs text-white/50 mt-0.5">Renders the progress widget on customer, vendor & rider dashboards.</p>
              </div>
              <button
                role="switch"
                aria-checked={!!flag?.enabled}
                aria-label={`${flag?.enabled ? 'Disable' : 'Enable'} launch counter`}
                disabled={busy}
                onClick={() => save({ enabled: !flag?.enabled })}
                className="relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-60"
                style={{
                  background: flag?.enabled ? '#F5A623' : 'rgba(255,255,255,0.12)',
                  boxShadow: flag?.enabled ? '0 0 16px rgba(245,166,35,0.4)' : 'none',
                }}
              >
                <span className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all"
                  style={{ left: flag?.enabled ? 'calc(100% - 24px)' : '4px' }} />
              </button>
            </div>

            {/* Editable goal */}
            <div className="glass-thin p-4">
              <label htmlFor="goal" className="font-semibold text-white">Goal (students before launch)</label>
              <div className="flex items-center gap-2 mt-2">
                <input
                  id="goal"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  className="flex-1 rounded-xl px-4 py-3 text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                />
                <button
                  onClick={saveGoal}
                  disabled={busy}
                  className="shrink-0 px-5 py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
                  style={{ background: '#F5A623', color: '#000' }}
                >
                  Save goal
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-white/35 mt-6 text-center">
          Changes apply immediately and are recorded in the feature-flag &amp; super-audit logs.
        </p>
      </div>
    </div>
  )
}
