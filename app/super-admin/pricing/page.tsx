'use client'

import { useEffect, useState } from 'react'
import { BackButton } from '@/components/back-button'

type Pricing = {
  platform_markup_kobo: number
  delivery_fee_bike_kobo: number
  rider_cut_bike_kobo: number
  delivery_fee_door_kobo: number
  rider_cut_door_kobo: number
  min_order_kobo: number
}

const toNaira = (kobo: number) => Math.round(kobo / 100)
const fmt = (kobo: number) => `₦${toNaira(kobo).toLocaleString('en-NG')}`

// A labelled Naira input.
function NairaInput({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-white/55">{label}</span>
      <div className="flex items-center mt-1 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <span className="px-3 text-white/40 text-sm">₦</span>
        <input
          type="number" min={0} inputMode="numeric"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="flex-1 bg-transparent py-3 pr-3 text-base outline-none tabular-nums"
          style={{ color: '#fff' }}
        />
      </div>
      {hint && <span className="text-xs text-white/35 mt-1 block">{hint}</span>}
    </label>
  )
}

export default function SuperAdminPricing() {
  const [naira, setNaira] = useState<Record<keyof Pricing, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800) }

  useEffect(() => {
    fetch('/api/super-admin/pricing')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { pricing: Pricing } | null) => {
        if (d) {
          const n = {} as Record<keyof Pricing, number>
          for (const k of Object.keys(d.pricing) as (keyof Pricing)[]) n[k] = toNaira(d.pricing[k])
          setNaira(n)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  function set(key: keyof Pricing, n: number) {
    setNaira((prev) => prev ? { ...prev, [key]: n } : prev)
    setError('')
  }

  async function save() {
    if (!naira) return
    if (naira.rider_cut_bike_kobo > naira.delivery_fee_bike_kobo) { setError("Bike rider pay can't exceed the bike delivery fee."); return }
    if (naira.rider_cut_door_kobo > naira.delivery_fee_door_kobo) { setError("Door rider pay can't exceed the door delivery fee."); return }
    setSaving(true); setError('')
    const body = Object.fromEntries(Object.entries(naira).map(([k, v]) => [k, v * 100]))
    const res = await fetch('/api/super-admin/pricing', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) showToast('Pricing updated — applies to new orders instantly')
    else setError(d.error ?? 'Save failed')
    setSaving(false)
  }

  const bikePlatform = naira ? (naira.delivery_fee_bike_kobo - naira.rider_cut_bike_kobo) * 100 : 0
  const doorPlatform = naira ? (naira.delivery_fee_door_kobo - naira.rider_cut_door_kobo) * 100 : 0

  return (
    <div className="lx-page px-4 py-8 overflow-hidden">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium lx-scale-in"
          role="status" aria-live="polite" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="relative z-10 mx-auto max-w-lg lx-enter">
        <div className="flex items-center gap-3 mb-6">
          <BackButton />
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-xs font-bold mb-1" style={{ background: '#F5A623', color: '#000' }}>Super Admin</span>
            <h1 className="text-xl font-bold text-white">Pricing</h1>
            <p className="text-sm text-white/45">Markup and rider pay — applies to new orders instantly</p>
          </div>
        </div>

        {loading || !naira ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="lx-skeleton h-32" style={{ borderRadius: 20 }} />)}</div>
        ) : (
          <div className="space-y-4">
            {/* Your markup */}
            <div className="glass-thin p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white/80">Your markup</h2>
              <NairaInput label="Platform markup (per order)" value={naira.platform_markup_kobo}
                onChange={(n) => set('platform_markup_kobo', n)} hint="Added to every order as your platform fee." />
            </div>

            {/* Bike */}
            <div className="glass-thin p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white/80">Bike delivery</h2>
              <NairaInput label="Delivery fee (customer pays)" value={naira.delivery_fee_bike_kobo} onChange={(n) => set('delivery_fee_bike_kobo', n)} />
              <NairaInput label="Rider pay (rider keeps)" value={naira.rider_cut_bike_kobo} onChange={(n) => set('rider_cut_bike_kobo', n)} />
              <p className="text-xs" style={{ color: bikePlatform < 0 ? '#EF4444' : '#22C55E' }}>
                Platform keeps: {fmt(bikePlatform)}
              </p>
            </div>

            {/* Door */}
            <div className="glass-thin p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white/80">Door delivery</h2>
              <NairaInput label="Delivery fee (customer pays)" value={naira.delivery_fee_door_kobo} onChange={(n) => set('delivery_fee_door_kobo', n)} />
              <NairaInput label="Rider pay (rider keeps)" value={naira.rider_cut_door_kobo} onChange={(n) => set('rider_cut_door_kobo', n)} />
              <p className="text-xs" style={{ color: doorPlatform < 0 ? '#EF4444' : '#22C55E' }}>
                Platform keeps: {fmt(doorPlatform)}
              </p>
            </div>

            {/* Min order */}
            <div className="glass-thin p-4 space-y-3">
              <h2 className="text-sm font-semibold text-white/80">Minimum order</h2>
              <NairaInput label="Minimum order amount" value={naira.min_order_kobo} onChange={(n) => set('min_order_kobo', n)} />
            </div>

            {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}

            <button onClick={save} disabled={saving} className="lx-btn-amber w-full py-4" style={{ minHeight: 56 }}>
              {saving ? 'Saving…' : 'Save pricing'}
            </button>
            <p className="text-xs text-white/35 text-center">Changes are recorded in the super-audit log.</p>
          </div>
        )}
      </div>
    </div>
  )
}
