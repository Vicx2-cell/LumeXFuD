'use client'

import { useEffect, useState } from 'react'

// Mandatory KYC selfie gate for vendors & riders. Wrap a page's content:
//   <FaceGate role="rider"><Dashboard/></FaceGate>
// While the photo is missing, the children are NOT rendered — the upload screen
// blocks the dashboard until a selfie is on file. Customers are never gated.
export function FaceGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'needed' | 'ok'>('checking')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/auth/face/status')
      .then((r) => r.ok ? r.json() : { has_face: true })
      .then((d: { has_face: boolean }) => setState(d.has_face ? 'ok' : 'needed'))
      .catch(() => setState('ok')) // never lock out on a network blip
  }, [])

  async function upload() {
    if (!file || busy) return
    setBusy(true); setError('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch('/api/auth/face', { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok) { setError(d.error ?? 'Upload failed. Try again.'); return }
      setState('ok')
    } catch { setError('Network error. Try again.') }
    finally { setBusy(false) }
  }

  if (state === 'ok') return <>{children}</>
  if (state === 'checking') {
    return <div className="lx-page flex items-center justify-center"><p className="text-white/40 text-sm">Loading…</p></div>
  }

  // state === 'needed'
  return (
    <div className="lx-page flex items-center justify-center px-5 py-12 overflow-hidden">
      <div className="w-full max-w-md space-y-6 lx-enter">
        <div className="glass p-6">
          <span className="text-4xl" aria-hidden="true">🪪</span>
          <h1 className="text-2xl font-bold text-white mt-3">Put a face to your earnings</h1>
          {/* Reverse-psychology reason: skipping looks suspicious; uploading is the
              confident, get-paid move. Frames it as protecting the honest user. */}
          <p className="mt-2 text-sm text-white/65 leading-relaxed">
            We don’t ask this of customers — only people who move real money on LumeX, like you. Here’s the honest reason:
          </p>
          <ul className="mt-3 space-y-2 text-sm text-white/65">
            <li className="flex gap-2"><span aria-hidden="true">🛡️</span> If a customer ever falsely accuses you, this photo is what <b className="text-white">clears your name</b>.</li>
            <li className="flex gap-2"><span aria-hidden="true">💸</span> Verified accounts get paid without friction. Unverified ones are the first we freeze when fraud is reported.</li>
            <li className="flex gap-2"><span aria-hidden="true">🤝</span> Honest riders &amp; vendors have nothing to hide — it takes 5 seconds.</li>
          </ul>
          <p className="mt-3 text-xs text-white/35">Private &amp; encrypted. Only LumeX support can ever view it, and only if there’s a complaint.</p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="w-36 h-36 rounded-full overflow-hidden flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.05)', border: '2px dashed rgba(245,166,35,0.45)' }}>
            {preview ? <img src={preview} alt="Your selfie" className="w-full h-full object-cover" /> : <span className="text-5xl" aria-hidden="true">📸</span>}
          </div>
          <label className="lx-btn-amber px-5 py-3 text-sm cursor-pointer">
            {preview ? 'Retake / choose another' : 'Take your photo'}
            <input type="file" accept="image/*" capture="user" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setError(''); setFile(f); setPreview(URL.createObjectURL(f)) }} />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="button" disabled={!file || busy} onClick={upload}
            className="w-full rounded-2xl bg-amber-500 py-4 text-sm font-semibold text-black disabled:opacity-50">
            {busy ? 'Uploading…' : 'Verify & continue'}
          </button>
          <p className="text-xs text-white/30 text-center">Face the light · no cap or sunglasses.</p>
        </div>
      </div>
    </div>
  )
}
