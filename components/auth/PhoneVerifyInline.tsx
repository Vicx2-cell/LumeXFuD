'use client'

import { useState } from 'react'

// Inline OTP step for the admin/super-admin "create account" forms. The admin
// sends a WhatsApp code to the new vendor/rider/admin's number and enters it back
// (the new owner reads it during onboarding). On success the server sets a signed,
// single-use `phone_verified` cookie scoped to admin_create that the create route
// checks. Mirrors the sign-up verification UI on /auth/register.
export default function PhoneVerifyInline({
  phone,
  verified,
  onVerified,
}: {
  phone: string
  verified: boolean
  onVerified: () => void
}) {
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const sendCode = async () => {
    setError('')
    setNote('')
    if (phone.length < 13) { setError('Enter the phone number first.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'admin_create' }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not send the code.'); return }
      setCodeSent(true)
      setNote('Code sent to their WhatsApp.')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async () => {
    setError('')
    setNote('')
    if (code.length !== 6) { setError('Enter the 6-digit code.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Verification failed.'); return }
      onVerified()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (verified) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: '#34d399' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
        Phone number verified
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0f0f11] p-4 space-y-3">
      {!codeSent ? (
        <button
          type="button"
          onClick={sendCode}
          disabled={busy || phone.length < 13}
          className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 py-3 text-sm font-semibold text-amber-400 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send verification code'}
        </button>
      ) : (
        <>
          <p className="text-xs text-white/50">Enter the 6-digit code sent to {phone}.</p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setError('') }}
              className="flex-1 rounded-xl border border-white/10 bg-[#111113] px-4 py-3 text-center text-white tracking-[0.4em] outline-none"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
            />
            <button
              type="button"
              onClick={verifyCode}
              disabled={busy || code.length !== 6}
              className="rounded-xl bg-amber-500 px-5 text-sm font-semibold text-black disabled:opacity-50"
            >
              {busy ? '…' : 'Verify'}
            </button>
          </div>
          <button
            type="button"
            onClick={sendCode}
            disabled={busy}
            className="text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
          >
            Resend code
          </button>
        </>
      )}
      {note && <p className="text-xs" style={{ color: '#34d399' }}>{note}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
