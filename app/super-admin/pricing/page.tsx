'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

type Pricing = {
  platform_markup_kobo: number
  delivery_fee_bike_kobo: number
  rider_cut_bike_kobo: number
  delivery_fee_door_kobo: number
  rider_cut_door_kobo: number
  min_order_kobo: number
}

type LocationRow = {
  zone_id: string
  zone_name: string
  zone_status: 'ACTIVE' | 'PAUSED' | 'INACTIVE'
  city_id: string
  city_name: string
  city_state: string
  city_slug: string
  city_status: 'ACTIVE' | 'PAUSED' | 'INACTIVE'
  base_bike_fee_kobo: number
  base_door_fee_kobo: number
  platform_markup_kobo: number
  rider_cut_bike_kobo: number
  rider_cut_door_kobo: number
}

const STATUSES: Array<LocationRow['zone_status']> = ['ACTIVE', 'PAUSED', 'INACTIVE']

const toNaira = (kobo: number) => Math.round(kobo / 100)
const fmt = (kobo: number) => `₦${toNaira(kobo).toLocaleString('en-NG')}`

function NairaInput({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-white/55">{label}</span>
      <div className="mt-1 flex items-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
        <span className="px-3 text-sm text-white/40">₦</span>
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="flex-1 bg-transparent py-3 pr-3 text-base tabular-nums text-white outline-none"
        />
      </div>
      {hint && <span className="mt-1 block text-xs text-white/35">{hint}</span>}
    </label>
  )
}

function TextInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-white/55">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none"
      />
      {hint && <span className="mt-1 block text-xs text-white/35">{hint}</span>}
    </label>
  )
}

function StatusInput({ label, value, onChange }: { label: string; value: LocationRow['zone_status']; onChange: (v: LocationRow['zone_status']) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-white/55">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as LocationRow['zone_status'])}
        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white outline-none"
      >
        {STATUSES.map((status) => <option key={status} value={status} className="bg-[#111113]">{status}</option>)}
      </select>
    </label>
  )
}

export default function SuperAdminPricing() {
  const [naira, setNaira] = useState<Record<keyof Pricing, number> | null>(null)
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800) }

  async function load() {
    const res = await fetch('/api/super-admin/pricing')
    const d = res.ok ? await res.json() as { pricing: Pricing; locations?: LocationRow[] } : null
    if (d) {
      const next = {} as Record<keyof Pricing, number>
      for (const key of Object.keys(d.pricing) as Array<keyof Pricing>) next[key] = toNaira(d.pricing[key])
      setNaira(next)
      setLocations(d.locations ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  function setPricing(key: keyof Pricing, n: number) {
    setNaira((prev) => prev ? { ...prev, [key]: n } : prev)
    setError('')
  }

  function updateLocation(zoneId: string, patch: Partial<LocationRow>) {
    setLocations((prev) => prev.map((row) => row.zone_id === zoneId ? { ...row, ...patch } : row))
    setError('')
  }

  async function savePricing() {
    if (!naira) return
    if (naira.rider_cut_bike_kobo > naira.delivery_fee_bike_kobo) { setError("Bike rider pay can't exceed the bike delivery fee."); return }
    if (naira.rider_cut_door_kobo > naira.delivery_fee_door_kobo) { setError("Door rider pay can't exceed the door delivery fee."); return }
    setSaving(true)
    setError('')
    const body = Object.fromEntries(Object.entries(naira).map(([k, v]) => [k, v * 100]))
    const res = await fetch('/api/super-admin/pricing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) showToast('Default pricing updated')
    else setError(d.error ?? 'Save failed')
    setSaving(false)
  }

  async function saveLocation(row: LocationRow) {
    if (toNaira(row.rider_cut_bike_kobo) > toNaira(row.base_bike_fee_kobo)) {
      setError("Bike rider pay can't exceed the bike delivery fee.")
      return
    }
    if (toNaira(row.rider_cut_door_kobo) > toNaira(row.base_door_fee_kobo)) {
      setError("Door rider pay can't exceed the door delivery fee.")
      return
    }

    setBusyKey(row.zone_id)
    setError('')
    const res = await fetch('/api/super-admin/pricing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zone_id: row.zone_id,
        city_id: row.city_id,
        city_name: row.city_name,
        city_state: row.city_state,
        city_slug: row.city_slug,
        city_status: row.city_status,
        zone_name: row.zone_name,
        zone_status: row.zone_status,
        base_bike_fee_kobo: row.base_bike_fee_kobo,
        base_door_fee_kobo: row.base_door_fee_kobo,
        platform_markup_kobo: row.platform_markup_kobo,
        rider_cut_bike_kobo: row.rider_cut_bike_kobo,
        rider_cut_door_kobo: row.rider_cut_door_kobo,
      }),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) showToast(`${row.city_name} / ${row.zone_name} updated`)
    else setError(d.error ?? 'Could not save location details')
    setBusyKey(null)
  }

  const bikePlatform = naira ? (naira.delivery_fee_bike_kobo - naira.rider_cut_bike_kobo) * 100 : 0
  const doorPlatform = naira ? (naira.delivery_fee_door_kobo - naira.rider_cut_door_kobo) * 100 : 0

  return (
    <div className="lx-page lx-console overflow-hidden px-4 py-8">
      <GlassSheen />
      {toast && (
        <div className="lx-scale-in fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl px-4 py-2 text-sm font-medium" role="status" aria-live="polite" style={{ background: '#F5A623', color: '#000' }}>
          {toast}
        </div>
      )}

      <div className="relative z-10 mx-auto max-w-4xl lx-enter">
        <PageHeader title="Pricing & Locations" subtitle="Edit default fees and each live city / delivery zone" badge="Super Admin" />

        {loading || !naira ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="lx-skeleton h-36" style={{ borderRadius: 20 }} />)}</div>
        ) : (
          <div className="space-y-4">
            <div className="lx-surface space-y-3 p-4">
              <h2 className="text-sm font-semibold text-white/80">Default pricing</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <NairaInput label="Platform markup" value={naira.platform_markup_kobo} onChange={(n) => setPricing('platform_markup_kobo', n)} hint="Applied to the default active zone and new orders." />
                <NairaInput label="Minimum order amount" value={naira.min_order_kobo} onChange={(n) => setPricing('min_order_kobo', n)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h3 className="text-sm font-semibold text-white/80">Bike delivery</h3>
                  <NairaInput label="Delivery fee" value={naira.delivery_fee_bike_kobo} onChange={(n) => setPricing('delivery_fee_bike_kobo', n)} />
                  <NairaInput label="Rider pay" value={naira.rider_cut_bike_kobo} onChange={(n) => setPricing('rider_cut_bike_kobo', n)} />
                  <p className="text-xs" style={{ color: bikePlatform < 0 ? '#EF4444' : '#22C55E' }}>Platform keeps: {fmt(bikePlatform)}</p>
                </div>
                <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h3 className="text-sm font-semibold text-white/80">Door delivery</h3>
                  <NairaInput label="Delivery fee" value={naira.delivery_fee_door_kobo} onChange={(n) => setPricing('delivery_fee_door_kobo', n)} />
                  <NairaInput label="Rider pay" value={naira.rider_cut_door_kobo} onChange={(n) => setPricing('rider_cut_door_kobo', n)} />
                  <p className="text-xs" style={{ color: doorPlatform < 0 ? '#EF4444' : '#22C55E' }}>Platform keeps: {fmt(doorPlatform)}</p>
                </div>
              </div>
              <button onClick={savePricing} disabled={saving} className="lx-btn-amber w-full py-4" style={{ minHeight: 56 }}>
                {saving ? 'Saving…' : 'Save default pricing'}
              </button>
            </div>

            <div className="lx-surface space-y-4 p-4">
              <div>
                <h2 className="text-sm font-semibold text-white/80">Locations</h2>
                <p className="mt-1 text-xs text-white/40">Edit each city and delivery zone record directly here. These are the rows vendors, riders and orders now point to.</p>
              </div>

              {locations.length === 0 ? (
                <p className="text-sm text-white/45">No city or delivery-zone records are available yet. Apply the multi-city database migrations first.</p>
              ) : (
                <div className="space-y-4">
                  {locations.map((row) => {
                    const bikeKeep = row.base_bike_fee_kobo - row.rider_cut_bike_kobo
                    const doorKeep = row.base_door_fee_kobo - row.rider_cut_door_kobo
                    return (
                      <div key={row.zone_id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <TextInput label="City name" value={row.city_name} onChange={(v) => updateLocation(row.zone_id, { city_name: v })} />
                          <TextInput label="State" value={row.city_state} onChange={(v) => updateLocation(row.zone_id, { city_state: v })} />
                          <TextInput label="City slug" value={row.city_slug} onChange={(v) => updateLocation(row.zone_id, { city_slug: v })} hint="Used in URLs and internal lookups." />
                          <StatusInput label="City status" value={row.city_status} onChange={(v) => updateLocation(row.zone_id, { city_status: v })} />
                          <TextInput label="Zone name" value={row.zone_name} onChange={(v) => updateLocation(row.zone_id, { zone_name: v })} />
                          <StatusInput label="Zone status" value={row.zone_status} onChange={(v) => updateLocation(row.zone_id, { zone_status: v })} />
                        </div>

                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <div className="space-y-3 rounded-2xl border border-white/10 bg-[#111113] p-4">
                            <h3 className="text-sm font-semibold text-white/80">Bike delivery</h3>
                            <NairaInput label="Customer fee" value={toNaira(row.base_bike_fee_kobo)} onChange={(n) => updateLocation(row.zone_id, { base_bike_fee_kobo: n * 100 })} />
                            <NairaInput label="Rider pay" value={toNaira(row.rider_cut_bike_kobo)} onChange={(n) => updateLocation(row.zone_id, { rider_cut_bike_kobo: n * 100 })} />
                            <p className="text-xs" style={{ color: bikeKeep < 0 ? '#EF4444' : '#22C55E' }}>Platform keeps: {fmt(bikeKeep)}</p>
                          </div>
                          <div className="space-y-3 rounded-2xl border border-white/10 bg-[#111113] p-4">
                            <h3 className="text-sm font-semibold text-white/80">Door delivery</h3>
                            <NairaInput label="Customer fee" value={toNaira(row.base_door_fee_kobo)} onChange={(n) => updateLocation(row.zone_id, { base_door_fee_kobo: n * 100 })} />
                            <NairaInput label="Rider pay" value={toNaira(row.rider_cut_door_kobo)} onChange={(n) => updateLocation(row.zone_id, { rider_cut_door_kobo: n * 100 })} />
                            <p className="text-xs" style={{ color: doorKeep < 0 ? '#EF4444' : '#22C55E' }}>Platform keeps: {fmt(doorKeep)}</p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <NairaInput label="Platform markup" value={toNaira(row.platform_markup_kobo)} onChange={(n) => updateLocation(row.zone_id, { platform_markup_kobo: n * 100 })} />
                        </div>

                        <button onClick={() => void saveLocation(row)} disabled={busyKey === row.zone_id} className="lx-btn-amber mt-4 w-full py-3.5">
                          {busyKey === row.zone_id ? 'Saving…' : `Save ${row.city_name} / ${row.zone_name}`}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
            <p className="text-center text-xs text-white/35">Changes are recorded in the super-audit log.</p>
          </div>
        )}
      </div>
    </div>
  )
}
