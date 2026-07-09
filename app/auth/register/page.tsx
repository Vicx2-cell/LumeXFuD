'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import RecoveryCodeDisplay from '@/components/auth/RecoveryCodeDisplay'
import SecurityQuestionSelect from '@/components/auth/SecurityQuestionSelect'
import { SECURITY_QUESTIONS } from '@/lib/security-questions'
import { pinStrengthError } from '@/lib/pin-weak'
import { BackButton } from '@/components/back-button'
import { useFeatures } from '@/lib/use-features'
import GoogleButton from '@/components/auth/GoogleButton'
import { readJsonResponse } from '@/lib/http'

const initialForm = {
  name: '',
  phone: '+234',
  default_delivery_address: '',
  pin: '',
  confirm_pin: '',
  question_1: '',
  answer_1: '',
  question_2: '',
  answer_2: '',
}

export default function RegisterPage() {
  const router = useRouter()
  // When a super admin turns phone_verification OFF (e.g. OTP delivery down),
  // skip the verify step entirely. Defaults to required until flags load.
  const features = useFeatures()
  const verificationRequired = features.phone_verification !== false
  const googleEnabled = features.google_login === true
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [savedCode, setSavedCode] = useState(false)
  // Explicit acceptance of the Terms, Privacy and Refund policies (gates sign-up).
  const [agreed, setAgreed] = useState(false)
  // Optional separate call number. Default: same as the WhatsApp (account) number.
  const [callSame, setCallSame] = useState(true)
  const [callPhone, setCallPhone] = useState('+234')
  // Deep-link destination (e.g. a vendor's store link) — land here after signup.
  const [nextPath, setNextPath] = useState('/')
  // Referral code from a /auth/register?ref=CODE invite link. Sent with sign-up;
  // the server does all fraud validation and silently ignores a bad code.
  const [referralCode, setReferralCode] = useState('')

  // Phone-ownership verification (sign-up only).
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [vBusy, setVBusy] = useState(false)
  const [vError, setVError] = useState('')
  const [vNote, setVNote] = useState('')

  // Prefill the phone when arriving from the login screen's "not registered"
  // prompt (/auth/register?phone=+234...). Client-only — avoids needing a
  // useSearchParams Suspense boundary.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const p = q.get('phone')
    if (p && p.startsWith('+')) setForm((current) => ({ ...current, phone: p }))
    const n = q.get('next')
    if (n && n.startsWith('/') && !n.startsWith('//')) setNextPath(n)
    const ref = q.get('ref')
    if (ref) setReferralCode(ref.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12))
  }, [])

  const question2Options = useMemo(
    () => SECURITY_QUESTIONS.filter((question) => question !== form.question_1),
    [form.question_1]
  )

  const handleChange = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
    // Changing the number invalidates any prior verification (the cookie is
    // bound to a specific phone), so reset the verification UI.
    if (field === 'phone') {
      setCodeSent(false)
      setPhoneVerified(false)
      setCode('')
      setVError('')
      setVNote('')
    }
  }

  const sendCode = async () => {
    setVError('')
    setVNote('')
    if (form.phone.length < 13) { setVError('Enter your phone number first.'); return }
    setVBusy(true)
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, purpose: 'signup' }),
      })
      const data = await readJsonResponse<{ error?: string }>(res)
      if (!res.ok) { setVError(data?.error ?? 'Could not send the code.'); return }
      setCodeSent(true)
      setVNote('Code sent — check your WhatsApp.')
    } catch {
      setVError('Network error. Please try again.')
    } finally {
      setVBusy(false)
    }
  }

  const verifyCode = async () => {
    setVError('')
    setVNote('')
    if (code.length !== 6) { setVError('Enter the 6-digit code.'); return }
    setVBusy(true)
    try {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, code }),
      })
      const data = await readJsonResponse<{ error?: string }>(res)
      if (!res.ok) { setVError(data?.error ?? 'Verification failed.'); return }
      setPhoneVerified(true)
    } catch {
      setVError('Network error. Please try again.')
    } finally {
      setVBusy(false)
    }
  }

  const handleRegister = async () => {
    setError('')
    if (verificationRequired && !phoneVerified) {
      setError('Please verify your phone number first.')
      return
    }
    const pinErr = pinStrengthError(form.pin)
    if (pinErr) {
      setError(pinErr)
      return
    }
    if (form.pin !== form.confirm_pin) {
      setError('PIN confirmation does not match.')
      return
    }
    if (!form.question_1 || !form.question_2) {
      setError('Please choose two different security questions.')
      return
    }
    if (!form.answer_1.trim() || !form.answer_2.trim()) {
      setError('Please answer both security questions.')
      return
    }
    if (!callSame && callPhone.replace(/\D/g, '').length < 11) {
      setError('Enter a phone number for calls, or tick “Same as my WhatsApp number”.')
      return
    }
    if (form.default_delivery_address.trim().length < 5) {
      setError('Please enter your usual delivery location.')
      return
    }
    if (!agreed) {
      setError('Please accept the Terms, Privacy Policy and Refund Policy to continue.')
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, call_phone: callSame ? undefined : callPhone, referral_code: referralCode || undefined }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Registration failed. Please check your details.')
        return
      }
      setRecoveryCode(data.recovery_code)
    } catch {
      setError('Unable to register right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (recoveryCode) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-5 py-12" style={{ background: '#0A0A0B' }}>
        <div className="w-full max-w-lg space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h1 className="text-2xl font-semibold text-white">Account created</h1>
            <p className="mt-2 text-sm text-white/60">
              Save your recovery code now. It will only be shown once.
            </p>
          </div>

          <RecoveryCodeDisplay code={recoveryCode} onSaved={() => setSavedCode(true)} />

          <div className="flex flex-col gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={savedCode}
                onChange={(event) => setSavedCode(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950 text-amber-500"
              />
              I have saved my recovery code
            </label>
            <button
              type="button"
              disabled={!savedCode}
              onClick={() => {
                let dest = nextPath
                if (dest === '/') {
                  try { const v = sessionStorage.getItem('lx_return_vendor'); if (v && v.startsWith('/vendor/')) { sessionStorage.removeItem('lx_return_vendor'); dest = v } } catch { /* ignore */ }
                }
                router.push(dest)
              }}
              className="rounded-2xl bg-amber-500 py-4 text-sm font-semibold text-black disabled:opacity-50"
            >
              {nextPath === '/' ? 'Continue' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex items-start sm:items-center justify-center px-5 py-10 sm:py-12" style={{ background: '#0A0A0B', paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-lg space-y-6">
        <BackButton fallback="/auth" />
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-semibold text-white">Create your account</h1>
          <p className="mt-2 text-sm text-white/60">
            Secure your account with a PIN, security questions and a recovery code.
          </p>
        </div>

        {referralCode && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-3">
            <span className="text-xl" aria-hidden="true">🎉</span>
            <p className="text-sm text-amber-300/90">
              You were invited! Complete your first orders and you’ll both earn a reward.
            </p>
          </div>
        )}

        {googleEnabled && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
            <GoogleButton next={nextPath} label="Sign up with Google" />
            <p className="text-center text-xs text-white/40">
              Fastest way in — you’ll just add and verify your phone number after.
            </p>
            <div className="flex items-center gap-3 text-white/30 text-xs">
              <span className="h-px flex-1 bg-white/10" />
              or sign up with your phone
              <span className="h-px flex-1 bg-white/10" />
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
          <label className="block text-sm text-white/70">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Full name</span>
            <input
              value={form.name}
              onChange={(event) => handleChange('name', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
              placeholder="Chibuike Nwosu"
              autoComplete="name"
              autoCapitalize="words"
            />
          </label>

          <label className="block text-sm text-white/70">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">WhatsApp number — for messages</span>
            <span className="mb-2 block text-xs text-white/40">Required. We send your login code here, and vendors/riders message you on WhatsApp. Use a number with WhatsApp.</span>
            <input
              value={form.phone}
              onChange={(event) => {
                const raw = event.target.value.replace(/\s/g, '')
                let normalized = raw
                if (raw.startsWith('0')) {
                  normalized = '+234' + raw.slice(1)
                } else if (raw.startsWith('234') && !raw.startsWith('+')) {
                  normalized = '+' + raw
                } else if (!raw.startsWith('+')) {
                  normalized = '+234' + raw
                }
                handleChange('phone', normalized)
              }}
              className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
              placeholder="+2348012345678"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>

          {/* Phone ownership verification — hidden when a super admin disables
              the phone_verification flag (OTP delivery down). */}
          <label className="block text-sm text-white/70">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Usual delivery location</span>
            <span className="mb-2 block text-xs text-white/40">Required. Add the hostel, lodge, block and room you usually order to so riders can find you quickly later.</span>
            <textarea
              value={form.default_delivery_address}
              onChange={(event) => handleChange('default_delivery_address', event.target.value)}
              className="min-h-[96px] w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
              placeholder="Blessed Lodge, Block C, Room 12"
              autoComplete="street-address"
            />
          </label>

          {verificationRequired && (phoneVerified ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: '#34d399' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
              Phone number verified
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-[#0f0f11] p-4 space-y-3">
              {!codeSent ? (
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={vBusy || form.phone.length < 13}
                  className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 py-3 text-sm font-semibold text-amber-400 disabled:opacity-50"
                >
                  {vBusy ? 'Sending…' : 'Send verification code'}
                </button>
              ) : (
                <>
                  <p className="text-xs text-white/50">Enter the 6-digit code sent to {form.phone}.</p>
                  <div className="flex gap-2">
                    <input
                      value={code}
                      onChange={(event) => { setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setVError('') }}
                      className="flex-1 min-w-0 rounded-xl border border-white/10 bg-[#111113] px-4 py-3 text-center text-base text-white tracking-[0.4em] outline-none focus:border-amber-400/60"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={6}
                      placeholder="••••••"
                      aria-label="6-digit verification code"
                    />
                    <button
                      type="button"
                      onClick={verifyCode}
                      disabled={vBusy || code.length !== 6}
                      className="shrink-0 rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-black disabled:opacity-50"
                    >
                      {vBusy ? '…' : 'Verify'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={vBusy}
                    className="text-xs text-white/40 hover:text-white/70 transition-colors disabled:opacity-50"
                  >
                    Resend code
                  </button>
                </>
              )}
              {vNote && <p className="text-xs" style={{ color: '#34d399' }}>{vNote}</p>}
              {vError && <p className="text-xs text-red-400">{vError}</p>}
            </div>
          ))}

          {/* Phone number — for calls. Required: a separate number, or "same". */}
          <div className="space-y-2">
            <span className="block text-xs uppercase tracking-[0.18em] text-white/40">Phone number — for calls</span>
            <span className="block text-xs text-white/40">Required. The number vendors/riders will call you on. Can be the same as your WhatsApp number.</span>
            <label className="flex items-center gap-2.5 cursor-pointer text-sm text-white/70">
              <input
                type="checkbox"
                checked={callSame}
                onChange={(event) => setCallSame(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-950 accent-amber-500"
              />
              Same as my WhatsApp number
            </label>
            {!callSame && (
              <input
                value={callPhone}
                onChange={(event) => {
                  const raw = event.target.value.replace(/\s/g, '')
                  let normalized = raw
                  if (raw.startsWith('0')) normalized = '+234' + raw.slice(1)
                  else if (raw.startsWith('234') && !raw.startsWith('+')) normalized = '+' + raw
                  else if (!raw.startsWith('+')) normalized = '+234' + raw
                  setCallPhone(normalized)
                }}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder="+2348012345678"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoCorrect="off"
                spellCheck={false}
              />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Choose PIN</span>
              <input
                type="password"
                value={form.pin}
                onChange={(event) => handleChange('pin', event.target.value.replace(/[^0-9]/g, ''))}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="new-password"
                maxLength={6}
                placeholder="123456"
                aria-label="Choose a 6-digit PIN"
              />
            </label>
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Confirm PIN</span>
              <input
                type="password"
                value={form.confirm_pin}
                onChange={(event) => handleChange('confirm_pin', event.target.value.replace(/[^0-9]/g, ''))}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="new-password"
                maxLength={6}
                placeholder="123456"
                aria-label="Confirm your 6-digit PIN"
              />
            </label>
          </div>

          <div className="grid gap-4">
            <SecurityQuestionSelect
              label="Security question 1"
              value={form.question_1}
              options={[...SECURITY_QUESTIONS]}
              onChange={(value) => handleChange('question_1', value)}
            />
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Answer</span>
              <input
                value={form.answer_1}
                onChange={(event) => handleChange('answer_1', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder="Type your answer"
                autoComplete="off"
                autoCorrect="off"
              />
            </label>
            <SecurityQuestionSelect
              label="Security question 2"
              value={form.question_2}
              options={question2Options}
              onChange={(value) => handleChange('question_2', value)}
            />
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Answer</span>
              <input
                value={form.answer_2}
                onChange={(event) => handleChange('answer_2', event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-base text-white outline-none focus:border-amber-400/60"
                placeholder="Type your answer"
                autoComplete="off"
                autoCorrect="off"
              />
            </label>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => { setAgreed(event.target.checked); if (event.target.checked) setError('') }}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-slate-950 accent-amber-500"
            />
            <span className="text-xs leading-relaxed text-white/60">
              I agree to LumeX Fud’s{' '}
              <a href="/terms" target="_blank" className="text-[#F5A623]">Terms</a>,{' '}
              <a href="/privacy" target="_blank" className="text-[#F5A623]">Privacy Policy</a>{' '}and{' '}
              <a href="/refunds" target="_blank" className="text-[#F5A623]">Refund &amp; Cancellation Policy</a>.
            </span>
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={handleRegister}
            disabled={loading || !agreed || (verificationRequired && !phoneVerified)}
            className="w-full rounded-2xl bg-amber-500 py-4 text-sm font-semibold text-black disabled:opacity-50"
          >
            {loading ? 'Creating account…' : (verificationRequired && !phoneVerified) ? 'Verify your phone to continue' : 'Create account'}
          </button>

          <p className="text-center text-sm text-white/40">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => router.push('/auth')}
              className="font-medium"
              style={{ color: '#F5A623' }}
            >
              Login →
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
