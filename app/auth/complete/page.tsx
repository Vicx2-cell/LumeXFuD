'use client'

import { useEffect, useState } from 'react'
import { useFeatures } from '@/lib/use-features'

// Final step of "Continue with Google": a verified Google identity adds and
// verifies a phone number, so the account we create holds the exact same data
// as a phone sign-up. Reuses the existing register OTP routes for verification.
export default function CompleteSignupPage() {
  const features = useFeatures()
  const verificationRequired = features.phone_verification !== false

  const [ready, setReady] = useState(false)         // pending session confirmed?
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('+234')
  // Read the deep-link destination once, at first render (client-only) — keeps
  // it out of the effect so we don't setState synchronously in an effect body.
  const [nextPath] = useState(() => {
    if (typeof window === 'undefined') return '/'
    const n = new URLSearchParams(window.location.search).get('next')
    return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'
  })

  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [alreadyRegistered, setAlreadyRegistered] = useState(false)

  // Confirm the pending Google session is alive + prefill the name. If it has
  // expired, bounce back to login with a clear message.
  useEffect(() => {
    fetch('/api/auth/social/complete')
      .then(async (res) => {
        if (!res.ok) { window.location.assign('/auth?error=google_state'); return }
        const data = await res.json() as { name?: string }
        if (data.name) setName(data.name)
        setReady(true)
      })
      .catch(() => window.location.assign('/auth?error=google_state'))
  }, [])

  const onPhoneChange = (raw: string) => {
    const v = raw.replace(/\s/g, '')
    let normalized = v
    if (v.startsWith('0')) normalized = '+234' + v.slice(1)
    else if (v.startsWith('234') && !v.startsWith('+')) normalized = '+' + v
    else if (!v.startsWith('+')) normalized = '+234' + v
    setPhone(normalized)
    setPhoneVerified(false)
    setCodeSent(false)
    setCode('')
    setError('')
    setAlreadyRegistered(false)
  }

  const sendCode = async () => {
    setBusy(true); setError(''); setNote(''); setAlreadyRegistered(false)
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'signup' }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; already_registered?: boolean }
      if (!res.ok) {
        setError(data.error ?? 'Could not send the code.')
        setAlreadyRegistered(Boolean(data.already_registered))
        return
      }
      setCodeSent(true)
      setNote('We sent a 6-digit code to your WhatsApp.')
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; verified?: boolean }
      if (!res.ok) { setError(data.error ?? 'Incorrect code.'); return }
      setPhoneVerified(true)
      setNote('Phone verified ✓')
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true); setError(''); setAlreadyRegistered(false)
    try {
      const res = await fetch('/api/auth/social/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone }),
      })
      const data = await res.json().catch(() => ({})) as {
        error?: string; redirect_path?: string; restart?: boolean; already_registered?: boolean
      }
      if (!res.ok) {
        if (data.restart) { window.location.assign('/auth?error=google_state'); return }
        setError(data.error ?? 'Could not finish sign-up.')
        setAlreadyRegistered(Boolean(data.already_registered))
        return
      }
      const dest = nextPath !== '/' ? nextPath : (data.redirect_path ?? '/home')
      window.location.assign(dest)
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const phoneOk = phone.length >= 13
  const canFinish = name.trim().length > 0 && phoneOk && (!verificationRequired || phoneVerified)

  if (!ready) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-5" style={{ background: '#0A0A0B' }}>
        <p className="text-sm text-white/40">Loading…</p>
      </main>
    )
  }

  return (
    <main className="min-h-dvh flex items-start sm:items-center justify-center px-5 py-10 sm:py-12" style={{ background: '#0A0A0B', paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-md space-y-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-semibold text-white">Almost there</h1>
          <p className="mt-2 text-sm text-white/60">
            Add your phone number so your rider can reach you and we can send order updates.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
          <label className="block text-sm text-white/70">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
              placeholder="Chibuike Nwosu"
              autoComplete="name"
              autoCapitalize="words"
            />
          </label>

          <label className="block text-sm text-white/70">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">WhatsApp number</span>
            <div className="flex gap-2">
              <input
                value={phone}
                onChange={(e) => onPhoneChange(e.target.value)}
                disabled={phoneVerified}
                className="w-full min-w-0 rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60 disabled:opacity-60"
                placeholder="+2348012345678"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoCorrect="off"
                spellCheck={false}
              />
              {verificationRequired && !phoneVerified && (
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={busy || !phoneOk}
                  className="shrink-0 rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                >
                  {codeSent ? 'Resend' : 'Send code'}
                </button>
              )}
            </div>
          </label>

          {verificationRequired && codeSent && !phoneVerified && (
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">6-digit code</span>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full min-w-0 rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60 tracking-[0.4em]"
                  placeholder="••••••"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={6}
                  aria-label="6-digit verification code"
                />
                <button
                  type="button"
                  onClick={verifyCode}
                  disabled={busy || code.length !== 6}
                  className="shrink-0 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
                >
                  Verify
                </button>
              </div>
            </label>
          )}

          {note && !error && <p className="text-sm text-emerald-400">{note}</p>}
          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

          {alreadyRegistered && (
            <a href="/auth" className="block text-center text-sm font-semibold" style={{ color: '#F5A623' }}>
              Log in with this number →
            </a>
          )}

          <button
            type="button"
            onClick={finish}
            disabled={busy || !canFinish}
            className="w-full rounded-2xl bg-amber-500 py-4 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy ? 'Please wait…' : 'Finish & continue'}
          </button>
        </div>
      </div>
    </main>
  )
}
