'use client'

import { useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { useFeatures } from '@/lib/use-features'

/**
 * Opt-in Face ID / Touch ID (WebAuthn passkey) enrolment. Works for any
 * logged-in role — the server routes derive identity from the session, so this
 * component is identity-agnostic and can be dropped into any profile screen.
 */
export function FaceIdSetup() {
  const features = useFeatures()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState('')
  const [err, setErr]   = useState('')

  async function setup() {
    setBusy(true); setMsg(''); setErr('')
    try {
      const optRes = await fetch('/api/auth/webauthn/register-options', { method: 'POST' })
      const options = await optRes.json()
      if (!optRes.ok) { setErr(options.error ?? 'Could not start setup'); return }
      const attestation = await startRegistration({ optionsJSON: options })
      const verRes = await fetch('/api/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attestation),
      })
      const data = await verRes.json() as { error?: string }
      if (!verRes.ok) { setErr(data.error ?? 'Setup failed'); return }
      setMsg('Face ID is now required at login. ✓')
    } catch (e) {
      const name = (e as { name?: string })?.name
      setErr(name === 'NotAllowedError'
        ? 'Setup was cancelled.'
        : 'Face ID / Touch ID is not available on this device.')
    } finally {
      setBusy(false)
    }
  }

  // Hidden when a super admin turns off the Face ID feature.
  if (features.face_id === false) return null

  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.18)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5A623" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M4 16v2a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M16 20h2a2 2 0 0 0 2-2v-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/></svg>
          <div className="min-w-0">
            <p className="text-sm font-medium">Face ID / Touch ID</p>
            <p className="text-xs text-white/45">Extra protection after your PIN</p>
          </div>
        </div>
        <button onClick={setup} disabled={busy} className="lx-btn-amber text-xs px-3 py-2 shrink-0">
          {busy ? 'Setting up…' : 'Set up'}
        </button>
      </div>
      {msg && <p className="text-emerald-400 text-xs mt-2">{msg}</p>}
      {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
    </div>
  )
}
