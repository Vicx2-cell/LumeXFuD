'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

interface FeatureRow {
  key: string
  label: string
  description: string
  enforced: boolean
  enabled: boolean
  updated_by?: string | null
  updated_at?: string | null
}

export default function SuperAdminFeatures() {
  const [features, setFeatures] = useState<FeatureRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500) }

  async function load() {
    const res = await fetch('/api/super-admin/features')
    if (res.ok) {
      const d = await res.json() as { features: FeatureRow[] }
      setFeatures(d.features)
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function toggle(f: FeatureRow) {
    const next = !f.enabled
    setBusyKey(f.key)
    // optimistic
    setFeatures((prev) => prev.map((x) => x.key === f.key ? { ...x, enabled: next } : x))
    const res = await fetch('/api/super-admin/features', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: f.key, enabled: next }),
    })
    if (res.ok) {
      showToast(`${f.label} ${next ? 'enabled' : 'disabled'}`)
    } else {
      // revert
      setFeatures((prev) => prev.map((x) => x.key === f.key ? { ...x, enabled: !next } : x))
      const d = await res.json() as { error?: string }
      showToast(d.error ?? 'Failed to save')
    }
    setBusyKey(null)
  }

  return (
    <div className="lx-page lx-console px-4 py-8 overflow-hidden">
      <GlassSheen />
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium lx-scale-in"
          role="status" aria-live="polite" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="relative z-10 mx-auto max-w-2xl lx-enter">
        <PageHeader title="Feature Toggles" subtitle="Turn parts of the platform on or off instantly" badge="Super Admin" />

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="lx-skeleton h-20" style={{ borderRadius: 20 }} />)}
          </div>
        ) : (
          <div className="space-y-3 lx-stagger">
            {features.map((f) => (
              <div key={f.key} className="lx-surface p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-white">{f.label}</p>
                    {!f.enforced && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded text-white/50" style={{ background: 'rgba(255,255,255,0.06)' }} title="Hides the feature in the UI; not hard-enforced server-side">
                        display
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/50 mt-0.5">{f.description}</p>
                  <p className="text-[11px] text-white/35 mt-1">
                    {f.enabled ? 'On' : 'Off'}
                    {f.updated_by
                      ? ` · last changed by ${f.updated_by}${f.updated_at ? ` on ${new Date(f.updated_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`
                      : ' · never changed (default)'}
                  </p>
                </div>

                {/* Toggle switch */}
                <button
                  role="switch"
                  aria-checked={f.enabled}
                  aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${f.label}`}
                  disabled={busyKey === f.key}
                  onClick={() => toggle(f)}
                  className="relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-60"
                  style={{
                    background: f.enabled ? '#F5A623' : 'rgba(255,255,255,0.12)',
                    boxShadow: f.enabled ? '0 0 16px rgba(245,166,35,0.4)' : 'none',
                  }}
                >
                  <span
                    className="absolute top-1 w-5 h-5 rounded-full bg-white transition-all"
                    style={{ left: f.enabled ? 'calc(100% - 24px)' : '4px' }}
                  />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-white/35 mt-6 text-center">
          Changes apply immediately and are recorded in the super-audit log.
        </p>
      </div>
    </div>
  )
}
