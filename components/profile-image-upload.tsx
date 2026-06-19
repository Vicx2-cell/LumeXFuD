'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'

/**
 * Upload + save a profile image for the current user. Posts to /api/profile/image
 * (which resizes, stores in the public menu-images bucket, and writes the URL to
 * the user's row). `slot='avatar'` → round; `slot='cover'` → wide banner (vendor).
 * Presentational shell around that one endpoint — no role logic here.
 */
export function ProfileImageUpload({
  slot,
  current,
  shape = 'circle',
  size = 84,
  label,
  deletable = false,
  onUploaded,
  onRemoved,
  className = '',
}: {
  slot: 'avatar' | 'cover'
  current: string | null
  shape?: 'circle' | 'cover'
  size?: number
  label?: string
  deletable?: boolean
  onUploaded?: (url: string) => void
  onRemoved?: () => void
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string | null>(current)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function remove() {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/profile/image?slot=${slot}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setErr(d.error ?? 'Could not remove'); return }
      setUrl(null)
      onRemoved?.()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function pick(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setErr('JPG, PNG or WebP only'); return }
    if (file.size > 5 * 1024 * 1024) { setErr('Max 5MB'); return }
    setBusy(true); setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('slot', slot)
      const res = await fetch('/api/profile/image', { method: 'POST', body: fd })
      const d = await res.json() as { url?: string; error?: string }
      if (!res.ok || !d.url) { setErr(d.error ?? 'Upload failed'); return }
      setUrl(d.url)
      onUploaded?.(d.url)
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  const isCover = shape === 'cover'
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={isCover ? 'Change cover photo' : 'Change profile photo'}
        className={`relative overflow-hidden block ${isCover ? 'w-full rounded-2xl' : 'rounded-full'}`}
        style={isCover ? { aspectRatio: '16 / 6', border: '1px solid rgba(255,255,255,0.1)' } : { width: size, height: size, border: '2px solid rgba(245,166,35,0.4)' }}
      >
        {url ? (
          <Image src={url} alt="" fill className="object-cover" sizes={isCover ? '100vw' : `${size}px`} />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <span className="text-2xl opacity-30">{isCover ? '🖼️' : '👤'}</span>
          </div>
        )}
        {/* Camera badge / uploading scrim */}
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-white" style={{ background: 'rgba(0,0,0,0.5)' }}>Uploading…</span>
        ) : (
          <span className="lx-icon-badge absolute bottom-1 right-1 w-7 h-7 rounded-full text-sm" style={{ background: 'rgba(10,10,11,0.7)' }} aria-hidden="true">📷</span>
        )}
      </button>
      {label && <p className="text-xs text-white/45 mt-1.5">{label}</p>}
      {deletable && url && !busy && (
        <button type="button" onClick={remove} className="text-[11px] font-medium text-red-400/80 hover:text-red-400 mt-1.5">Remove photo</button>
      )}
      {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
    </div>
  )
}
