'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { LodgeMap } from '@/components/lodge-map'
import { directionsUrl } from '@/lib/maps'
import { ADDRESS_MAX, LANDMARK_MAX } from '@/lib/vendor-location'

export interface VendorLocationInit {
  id: string
  address_text: string | null
  landmark: string | null
  latitude: number | null
  longitude: number | null
  location_photo_url: string | null
}

// Vendor "Where is your store?" editor. Reuses the exact capture pattern proven
// in the customer Saved Places page (geolocation OR tap-to-pin via LodgeMap +
// optional photo), but writes the PUBLIC store location so customers and riders
// can find and navigate to the shop. Kept deliberately simple: one address line,
// one landmark cue, one tap to pin, one photo.
export function VendorLocationEditor({ initial }: { initial: VendorLocationInit }) {
  const [address, setAddress] = useState(initial.address_text ?? '')
  const [landmark, setLandmark] = useState(initial.landmark ?? '')
  const [lat, setLat] = useState(initial.latitude != null ? String(initial.latitude) : '')
  const [lng, setLng] = useState(initial.longitude != null ? String(initial.longitude) : '')
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial.location_photo_url)
  const [geoBusy, setGeoBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const hasPin = lat.trim() !== '' && lng.trim() !== '' && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))
  const dirUrl = hasPin ? directionsUrl(Number(lat), Number(lng)) : null

  function captureLocation() {
    if (!('geolocation' in navigator)) { show('Location not supported on this device'); return }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6))
        setLng(pos.coords.longitude.toFixed(6))
        setGeoBusy(false)
        show('Pin dropped on your spot ✓')
      },
      (err) => {
        setGeoBusy(false)
        show(err.code === err.PERMISSION_DENIED ? 'Allow location access to use this' : 'Could not get your location')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (e.target) e.target.value = ''
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { show('Image too large (max 5MB)'); return }
    setPhotoBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('slot', 'storefront')
      const res = await fetch('/api/profile/image', { method: 'POST', body: fd })
      const d = await res.json() as { url?: string; error?: string }
      if (res.ok && d.url) { setPhotoUrl(d.url); show('Storefront photo added ✓') }
      else show(d.error ?? 'Could not upload photo')
    } catch { show('Network error') }
    finally { setPhotoBusy(false) }
  }

  async function removePhoto() {
    setPhotoBusy(true)
    try {
      const res = await fetch('/api/profile/image?slot=storefront', { method: 'DELETE' })
      if (res.ok) { setPhotoUrl(null); show('Photo removed') } else show('Could not remove photo')
    } catch { show('Network error') }
    finally { setPhotoBusy(false) }
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        address_text: address.trim() || null,
        landmark: landmark.trim() || null,
      }
      if (hasPin) { body.latitude = Number(lat); body.longitude = Number(lng) }
      else { body.latitude = null; body.longitude = null }
      const res = await fetch(`/api/vendors/${initial.id}/location`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json() as { error?: string }
      show(res.ok ? 'Location saved — customers can find you now ✓' : (d.error ?? 'Could not save'))
    } catch { show('Network error') }
    finally { setSaving(false) }
  }

  const nothingSet = !hasPin && !address.trim() && !landmark.trim() && !initial.address_text && !initial.latitude

  return (
    <div className="lx-surface p-4 space-y-3">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div>
        <p className="text-sm font-medium text-white/80 flex items-center gap-1.5">📍 Where is your store?</p>
        <p className="text-xs text-white/45 mt-0.5">Customers and riders see this so they can find you. Drop a pin and they get one-tap directions straight to your door.</p>
      </div>

      {nothingSet && (
        <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(245,166,35,0.1)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}>
          You haven’t added your location yet — riders may struggle to find you. Add it below 👇
        </div>
      )}

      {/* Address line */}
      <div>
        <label className="text-xs text-white/50 block mb-1">Address / directions</label>
        <input
          value={address} onChange={(e) => setAddress(e.target.value)} maxLength={ADDRESS_MAX}
          placeholder="e.g. Shop 4, Uturu market road, beside First Bank"
          className="lx-field w-full px-3 py-2.5 text-sm"
        />
      </div>

      {/* Landmark */}
      <div>
        <label className="text-xs text-white/50 block mb-1">Landmark for the rider (optional)</label>
        <input
          value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={LANDMARK_MAX}
          placeholder="e.g. Opposite the ABSU main gate, blue gate"
          className="lx-field w-full px-3 py-2.5 text-sm"
        />
      </div>

      {/* Pin */}
      <button type="button" onClick={captureLocation} disabled={geoBusy}
        className="w-full py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
        style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}>
        {geoBusy ? 'Getting your location…' : hasPin ? '📍 Update my pin to where I am now' : '📍 Pin my store (use my current location)'}
      </button>
      <p className="text-xs text-white/40">Stand at your shop and tap the button, or tap the map to drop the pin yourself.</p>
      <LodgeMap
        lodges={[]}
        height={220}
        onPick={(la, ln) => { setLat(la.toFixed(6)); setLng(ln.toFixed(6)) }}
        pin={hasPin ? { lat: Number(lat), lng: Number(lng) } : null}
      />
      {hasPin && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-white/45">✓ Pinned</span>
          <div className="flex items-center gap-2">
            {dirUrl && (
              <a href={dirUrl} target="_blank" rel="noopener noreferrer" className="font-medium" style={{ color: '#F5A623' }}>
                Test directions ↗
              </a>
            )}
            <button type="button" onClick={() => { setLat(''); setLng('') }} className="text-red-400/80">Clear pin</button>
          </div>
        </div>
      )}

      {/* Storefront photo */}
      <div>
        <label className="text-xs text-white/50 block mb-1">Photo of your storefront (optional)</label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
            className="py-2.5 px-3 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {photoBusy ? 'Uploading…' : photoUrl ? '✓ Change photo' : '📷 Add a photo'}
          </button>
          {photoUrl && (
            <>
              <span className="relative h-12 w-16 rounded-lg overflow-hidden shrink-0 bg-white/5">
                <Image src={photoUrl} alt="" fill className="object-cover" sizes="64px" />
              </span>
              <button type="button" onClick={removePhoto} disabled={photoBusy} className="text-xs text-red-400/80">Remove</button>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhoto} className="hidden" />
        </div>
        <p className="text-xs text-white/35 mt-1.5">A street-view shot helps a rider recognise your shop instantly.</p>
      </div>

      <button onClick={save} disabled={saving} className="lx-btn-amber w-full py-3 text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Save my location'}
      </button>
    </div>
  )
}
