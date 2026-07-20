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

type PricingRuleRow = {
  id?: string
  name: string
  start_time: string | null
  end_time: string | null
  days_of_week: number[]
  weather_trigger: string | null
  customer_adjustment_kind: 'FIXED' | 'MULTIPLIER'
  customer_adjustment_value: number
  rider_bonus_kind: 'FIXED' | 'MULTIPLIER'
  rider_bonus_value: number
  priority: number
  enabled: boolean
}

type LocationRow = {
  zone_id: string
  zone_name: string
  zone_status: 'ACTIVE' | 'PAUSED' | 'INACTIVE'
  uses_lodge_catalog: boolean
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
  pricing_mode: 'FLAT' | 'DISTANCE'
  base_distance_meters: number
  distance_increment_meters: number
  bike_increment_fee_kobo: number
  door_increment_fee_kobo: number
  bike_increment_rider_fee_kobo: number
  door_increment_rider_fee_kobo: number
  max_delivery_distance_meters: number
  vendor_delivery_radius_meters: number
  rules: PricingRuleRow[]
}

type NewLocationForm = Omit<LocationRow, 'zone_id' | 'city_id'>

const STATUSES: Array<LocationRow['zone_status']> = ['ACTIVE', 'PAUSED', 'INACTIVE']
const DAYS = [
  { key: 0, label: 'Sun' },
  { key: 1, label: 'Mon' },
  { key: 2, label: 'Tue' },
  { key: 3, label: 'Wed' },
  { key: 4, label: 'Thu' },
  { key: 5, label: 'Fri' },
  { key: 6, label: 'Sat' },
] as const

const newRule = (): PricingRuleRow => ({
  name: '',
  start_time: null,
  end_time: null,
  days_of_week: [],
  weather_trigger: null,
  customer_adjustment_kind: 'FIXED',
  customer_adjustment_value: 0,
  rider_bonus_kind: 'FIXED',
  rider_bonus_value: 0,
  priority: 100,
  enabled: true,
})

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

function MeterInput({ label, value, onChange, hint }: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-white/55">{label}</span>
      <div className="mt-1 flex items-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="flex-1 bg-transparent px-3 py-3 text-base tabular-nums text-white outline-none"
        />
        <span className="px-3 text-sm text-white/40">m</span>
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
  const [newLocation, setNewLocation] = useState<NewLocationForm | null>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800) }

  async function load() {
    const res = await fetch('/api/super-admin/pricing')
    const d = res.ok ? await res.json() as { pricing: Pricing; locations?: LocationRow[] } : null
    if (d) {
      const next = {} as Record<keyof Pricing, number>
      for (const key of Object.keys(d.pricing) as Array<keyof Pricing>) next[key] = toNaira(d.pricing[key])
      setNaira(next)
      setLocations(d.locations ?? [])
      setNewLocation({
        zone_name: '',
        zone_status: 'ACTIVE',
        uses_lodge_catalog: true,
        city_name: '',
        city_state: '',
        city_slug: '',
        city_status: 'ACTIVE',
        base_bike_fee_kobo: d.pricing.delivery_fee_bike_kobo,
        base_door_fee_kobo: d.pricing.delivery_fee_door_kobo,
        platform_markup_kobo: d.pricing.platform_markup_kobo,
        rider_cut_bike_kobo: d.pricing.rider_cut_bike_kobo,
        rider_cut_door_kobo: d.pricing.rider_cut_door_kobo,
        pricing_mode: 'DISTANCE',
        base_distance_meters: 2000,
        distance_increment_meters: 2000,
        bike_increment_fee_kobo: 0,
        door_increment_fee_kobo: 0,
        bike_increment_rider_fee_kobo: 0,
        door_increment_rider_fee_kobo: 0,
        max_delivery_distance_meters: 10000,
        vendor_delivery_radius_meters: 10000,
        rules: [],
      })
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

  function updateNewLocation(patch: Partial<NewLocationForm>) {
    setNewLocation((prev) => prev ? { ...prev, ...patch } : prev)
    setError('')
  }

  function updateLocationRule(zoneId: string, index: number, patch: Partial<PricingRuleRow>) {
    setLocations((prev) => prev.map((row) => row.zone_id !== zoneId ? row : {
      ...row,
      rules: row.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    }))
    setError('')
  }

  function updateNewLocationRule(index: number, patch: Partial<PricingRuleRow>) {
    setNewLocation((prev) => prev ? {
      ...prev,
      rules: prev.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    } : prev)
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
    if (row.bike_increment_rider_fee_kobo > row.bike_increment_fee_kobo) {
      setError("Bike rider distance pay can't exceed the bike distance add-on.")
      return
    }
    if (row.door_increment_rider_fee_kobo > row.door_increment_fee_kobo) {
      setError("Door rider distance pay can't exceed the door distance add-on.")
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
        uses_lodge_catalog: row.uses_lodge_catalog,
        base_bike_fee_kobo: row.base_bike_fee_kobo,
        base_door_fee_kobo: row.base_door_fee_kobo,
        platform_markup_kobo: row.platform_markup_kobo,
        rider_cut_bike_kobo: row.rider_cut_bike_kobo,
        rider_cut_door_kobo: row.rider_cut_door_kobo,
        pricing_mode: row.pricing_mode,
        base_distance_meters: row.base_distance_meters,
        distance_increment_meters: row.distance_increment_meters,
        bike_increment_fee_kobo: row.bike_increment_fee_kobo,
        door_increment_fee_kobo: row.door_increment_fee_kobo,
        bike_increment_rider_fee_kobo: row.bike_increment_rider_fee_kobo,
        door_increment_rider_fee_kobo: row.door_increment_rider_fee_kobo,
        max_delivery_distance_meters: row.max_delivery_distance_meters,
        vendor_delivery_radius_meters: row.vendor_delivery_radius_meters,
        rules: row.rules,
      }),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) showToast(`${row.city_name} / ${row.zone_name} updated`)
    else setError(d.error ?? 'Could not save location details')
    setBusyKey(null)
  }

  async function createLocation() {
    if (!newLocation) return
    if (!newLocation.city_name.trim() || !newLocation.city_state.trim() || !newLocation.city_slug.trim() || !newLocation.zone_name.trim()) {
      setError('Add the state, city, slug and zone name before saving.')
      return
    }
    if (newLocation.rider_cut_bike_kobo > newLocation.base_bike_fee_kobo) {
      setError("Bike rider pay can't exceed the bike delivery fee.")
      return
    }
    if (newLocation.rider_cut_door_kobo > newLocation.base_door_fee_kobo) {
      setError("Door rider pay can't exceed the door delivery fee.")
      return
    }
    if (newLocation.bike_increment_rider_fee_kobo > newLocation.bike_increment_fee_kobo) {
      setError("Bike rider distance pay can't exceed the bike distance add-on.")
      return
    }
    if (newLocation.door_increment_rider_fee_kobo > newLocation.door_increment_fee_kobo) {
      setError("Door rider distance pay can't exceed the door distance add-on.")
      return
    }

    setBusyKey('new-location')
    setError('')
    const res = await fetch('/api/super-admin/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLocation),
    })
    const d = await res.json() as { error?: string }
    if (res.ok) {
      showToast(`${newLocation.city_name} / ${newLocation.zone_name} added`)
      await load()
    } else {
      setError(d.error ?? 'Could not create location')
    }
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

              {newLocation && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-white/85">Add state / city / zone</h3>
                    <p className="mt-1 text-xs text-white/45">Only `ACTIVE` locations show in customer checkout. You control the prices for each zone here.</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextInput label="State" value={newLocation.city_state} onChange={(v) => updateNewLocation({ city_state: v })} />
                    <TextInput label="City name" value={newLocation.city_name} onChange={(v) => updateNewLocation({ city_name: v })} />
                    <TextInput label="City slug" value={newLocation.city_slug} onChange={(v) => updateNewLocation({ city_slug: v.trim().toLowerCase().replace(/\s+/g, '-') })} hint="Example: uturu" />
                    <StatusInput label="City status" value={newLocation.city_status} onChange={(v) => updateNewLocation({ city_status: v })} />
                    <TextInput label="Zone name" value={newLocation.zone_name} onChange={(v) => updateNewLocation({ zone_name: v })} hint="Example: ABSU campus, Gregory University, Greater Uturu" />
                    <StatusInput label="Zone status" value={newLocation.zone_status} onChange={(v) => updateNewLocation({ zone_status: v })} />
                  </div>

                  <label className="mt-4 flex items-start gap-2.5 rounded-2xl border border-white/10 bg-[#111113] p-3">
                    <input
                      type="checkbox"
                      checked={newLocation.uses_lodge_catalog}
                      onChange={(e) => updateNewLocation({ uses_lodge_catalog: e.target.checked })}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                    />
                    <span className="text-xs leading-relaxed text-white/60">
                      Use the lodge dropdown and campus map in checkout for this zone. Turn this off for wider city areas where customers should just type their address manually.
                    </span>
                  </label>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="space-y-3 rounded-2xl border border-white/10 bg-[#111113] p-4">
                      <h4 className="text-sm font-semibold text-white/80">Bike delivery</h4>
                      <NairaInput label="Customer fee" value={toNaira(newLocation.base_bike_fee_kobo)} onChange={(n) => updateNewLocation({ base_bike_fee_kobo: n * 100 })} />
                      <NairaInput label="Rider pay" value={toNaira(newLocation.rider_cut_bike_kobo)} onChange={(n) => updateNewLocation({ rider_cut_bike_kobo: n * 100 })} />
                    </div>
                    <div className="space-y-3 rounded-2xl border border-white/10 bg-[#111113] p-4">
                      <h4 className="text-sm font-semibold text-white/80">Door delivery</h4>
                      <NairaInput label="Customer fee" value={toNaira(newLocation.base_door_fee_kobo)} onChange={(n) => updateNewLocation({ base_door_fee_kobo: n * 100 })} />
                      <NairaInput label="Rider pay" value={toNaira(newLocation.rider_cut_door_kobo)} onChange={(n) => updateNewLocation({ rider_cut_door_kobo: n * 100 })} />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <NairaInput label="Platform markup" value={toNaira(newLocation.platform_markup_kobo)} onChange={(n) => updateNewLocation({ platform_markup_kobo: n * 100 })} />
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <MeterInput label="Base distance" value={newLocation.base_distance_meters} onChange={(n) => updateNewLocation({ base_distance_meters: n })} />
                    <MeterInput label="Distance increment" value={newLocation.distance_increment_meters} onChange={(n) => updateNewLocation({ distance_increment_meters: n })} />
                    <MeterInput label="Max delivery distance" value={newLocation.max_delivery_distance_meters} onChange={(n) => updateNewLocation({ max_delivery_distance_meters: n })} />
                    <MeterInput label="Vendor radius" value={newLocation.vendor_delivery_radius_meters} onChange={(n) => updateNewLocation({ vendor_delivery_radius_meters: n })} />
                    <NairaInput label="Bike add-on per step" value={toNaira(newLocation.bike_increment_fee_kobo)} onChange={(n) => updateNewLocation({ bike_increment_fee_kobo: n * 100 })} />
                    <NairaInput label="Bike rider bonus per step" value={toNaira(newLocation.bike_increment_rider_fee_kobo)} onChange={(n) => updateNewLocation({ bike_increment_rider_fee_kobo: n * 100 })} />
                    <NairaInput label="Door add-on per step" value={toNaira(newLocation.door_increment_fee_kobo)} onChange={(n) => updateNewLocation({ door_increment_fee_kobo: n * 100 })} />
                    <NairaInput label="Door rider bonus per step" value={toNaira(newLocation.door_increment_rider_fee_kobo)} onChange={(n) => updateNewLocation({ door_increment_rider_fee_kobo: n * 100 })} />
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-[#111113] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-white/80">Dynamic pricing rules</h4>
                        <p className="mt-1 text-xs text-white/45">Optional surcharges like rain or peak hours. Each one must also pay riders more.</p>
                      </div>
                      <button type="button" onClick={() => updateNewLocation({ rules: [...newLocation.rules, newRule()] })} className="rounded-xl border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-300">Add rule</button>
                    </div>
                    {newLocation.rules.map((rule, index) => (
                      <div key={`new-rule-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <TextInput label="Rule name" value={rule.name} onChange={(v) => updateNewLocationRule(index, { name: v })} />
                          <TextInput label="Weather trigger" value={rule.weather_trigger ?? ''} onChange={(v) => updateNewLocationRule(index, { weather_trigger: v || null })} hint="Optional. Example: rain" />
                          <TextInput label="Start time" value={rule.start_time ?? ''} onChange={(v) => updateNewLocationRule(index, { start_time: v || null })} hint="HH:MM" />
                          <TextInput label="End time" value={rule.end_time ?? ''} onChange={(v) => updateNewLocationRule(index, { end_time: v || null })} hint="HH:MM" />
                          <NairaInput label="Customer surcharge" value={toNaira(rule.customer_adjustment_value)} onChange={(n) => updateNewLocationRule(index, { customer_adjustment_kind: 'FIXED', customer_adjustment_value: n * 100 })} />
                          <NairaInput label="Rider bonus" value={toNaira(rule.rider_bonus_value)} onChange={(n) => updateNewLocationRule(index, { rider_bonus_kind: 'FIXED', rider_bonus_value: n * 100 })} />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {DAYS.map((day) => {
                            const active = rule.days_of_week.includes(day.key)
                            return (
                              <button
                                key={`new-rule-day-${index}-${day.key}`}
                                type="button"
                                onClick={() => updateNewLocationRule(index, { days_of_week: active ? rule.days_of_week.filter((value) => value !== day.key) : [...rule.days_of_week, day.key].sort() })}
                                className="rounded-full px-3 py-1.5 text-xs font-medium"
                                style={{ background: active ? '#F5A623' : 'rgba(255,255,255,0.08)', color: active ? '#000' : 'rgba(255,255,255,0.7)' }}
                              >
                                {day.label}
                              </button>
                            )
                          })}
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <MeterInput label="Priority" value={rule.priority} onChange={(n) => updateNewLocationRule(index, { priority: n })} />
                          <label className="mt-6 flex items-center gap-2 text-xs text-white/60">
                            <input type="checkbox" checked={rule.enabled} onChange={(e) => updateNewLocationRule(index, { enabled: e.target.checked })} className="h-4 w-4 accent-amber-500" />
                            Enabled
                          </label>
                          <button type="button" onClick={() => updateNewLocation({ rules: newLocation.rules.filter((_, ruleIndex) => ruleIndex !== index) })} className="mt-6 rounded-xl border border-red-500/25 px-3 py-2 text-xs font-semibold text-red-300">Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => void createLocation()} disabled={busyKey === 'new-location'} className="lx-btn-amber mt-4 w-full py-3.5">
                    {busyKey === 'new-location' ? 'Saving…' : 'Add location'}
                  </button>
                </div>
              )}

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

                        <label className="mt-4 flex items-start gap-2.5 rounded-2xl border border-white/10 bg-[#111113] p-3">
                          <input
                            type="checkbox"
                            checked={row.uses_lodge_catalog}
                            onChange={(e) => updateLocation(row.zone_id, { uses_lodge_catalog: e.target.checked })}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                          />
                          <span className="text-xs leading-relaxed text-white/60">
                            Use the lodge dropdown and campus map in checkout for this zone.
                          </span>
                        </label>

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

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <MeterInput label="Base distance" value={row.base_distance_meters} onChange={(n) => updateLocation(row.zone_id, { base_distance_meters: n })} />
                          <MeterInput label="Distance increment" value={row.distance_increment_meters} onChange={(n) => updateLocation(row.zone_id, { distance_increment_meters: n })} />
                          <MeterInput label="Max delivery distance" value={row.max_delivery_distance_meters} onChange={(n) => updateLocation(row.zone_id, { max_delivery_distance_meters: n })} />
                          <MeterInput label="Vendor radius" value={row.vendor_delivery_radius_meters} onChange={(n) => updateLocation(row.zone_id, { vendor_delivery_radius_meters: n })} />
                          <NairaInput label="Bike add-on per step" value={toNaira(row.bike_increment_fee_kobo)} onChange={(n) => updateLocation(row.zone_id, { bike_increment_fee_kobo: n * 100 })} />
                          <NairaInput label="Bike rider bonus per step" value={toNaira(row.bike_increment_rider_fee_kobo)} onChange={(n) => updateLocation(row.zone_id, { bike_increment_rider_fee_kobo: n * 100 })} />
                          <NairaInput label="Door add-on per step" value={toNaira(row.door_increment_fee_kobo)} onChange={(n) => updateLocation(row.zone_id, { door_increment_fee_kobo: n * 100 })} />
                          <NairaInput label="Door rider bonus per step" value={toNaira(row.door_increment_rider_fee_kobo)} onChange={(n) => updateLocation(row.zone_id, { door_increment_rider_fee_kobo: n * 100 })} />
                        </div>

                        <div className="mt-4 rounded-2xl border border-white/10 bg-[#111113] p-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-semibold text-white/80">Dynamic pricing rules</h4>
                              <p className="mt-1 text-xs text-white/45">Examples: rain, lunch rush, dinner rush, holiday, event.</p>
                            </div>
                            <button type="button" onClick={() => updateLocation(row.zone_id, { rules: [...row.rules, newRule()] })} className="rounded-xl border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-300">Add rule</button>
                          </div>
                          {row.rules.map((rule, index) => (
                            <div key={`${row.zone_id}-rule-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <TextInput label="Rule name" value={rule.name} onChange={(v) => updateLocationRule(row.zone_id, index, { name: v })} />
                                <TextInput label="Weather trigger" value={rule.weather_trigger ?? ''} onChange={(v) => updateLocationRule(row.zone_id, index, { weather_trigger: v || null })} hint="Optional. Example: rain" />
                                <TextInput label="Start time" value={rule.start_time ?? ''} onChange={(v) => updateLocationRule(row.zone_id, index, { start_time: v || null })} hint="HH:MM" />
                                <TextInput label="End time" value={rule.end_time ?? ''} onChange={(v) => updateLocationRule(row.zone_id, index, { end_time: v || null })} hint="HH:MM" />
                                <NairaInput label="Customer surcharge" value={toNaira(rule.customer_adjustment_value)} onChange={(n) => updateLocationRule(row.zone_id, index, { customer_adjustment_kind: 'FIXED', customer_adjustment_value: n * 100 })} />
                                <NairaInput label="Rider bonus" value={toNaira(rule.rider_bonus_value)} onChange={(n) => updateLocationRule(row.zone_id, index, { rider_bonus_kind: 'FIXED', rider_bonus_value: n * 100 })} />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {DAYS.map((day) => {
                                  const active = rule.days_of_week.includes(day.key)
                                  return (
                                    <button
                                      key={`${row.zone_id}-rule-${index}-day-${day.key}`}
                                      type="button"
                                      onClick={() => updateLocationRule(row.zone_id, index, { days_of_week: active ? rule.days_of_week.filter((value) => value !== day.key) : [...rule.days_of_week, day.key].sort() })}
                                      className="rounded-full px-3 py-1.5 text-xs font-medium"
                                      style={{ background: active ? '#F5A623' : 'rgba(255,255,255,0.08)', color: active ? '#000' : 'rgba(255,255,255,0.7)' }}
                                    >
                                      {day.label}
                                    </button>
                                  )
                                })}
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <MeterInput label="Priority" value={rule.priority} onChange={(n) => updateLocationRule(row.zone_id, index, { priority: n })} />
                                <label className="mt-6 flex items-center gap-2 text-xs text-white/60">
                                  <input type="checkbox" checked={rule.enabled} onChange={(e) => updateLocationRule(row.zone_id, index, { enabled: e.target.checked })} className="h-4 w-4 accent-amber-500" />
                                  Enabled
                                </label>
                                <button type="button" onClick={() => updateLocation(row.zone_id, { rules: row.rules.filter((_, ruleIndex) => ruleIndex !== index) })} className="mt-6 rounded-xl border border-red-500/25 px-3 py-2 text-xs font-semibold text-red-300">Remove</button>
                              </div>
                            </div>
                          ))}
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
