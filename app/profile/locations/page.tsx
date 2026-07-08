'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BackButton } from '@/components/back-button'

interface CustomerLocation {
  id: string
  label: string
  latitude: number
  longitude: number
  delivery_note: string | null
  city_id: string | null
  zone_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export default function ProfileLocationsPage() {
  const router = useRouter()
  const [locations, setLocations] = useState<CustomerLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [label, setLabel] = useState('Current pin')
  const [note, setNote] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    const res = await fetch('/api/customer/locations')
    if (res.status === 401 || res.status === 403) {
      router.push('/auth')
      return
    }
    if (res.ok) {
      const data = await res.json() as { locations: CustomerLocation[] }
      setLocations(data.locations ?? [])
    }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [])

  async function captureCurrent() {
    if (!('geolocation' in navigator)) {
      showToast('Location is not supported on this device')
      return
    }
    setSaving(true)
    navigator.geolocation.getCurrentPosition(async (pos) => {
      setLat(pos.coords.latitude.toFixed(6))
      setLng(pos.coords.longitude.toFixed(6))
      const body: Record<string, unknown> = {
        label: label.trim() || 'Current pin',
        delivery_note: note.trim() || null,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        is_active: true,
      }
      try {
        const res = await fetch('/api/customer/locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (res.ok) {
          showToast('GPS pin saved')
          setLabel('Current pin')
          setNote('')
          await load()
        } else {
          showToast(data.error ?? 'Could not save location')
        }
      } catch {
        showToast('Network error')
      } finally {
        setSaving(false)
      }
    }, () => {
      setSaving(false)
      showToast('Could not get your location')
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 })
  }

  async function activate(id: string) {
    const res = await fetch(`/api/customer/locations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    })
    if (res.ok) {
      showToast('Location set as active')
      await load()
    } else {
      showToast('Could not update location')
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/customer/locations/${id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('Location removed')
      await load()
    } else {
      showToast('Could not remove location')
    }
  }

  return (
    <div className="lx-page px-4 py-8">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>}
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <BackButton />
          <h1 className="text-xl font-bold text-white">GPS pins</h1>
        </div>

        <div className="glass-thin p-4 space-y-3 mb-5">
          <p className="text-xs uppercase tracking-wide text-white/40 font-semibold">Capture current location</p>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="lx-field w-full px-3 py-2.5 text-sm" placeholder="Label" />
          <input value={note} onChange={(e) => setNote(e.target.value)} className="lx-field w-full px-3 py-2.5 text-sm" placeholder="Delivery note (optional)" />
          <button onClick={captureCurrent} disabled={saving} className="lx-btn-amber w-full py-3 text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Use my current location'}
          </button>
          <p className="text-xs text-white/40">
            {lat && lng ? `Last captured: ${lat}, ${lng}` : 'Capture a GPS pin before placing delivery orders.'}
          </p>
        </div>

        {loading ? (
          <p className="text-white/40 text-sm text-center py-8">Loading…</p>
        ) : locations.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-8">No GPS pins yet.</p>
        ) : (
          <div className="space-y-2">
            {locations.map((location) => (
              <div key={location.id} className="glass-thin p-3 flex items-center gap-3">
                <div className="h-11 w-11 rounded-lg shrink-0 flex items-center justify-center text-lg" style={{ background: 'rgba(245,166,35,0.12)' }}>📍</div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white text-sm truncate">
                    {location.label}
                    {location.is_active && <span className="ml-2 text-xs" style={{ color: '#F5A623' }}>active</span>}
                  </p>
                  <p className="text-xs text-white/40 truncate">
                    {location.delivery_note ?? '—'} · {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!location.is_active && (
                    <button onClick={() => activate(location.id)} className="text-xs px-2.5 py-2 rounded-full font-medium" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}>
                      Set active
                    </button>
                  )}
                  <button onClick={() => remove(location.id)} className="text-xs px-2.5 py-2 rounded-full font-medium" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
