'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BackButton } from '@/components/back-button'
import { LodgeMap } from '@/components/lodge-map'

interface Lodge {
  id: string
  name: string
  area: string | null
  latitude: number | null
  longitude: number | null
  is_verified: boolean
  is_active: boolean
  created_at: string
}

export default function AdminLodgesPage() {
  const router = useRouter()
  const [lodges, setLodges] = useState<Lodge[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  // Add form
  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [geoBusy, setGeoBusy] = useState(false)

  // Capture the device's GPS (use while standing at the lodge). HTTPS + a one-time
  // browser permission prompt required; both are fine on the live site.
  function useMyLocation() {
    if (!('geolocation' in navigator)) { showToast('Location not supported on this device'); return }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6))
        setLng(pos.coords.longitude.toFixed(6))
        setGeoBusy(false)
        showToast('Location captured')
      },
      (err) => {
        setGeoBusy(false)
        showToast(err.code === err.PERMISSION_DENIED ? 'Allow location access to use this' : 'Could not get your location')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  async function load() {
    const res = await fetch('/api/admin/lodges')
    if (res.status === 401 || res.status === 403) { router.push('/auth'); return }
    if (res.ok) { const d = await res.json() as { lodges: Lodge[] }; setLodges(d.lodges) }
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function addLodge() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = { name: name.trim() }
      if (area.trim()) body.area = area.trim()
      if (lat.trim() && !Number.isNaN(Number(lat))) body.latitude = Number(lat)
      if (lng.trim() && !Number.isNaN(Number(lng))) body.longitude = Number(lng)
      const res = await fetch('/api/admin/lodges', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json() as { lodge?: Lodge; error?: string }
      if (res.ok && d.lodge) {
        setLodges((cur) => [d.lodge!, ...cur])
        setName(''); setArea(''); setLat(''); setLng('')
        showToast('Lodge added')
      } else { showToast(d.error ?? 'Could not add') }
    } catch { showToast('Network error') }
    finally { setBusy(false) }
  }

  async function patch(id: string, patch: Partial<Pick<Lodge, 'is_verified' | 'is_active'>>, msg: string) {
    const prev = lodges
    setLodges((cur) => cur.map((l) => l.id === id ? { ...l, ...patch } : l)) // optimistic
    try {
      const res = await fetch(`/api/admin/lodges/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      if (res.ok) showToast(msg); else { setLodges(prev); showToast('Could not save') }
    } catch { setLodges(prev); showToast('Network error') }
  }

  async function remove(id: string) {
    const prev = lodges
    setLodges((cur) => cur.filter((l) => l.id !== id)) // optimistic
    try {
      const res = await fetch(`/api/admin/lodges/${id}`, { method: 'DELETE' })
      if (res.ok) showToast('Lodge deleted'); else { setLodges(prev); showToast('Could not delete') }
    } catch { setLodges(prev); showToast('Network error') }
  }

  return (
    <div className="lx-page px-5 py-10 overflow-hidden">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>}

      <div className="mx-auto max-w-lg lx-enter">
        <div className="mb-6 flex items-center gap-3"><BackButton /><h1 className="text-xl font-bold text-white">ABSU Lodges</h1></div>
        <p className="text-sm text-white/45 mb-5">Add as many campus lodges/landmarks as you like. Verified lodges show up for customers at checkout. Coordinates are optional (used by the campus map).</p>

        {/* Add form */}
        <div className="glass-thin p-4 mb-6 space-y-3">
          <p className="text-xs uppercase tracking-wide text-white/40 font-semibold">Add a lodge</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lodge name (e.g. Chinaza Lodge)"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Area / landmark (optional, e.g. Behind Main Gate)"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
          <div className="flex gap-2">
            <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude (optional)" inputMode="decimal"
              className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
            <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude (optional)" inputMode="decimal"
              className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
          </div>

          {/* GPS capture — easiest when physically at the lodge. */}
          <button type="button" onClick={useMyLocation} disabled={geoBusy}
            className="w-full py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}>
            {geoBusy ? 'Getting location…' : '📍 Use my current location'}
          </button>

          {/* Tap the map to set the new lodge's coordinates; existing lodges are plotted. */}
          <p className="text-xs text-white/40">Or tap the map to drop a pin for the lodge above.</p>
          <LodgeMap
            lodges={lodges}
            height={240}
            onPick={(la, ln) => { setLat(la.toFixed(6)); setLng(ln.toFixed(6)) }}
            pin={lat.trim() && lng.trim() && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null}
          />

          <button onClick={addLodge} disabled={busy || !name.trim()} className="lx-btn-amber w-full py-3 text-sm disabled:opacity-50">
            {busy ? 'Saving…' : 'Add lodge'}
          </button>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-white/40 text-sm text-center py-8">Loading…</p>
        ) : lodges.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-8">No lodges yet. Add your first above.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-white/40">{lodges.length} lodge{lodges.length === 1 ? '' : 's'}</p>
            {lodges.map((l) => (
              <div key={l.id} className="glass-thin p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-white text-sm truncate">{l.name}</p>
                  <p className="text-xs text-white/40 truncate">
                    {l.area ?? '—'}
                    {l.latitude != null && l.longitude != null ? ` · 📍 ${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)}` : ' · no coords'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => patch(l.id, { is_verified: !l.is_verified }, l.is_verified ? 'Unverified' : 'Verified')}
                    className="text-xs px-2 py-1 rounded-full font-medium"
                    style={{ background: l.is_verified ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)', color: l.is_verified ? '#22c55e' : 'rgba(255,255,255,0.5)' }}>
                    {l.is_verified ? '✓ Verified' : 'Verify'}
                  </button>
                  <button onClick={() => remove(l.id)} aria-label="Delete lodge" className="text-xs px-2 py-1 rounded-full" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                    Delete
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
