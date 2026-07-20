'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BackButton } from '@/components/back-button'
import { AlertBanner } from '@/components/ui/alert-banner'

type LocationSource = 'customer_locations' | 'saved_places'

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
  source: LocationSource
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
  const [errorBanner, setErrorBanner] = useState<{ title: string; message: string } | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const showError = (title: string, message: string) => setErrorBanner({ title, message })
  const clearError = () => setErrorBanner(null)

  async function load() {
    const [locationsRes, placesRes] = await Promise.all([
      fetch('/api/customer/locations'),
      fetch('/api/customer/places'),
    ])
    if (locationsRes.status === 401 || locationsRes.status === 403 || placesRes.status === 401 || placesRes.status === 403) {
      router.push('/auth')
      return
    }
    const locationData = locationsRes.ok ? await locationsRes.json() as { locations: CustomerLocation[] } : { locations: [] }
    const placesData = placesRes.ok ? await placesRes.json() as {
      places: Array<{
        id: string
        label: string
        landmark: string | null
        latitude: number | null
        longitude: number | null
        is_default: boolean
        last_used_at: string | null
        created_at: string
      }>
    } : { places: [] }
    const merged: CustomerLocation[] = [
      ...(locationData.locations ?? []).map((row) => ({ ...row, source: 'customer_locations' as const })),
      ...(placesData.places ?? [])
        .filter((row) => row.latitude != null && row.longitude != null)
        .map((row) => ({
          id: row.id,
          label: row.label,
          latitude: row.latitude as number,
          longitude: row.longitude as number,
          delivery_note: row.landmark,
          city_id: null,
          zone_id: null,
          is_active: row.is_default,
          created_at: row.created_at,
          updated_at: row.last_used_at ?? row.created_at,
          source: 'saved_places' as const,
        })),
    ]
    setLocations(merged)
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [])

  async function captureCurrent() {
    if (!('geolocation' in navigator)) {
      showError('Could not capture location', 'Location is not supported on this device')
      showToast('Location is not supported on this device')
      return
    }
    setSaving(true)
    navigator.geolocation.getCurrentPosition(async (pos) => {
      setLat(pos.coords.latitude.toFixed(6))
      setLng(pos.coords.longitude.toFixed(6))
      try {
        const primary = await fetch('/api/customer/locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: label.trim() || 'Current pin',
            delivery_note: note.trim() || null,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            is_active: true,
          }),
        })
        if (primary.ok) {
          showToast('GPS pin saved')
          setLabel('Current pin')
          setNote('')
          await load()
        } else {
          const fallback = await fetch('/api/customer/places', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              label: label.trim() || 'Current GPS pin',
              landmark: note.trim() || null,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              is_default: true,
            }),
          })
          if (fallback.ok) {
            showToast('GPS pin saved')
            setLabel('Current pin')
            setNote('')
            await load()
          } else {
            const data = await primary.json().catch(() => ({})) as { error?: string }
            const fallbackData = await fallback.json().catch(() => ({})) as { error?: string }
            const message = data.error ?? fallbackData.error ?? 'Could not save location'
            showError('Could not save location', message)
            showToast(message)
          }
        }
      } catch {
        showError('Could not save location', 'Network error')
        showToast('Network error')
      } finally {
        setSaving(false)
      }
    }, () => {
      setSaving(false)
      showError('Could not get location', 'Could not get your location')
      showToast('Could not get your location')
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 })
  }

  async function activate(id: string) {
    const item = locations.find((row) => row.id === id)
    const res = await fetch(item?.source === 'saved_places' ? `/api/customer/places/${id}` : `/api/customer/locations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item?.source === 'saved_places' ? { is_default: true } : { is_active: true }),
    })
    if (res.ok) {
      showToast('Location set as active')
      await load()
    } else {
      showError('Could not update location', 'Could not update location')
      showToast('Could not update location')
    }
  }

  async function remove(id: string) {
    const item = locations.find((row) => row.id === id)
    const res = await fetch(item?.source === 'saved_places' ? `/api/customer/places/${id}` : `/api/customer/locations/${id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('Location removed')
      await load()
    } else {
      showError('Could not remove location', 'Could not remove location')
      showToast('Could not remove location')
    }
  }

  return (
    <div className="lx-page px-4 py-8">
      <AlertBanner open={!!errorBanner} title={errorBanner?.title ?? ''} message={errorBanner?.message ?? ''} onDismiss={clearError} />
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
