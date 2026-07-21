'use client'

import { useState } from 'react'
import { readJsonResponse } from '@/lib/http'
import type { EmailVerifyPurpose } from '@/lib/email-verify'

export default function EmailVerifyInline({ email, purpose, verified, onVerified }: { email: string; purpose: EmailVerifyPurpose; verified: boolean; onVerified: () => void }) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function requestCode() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/auth/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, purpose }) })
      const data = await readJsonResponse<{ error?: string }>(response)
      if (!response.ok) return setMessage(data?.error ?? 'Could not send the code.')
      setSent(true); setMessage('Code sent. Check your inbox and spam folder.')
    } catch { setMessage('Network error. Please try again.') } finally { setBusy(false) }
  }

  async function verify() {
    setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/auth/email/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, purpose }) })
      const data = await readJsonResponse<{ error?: string }>(response)
      if (!response.ok) return setMessage(data?.error ?? 'Verification failed.')
      onVerified(); setMessage('Email verified.')
    } catch { setMessage('Network error. Please try again.') } finally { setBusy(false) }
  }

  if (verified) return <p className="text-sm font-medium text-emerald-400">Email verified</p>
  return <div className="space-y-3">
    {sent && <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit email code" className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60" />}
    <button type="button" disabled={busy || email.trim().length < 5 || (sent && code.length !== 6)} onClick={sent ? verify : requestCode} className="rounded-2xl border border-amber-400/35 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-300 disabled:opacity-50">
      {busy ? 'Please wait...' : sent ? 'Verify email code' : 'Send email verification code'}
    </button>
    {message && <p className="text-xs text-white/60">{message}</p>}
  </div>
}
