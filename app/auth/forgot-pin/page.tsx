'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import RecoveryCodeDisplay from '@/components/auth/RecoveryCodeDisplay'
import { useFeatures } from '@/lib/use-features'
import { readJsonResponse } from '@/lib/http'

type Mode = 'phone' | 'choose' | 'questions' | 'recovery' | 'contact' | 'new-code' | 'otp'

export default function ForgotPinPage() {
  const router = useRouter()
  const features = useFeatures()
  // The OTP reset path rides the same super-admin `phone_verification` flag as
  // sign-up OTP — hidden when a super admin turns OTP delivery off.
  const otpEnabled = features.phone_verification !== false
  const [mode, setMode]           = useState<Mode>('phone')
  const [phone, setPhone]         = useState('+234')
  const [question1, setQuestion1] = useState('')
  const [question2, setQuestion2] = useState('')
  const [answer1, setAnswer1]     = useState('')
  const [answer2, setAnswer2]     = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPin, setNewPin]       = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [newCode, setNewCode]     = useState('')
  const [otpStep, setOtpStep]     = useState<'code' | 'pin'>('code')
  const [otpCode, setOtpCode]     = useState('')
  const [otpNote, setOtpNote]     = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  const normalizePhone = (value: string) => {
    const raw = value.replace(/\s/g, '')
    if (raw.startsWith('+234')) return raw
    if (raw.startsWith('234'))  return `+${raw}`
    if (raw.startsWith('0'))    return `+234${raw.slice(1)}`
    return raw
  }

  // Step 1 — collect phone, then show method choice
  const handlePhoneContinue = () => {
    if (phone.length < 13) {
      setError('Enter a valid phone number.')
      return
    }
    setError('')
    setMode('choose')
  }

  // Method A — fetch user's stored questions from API
  const handleGetQuestions = async () => {
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/forgot-pin/get-questions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone }),
      })
      const data = await res.json() as { questions?: string[]; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Unable to fetch security questions.')
        return
      }
      setQuestion1(data.questions?.[0] ?? '')
      setQuestion2(data.questions?.[1] ?? '')
      setMode('questions')
    } catch {
      setError('Unable to connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Method A — verify answers + set new PIN
  const handleQuestionsSubmit = async () => {
    if (newPin !== confirmPin) { setError('PIN confirmation does not match.'); return }
    if (!answer1.trim() || !answer2.trim()) { setError('Please answer both security questions.'); return }
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/forgot-pin/security-answers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, answer_1: answer1, answer_2: answer2, new_pin: newPin, confirm_pin: confirmPin }),
      })
      const data = await res.json() as { redirect_path?: string; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Invalid information. Please try again.')
        return
      }
      router.push(data.redirect_path ?? '/')
    } catch {
      setError('Unable to reset your PIN right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Method B — verify recovery code + set new PIN
  const handleRecoverySubmit = async () => {
    if (newPin !== confirmPin) { setError('PIN confirmation does not match.'); return }
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/forgot-pin/recovery-code', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, recovery_code: recoveryCode, new_pin: newPin, confirm_pin: confirmPin }),
      })
      const data = await res.json() as { recovery_code?: string; redirect_path?: string; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Invalid recovery code. Please try again.')
        return
      }
      setNewCode(data.recovery_code ?? '')
      setMode('new-code')
    } catch {
      setError('Unable to reset your PIN right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Method D — send a WhatsApp OTP scoped to "reset"
  const handleSendResetOtp = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/otp/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, purpose: 'reset' }),
      })
      const data = await readJsonResponse<{ error?: string }>(res) ?? {}
      if (!res.ok) {
        setError(data.error ?? 'Could not send the code.')
        // Surface OTP being off, but keep the user on the choose screen.
        if (mode !== 'otp') setMode('choose')
        return
      }
      setOtpCode('')
      setOtpStep('code')
      setOtpNote('We sent a 6-digit code to your WhatsApp.')
      setMode('otp')
    } catch {
      setError('Unable to connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Method D — confirm the code (sets the reset-scoped phone_verified cookie)
  const handleVerifyResetOtp = async () => {
    if (otpCode.length !== 6) { setError('Enter the 6-digit code.'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, code: otpCode }),
      })
      const data = await readJsonResponse<{ error?: string; verified?: boolean }>(res) ?? {}
      if (!res.ok) { setError(data.error ?? 'Incorrect or expired code.'); return }
      setOtpStep('pin')
      setOtpNote('Phone verified ✓ Set your new PIN.')
    } catch {
      setError('Unable to connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Method D — set the new PIN against the reset-scoped cookie
  const handleOtpPinReset = async () => {
    if (newPin !== confirmPin) { setError('PIN confirmation does not match.'); return }
    if (!/^\d{6}$/.test(newPin)) { setError('PIN must be exactly 6 digits.'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/pin/reset', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, new_pin: newPin }),
      })
      const data = await res.json().catch(() => ({})) as { redirect_path?: string; error?: string }
      if (!res.ok) { setError(data.error ?? 'Could not reset your PIN. Please try again.'); return }
      // Full navigation so the fresh session cookie is sent (see /auth login).
      window.location.assign(data.redirect_path ?? '/')
    } catch {
      setError('Unable to reset your PIN right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-dvh flex items-start sm:items-center justify-center px-5 py-10 sm:py-12"
      style={{ background: '#0A0A0B', paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="w-full max-w-xl space-y-6">
        {/* Header */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-semibold text-white">Forgot PIN</h1>
          <p className="mt-2 text-sm text-white/60">
            {mode === 'phone'     && 'Enter your phone number to continue.'}
            {mode === 'choose'    && 'Choose how you want to recover access to your account.'}
            {mode === 'questions' && 'Answer your two security questions to verify your identity.'}
            {mode === 'recovery'  && 'Enter your 12-character recovery code.'}
            {mode === 'otp'       && (otpStep === 'code' ? 'Enter the 6-digit code we sent to your WhatsApp.' : 'Choose your new 6-digit PIN.')}
            {mode === 'contact'   && 'Contact the platform admin for a manual PIN reset.'}
            {mode === 'new-code'  && 'Your PIN has been reset. Save your new recovery code now.'}
          </p>
        </div>

        {/* ── Step 1: Phone number ── */}
        {mode === 'phone' && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">
                WhatsApp number
              </span>
              <input
                value={phone}
                onChange={(e) => { setPhone(normalizePhone(e.target.value)); setError('') }}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder="+2348012345678"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </label>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={handlePhoneContinue}
              className="w-full rounded-2xl py-4 text-sm font-semibold text-black disabled:opacity-50"
              style={{ background: '#F5A623' }}
            >
              Continue
            </button>
            <button
              type="button"
              onClick={() => router.push('/auth')}
              className="w-full rounded-2xl border border-white/10 py-3 text-sm text-white/40"
            >
              Back to login
            </button>
          </div>
        )}

        {/* ── Step 2: Choose method ── */}
        {mode === 'choose' && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-3">
            <p className="text-xs text-white/40 mb-1">Account: {phone}</p>
            {otpEnabled && (
              <button
                type="button"
                onClick={handleSendResetOtp}
                disabled={loading}
                className="w-full rounded-2xl py-4 text-sm font-semibold text-black disabled:opacity-50"
                style={{ background: '#F5A623' }}
              >
                {loading ? 'Sending…' : 'Send code on WhatsApp'}
              </button>
            )}
            <button
              type="button"
              onClick={handleGetQuestions}
              disabled={loading}
              className={`w-full rounded-2xl py-4 text-sm disabled:opacity-50 ${otpEnabled ? 'border border-white/10 bg-[#111113] text-white' : 'font-semibold text-black'}`}
              style={otpEnabled ? undefined : { background: '#F5A623' }}
            >
              {loading ? 'Loading…' : 'I remember my security questions'}
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setMode('recovery') }}
              className="w-full rounded-2xl border border-white/10 bg-[#111113] py-4 text-sm text-white"
            >
              I have my recovery code
            </button>
            <button
              type="button"
              onClick={() => setMode('contact')}
              className="w-full rounded-2xl border border-white/10 bg-[#111113] py-4 text-sm text-white"
            >
              I have neither — contact support
            </button>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              onClick={() => { setError(''); setMode('phone') }}
              className="w-full rounded-2xl py-3 text-sm text-white/40"
            >
              ← Change number
            </button>
          </div>
        )}

        {/* ── Method A: Security questions ── */}
        {mode === 'questions' && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
            {/* Question 1 — read-only label */}
            <div>
              <p className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">Question 1</p>
              <p className="rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-sm text-white/80">
                {question1}
              </p>
            </div>
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Your answer</span>
              <input
                value={answer1}
                onChange={(e) => { setAnswer1(e.target.value); setError('') }}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder="Type your answer"
                autoComplete="off"
                autoCorrect="off"
              />
            </label>

            {/* Question 2 — read-only label */}
            <div>
              <p className="mb-1 text-xs uppercase tracking-[0.18em] text-white/40">Question 2</p>
              <p className="rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-sm text-white/80">
                {question2}
              </p>
            </div>
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Your answer</span>
              <input
                value={answer2}
                onChange={(e) => { setAnswer2(e.target.value); setError('') }}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder="Type your answer"
                autoComplete="off"
                autoCorrect="off"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-white/70">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">New PIN</span>
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => { setNewPin(e.target.value.replace(/[^0-9]/g, '')); setError('') }}
                  className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="new-password"
                  maxLength={6}
                  placeholder="••••••"
                />
              </label>
              <label className="block text-sm text-white/70">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Confirm PIN</span>
                <input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => { setConfirmPin(e.target.value.replace(/[^0-9]/g, '')); setError('') }}
                  className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="new-password"
                  maxLength={6}
                  placeholder="••••••"
                />
              </label>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="button"
              onClick={handleQuestionsSubmit}
              disabled={loading}
              className="w-full rounded-2xl py-4 text-sm font-semibold text-black disabled:opacity-50"
              style={{ background: '#F5A623' }}
            >
              {loading ? 'Resetting…' : 'Reset PIN'}
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setMode('choose') }}
              className="w-full rounded-2xl border border-white/10 py-3 text-sm text-white"
            >
              Back
            </button>
          </div>
        )}

        {/* ── Method B: Recovery code ── */}
        {mode === 'recovery' && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">
                Recovery code
              </span>
              <input
                value={recoveryCode}
                onChange={(e) => { setRecoveryCode(e.target.value); setError('') }}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 font-mono text-base text-white outline-none focus:border-amber-400/60"
                placeholder="LXMX-A7B9-K3MQ-P2RT"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-white/70">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">New PIN</span>
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => { setNewPin(e.target.value.replace(/[^0-9]/g, '')); setError('') }}
                  className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="new-password"
                  maxLength={6}
                  placeholder="••••••"
                />
              </label>
              <label className="block text-sm text-white/70">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Confirm PIN</span>
                <input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => { setConfirmPin(e.target.value.replace(/[^0-9]/g, '')); setError('') }}
                  className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="new-password"
                  maxLength={6}
                  placeholder="••••••"
                />
              </label>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="button"
              onClick={handleRecoverySubmit}
              disabled={loading}
              className="w-full rounded-2xl py-4 text-sm font-semibold text-black disabled:opacity-50"
              style={{ background: '#F5A623' }}
            >
              {loading ? 'Resetting…' : 'Reset PIN'}
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setMode('choose') }}
              className="w-full rounded-2xl border border-white/10 py-3 text-sm text-white"
            >
              Back
            </button>
          </div>
        )}

        {/* ── Method D: WhatsApp OTP ── */}
        {mode === 'otp' && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
            {otpNote && <p className="text-sm text-emerald-400/90">{otpNote}</p>}

            {otpStep === 'code' && (
              <>
                <label className="block text-sm text-white/70">
                  <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">
                    6-digit code
                  </span>
                  <input
                    value={otpCode}
                    onChange={(e) => { setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setError('') }}
                    className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-white outline-none focus:border-amber-400/60"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={6}
                    placeholder="••••••"
                    aria-label="6-digit code"
                    autoFocus
                  />
                </label>

                {error && <p className="text-sm text-red-400">{error}</p>}

                <button
                  type="button"
                  onClick={handleVerifyResetOtp}
                  disabled={loading || otpCode.length !== 6}
                  className="w-full rounded-2xl py-4 text-sm font-semibold text-black disabled:opacity-50"
                  style={{ background: '#F5A623' }}
                >
                  {loading ? 'Verifying…' : 'Verify code'}
                </button>
                <button
                  type="button"
                  onClick={handleSendResetOtp}
                  disabled={loading}
                  className="w-full rounded-2xl border border-white/10 py-3 text-sm text-white/70 disabled:opacity-50"
                >
                  Resend code
                </button>
              </>
            )}

            {otpStep === 'pin' && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm text-white/70">
                    <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">New PIN</span>
                    <input
                      type="password"
                      value={newPin}
                      onChange={(e) => { setNewPin(e.target.value.replace(/[^0-9]/g, '')); setError('') }}
                      className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="new-password"
                      maxLength={6}
                      placeholder="••••••"
                      autoFocus
                    />
                  </label>
                  <label className="block text-sm text-white/70">
                    <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Confirm PIN</span>
                    <input
                      type="password"
                      value={confirmPin}
                      onChange={(e) => { setConfirmPin(e.target.value.replace(/[^0-9]/g, '')); setError('') }}
                      className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="new-password"
                      maxLength={6}
                      placeholder="••••••"
                    />
                  </label>
                </div>

                {error && <p className="text-sm text-red-400">{error}</p>}

                <button
                  type="button"
                  onClick={handleOtpPinReset}
                  disabled={loading}
                  className="w-full rounded-2xl py-4 text-sm font-semibold text-black disabled:opacity-50"
                  style={{ background: '#F5A623' }}
                >
                  {loading ? 'Resetting…' : 'Reset PIN'}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => { setError(''); setOtpNote(''); setOtpCode(''); setMode('choose') }}
              className="w-full rounded-2xl border border-white/10 py-3 text-sm text-white"
            >
              Back
            </button>
          </div>
        )}

        {/* ── Method C: Contact admin ── */}
        {mode === 'contact' && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
            <p className="text-sm leading-relaxed text-white/70">
              Open WhatsApp and message the platform admin with:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-sm text-white/60 pl-1">
              <li>Your full name</li>
              <li>Your phone number ({phone})</li>
              <li>A photo of yourself holding your ID</li>
              <li>Why you need a PIN reset</li>
            </ol>
            <p className="text-xs text-white/40">
              We will respond within 2 hours during platform opening hours.
            </p>
            <button
              type="button"
              onClick={() => { setError(''); setMode('choose') }}
              className="w-full rounded-2xl border border-white/10 py-3 text-sm text-white"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => router.push('/auth')}
              className="w-full rounded-2xl py-3 text-sm text-white/40"
            >
              Back to login
            </button>
          </div>
        )}

        {/* ── New recovery code after Method B ── */}
        {mode === 'new-code' && (
          <div className="space-y-4">
            <RecoveryCodeDisplay code={newCode} />
            <p className="text-xs text-white/40 text-center">
              Your old recovery code no longer works. Save this one now.
            </p>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="w-full rounded-2xl py-4 text-sm font-semibold text-black"
              style={{ background: '#F5A623' }}
            >
              Continue to homepage
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
