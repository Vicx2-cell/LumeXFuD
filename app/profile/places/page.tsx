'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BackButton } from '@/components/back-button'
import { LodgeMap } from '@/components/lodge-map'
import { MAX_SAVED_PLACES, placeToAddress } from '@/lib/saved-places'

interface Place {
  id: string
  label: string
  landmark: string | null
  latitude: number | null
  longitude: number | null
  photo_url: string | null
  is_default: boolean
  use_count: number
  last_used_at: string | null
  created_at: string
}

export default function SavedPlacesPage() {
  const router = useRouter()
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  // Add form
  const [label, setLabel] = useState('')
  const [landmark, setLandmark] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [makeUsual, setMakeUsual] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function captureLocation() {
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

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { showToast('Image too large (max 5MB)'); return }
    setPhotoBusy(true)
    setPhotoPreview(URL.createObjectURL(f))
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/customer/places/photo', { method: 'POST', body: fd })
      const d = await res.json() as { path?: string; error?: string }
      if (res.ok && d.path) { setPhotoPath(d.path); showToast('Photo added') }
      else { setPhotoPath(null); setPhotoPreview(null); showToast(d.error ?? 'Could not upload photo') }
    } catch { setPhotoPath(null); setPhotoPreview(null); showToast('Network error') }
    finally { setPhotoBusy(false) }
  }

  async function load() {
    const res = await fetch('/api/customer/places')
    if (res.status === 401 || res.status === 403) { router.push('/auth'); return }
    if (res.ok) { const d = await res.json() as { places: Place[] }; setPlaces(d.places) }
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  function resetForm() {
    setLabel(''); setLandmark(''); setLat(''); setLng(''); setMakeUsual(false)
    setPhotoPath(null); setPhotoPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function addPlace() {
    if (!label.trim() || busy) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = { label: label.trim() }
      if (landmark.trim()) body.landmark = landmark.trim()
      if (lat.trim() && lng.trim() && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
        body.latitude = Number(lat); body.longitude = Number(lng)
      }
      if (photoPath) body.photo_path = photoPath
      if (makeUsual) body.is_default = true
      const res = await fetch('/api/customer/places', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json() as { place?: Place; error?: string }
      if (res.ok && d.place) {
        await load() // re-sort (default first) + pick up signed photo URL
        resetForm()
        showToast('Place saved')
      } else { showToast(d.error ?? 'Could not save') }
    } catch { showToast('Network error') }
    finally { setBusy(false) }
  }

  async function setUsual(id: string) {
    const prev = places
    setPlaces((cur) => cur.map((p) => ({ ...p, is_default: p.id === id }))) // optimistic
    try {
      const res = await fetch(`/api/customer/places/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }),
      })
      if (res.ok) { await load(); showToast('Set as your usual') } else { setPlaces(prev); showToast('Could not save') }
    } catch { setPlaces(prev); showToast('Network error') }
  }

  async function remove(id: string) {
    const prev = places
    setPlaces((cur) => cur.filter((p) => p.id !== id)) // optimistic
    try {
      const res = await fetch(`/api/customer/places/${id}`, { method: 'DELETE' })
      if (res.ok) showToast('Place removed'); else { setPlaces(prev); showToast('Could not remove') }
    } catch { setPlaces(prev); showToast('Network error') }
  }

  // Reuse: bump usage, stash the address for the cart to pre-fill, go to checkout.
  async function goOrderHere(p: Place) {
    try {
      const res = await fetch(`/api/customer/places/${p.id}/use`, { method: 'POST' })
      const d = await res.json() as { address?: string }
      const addr = d.address ?? placeToAddress(p)
      try { sessionStorage.setItem('lx_prefill_address', addr) } catch { /* ignore */ }
      router.push('/cart')
    } catch { showToast('Network error') }
  }

  const atCap = places.length >= MAX_SAVED_PLACES
  const usual = places.find((p) => p.is_default) ?? null

  return (
    <div className="lx-page px-5 py-10 overflow-hidden">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>}

      <div className="mx-auto max-w-lg lx-enter">
        <div className="mb-6 flex items-center gap-3"><BackButton /><h1 className="text-xl font-bold text-white">Saved places</h1></div>
        <p className="text-sm text-white/45 mb-5">Save where you order to — home, hostel, a friend’s lodge — with a pin, a landmark for the rider, and a photo of the spot. Mark one as <span className="text-white/70">your usual</span> to reuse it in one tap at checkout.</p>

        {/* Your usual highlight */}
        {usual && (
          <div className="glass-thin p-4 mb-5 flex items-center justify-between gap-3" style={{ border: '1px solid rgba(245,166,35,0.3)' }}>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide font-semibold mb-0.5" style={{ color: '#F5A623' }}>★ Your usual</p>
              <p className="font-medium text-white text-sm truncate">{usual.label}</p>
              {usual.landmark && <p className="text-xs text-white/40 truncate">{usual.landmark}</p>}
            </div>
            <button onClick={() => goOrderHere(usual)} className="lx-btn-amber px-4 py-2 text-sm shrink-0">Order here</button>
          </div>
        )}

        {/* Add form */}
        <div className="glass-thin p-4 mb-6 space-y-3">
          <p className="text-xs uppercase tracking-wide text-white/40 font-semibold">Save a place</p>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Home, Hostel B)" maxLength={60}
            className="lx-field w-full px-3 py-2.5 text-sm" />
          <input value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Landmark for the rider (optional)" maxLength={120}
            className="lx-field w-full px-3 py-2.5 text-sm" />

          {/* Optional photo */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
              className="py-2.5 px-3 rounded-xl text-sm font-medium disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}>
              {photoBusy ? 'Uploading…' : photoPath ? '✓ Photo added' : '📷 Add a photo (optional)'}
            </button>
            {photoPreview && <img src={photoPreview} alt="" className="h-12 w-12 rounded-lg object-cover" />}
            <input ref={fileRef} type="file" accept="image/*" onChange={onPhoto} className="hidden" />
          </div>

          {/* Pin */}
          <button type="button" onClick={captureLocation} disabled={geoBusy}
            className="w-full py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}>
            {geoBusy ? 'Getting location…' : '📍 Use my current location'}
          </button>
          <p className="text-xs text-white/40">Or tap the map to drop a pin.</p>
          <LodgeMap
            lodges={[]}
            height={220}
            onPick={(la, ln) => { setLat(la.toFixed(6)); setLng(ln.toFixed(6)) }}
            pin={lat.trim() && lng.trim() && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null}
          />

          <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer select-none">
            <input type="checkbox" checked={makeUsual} onChange={(e) => setMakeUsual(e.target.checked)} />
            Make this my usual
          </label>

          <button onClick={addPlace} disabled={busy || !label.trim() || atCap} className="lx-btn-amber w-full py-3 text-sm disabled:opacity-50">
            {busy ? 'Saving…' : atCap ? `Limit reached (${MAX_SAVED_PLACES})` : 'Save place'}
          </button>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-white/40 text-sm text-center py-8">Loading…</p>
        ) : places.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-8">No saved places yet. Save your first above.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-white/40">{places.length} of {MAX_SAVED_PLACES} saved</p>
            {places.map((p) => (
              <div key={p.id} className="glass-thin p-3 flex items-center gap-3">
                {p.photo_url
                  ? <img src={p.photo_url} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0" />
                  : <div className="h-12 w-12 rounded-lg shrink-0 flex items-center justify-center text-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>📍</div>}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white text-sm truncate">
                    {p.label}
                    {p.is_default && <span className="ml-2 text-xs" style={{ color: '#F5A623' }}>★ usual</span>}
                  </p>
                  <p className="text-xs text-white/40 truncate">
                    {p.landmark ?? '—'}
                    {p.latitude != null && p.longitude != null ? ` · 📍 pinned` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!p.is_default && (
                    <button onClick={() => setUsual(p.id)} className="text-xs px-2.5 py-2 rounded-full font-medium"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>Set usual</button>
                  )}
                  <button onClick={() => goOrderHere(p)} className="text-xs px-2.5 py-2 rounded-full font-medium"
                    style={{ background: 'rgba(245,166,35,0.15)', color: '#F5A623' }}>Order here</button>
                  <button onClick={() => remove(p.id)} aria-label="Remove place" className="text-xs px-2.5 py-2 rounded-full"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
