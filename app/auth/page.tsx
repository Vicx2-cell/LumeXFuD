'use client'

import { useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { startAuthentication } from '@simplewebauthn/browser'
import PinInput from '@/components/auth/PinInput'
import GoogleButton from '@/components/auth/GoogleButton'
import { BrandLogo } from '@/components/brand-logo'
import { useFeatures } from '@/lib/use-features'

// Friendly text for the ?error= slugs the Google flow can redirect back with.
const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_state: 'Google sign-in could not be verified. Please try again.',
  google_failed: "Couldn't sign in with Google. Please try again.",
  google_unverified_email: 'Your Google email is not verified. Use a verified Google account or sign up with your phone.',
  google_disabled: 'Google sign-in is currently turned off.',
  google_unavailable: 'Google sign-in is not available right now.',
  account_suspended: 'Your account has been suspended. Contact support.',
  signups_closed: 'New sign-ups are currently closed.',
}

export default function AuthPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router   = useRouter()
  const params   = useSearchParams()
  const rawNext  = params.get('next')
  const nextPath = rawNext ?? '/'
  // Only treat in-app paths as a deep-link destination (avoid open-redirects).
  const hasNext  = !!rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')

  const features = useFeatures()
  const googleEnabled = features.google_login === true
  // The Google flow redirects back here with ?error=<slug> on failure.
  const googleError = GOOGLE_ERRORS[params.get('error') ?? ''] ?? ''

  // Fallback: a vendor page (visited logged-out via a share link) stashes itself
  // here, so we return there after auth even when no ?next= was carried through.
  function popReturnVendor(): string | null {
    try { const v = sessionStorage.getItem('lx_return_vendor'); if (v) { sessionStorage.removeItem('lx_return_vendor'); if (v.startsWith('/vendor/')) return v } } catch { /* ignore */ }
    return null
  }

  const [phone,   setPhone]   = useState('+234')
  const [pin,     setPin]     = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [step,    setStep]    = useState<'phone' | 'pin' | 'mfa'>('phone')
  const [notRegistered, setNotRegistered] = useState(false)
  const [mfaError, setMfaError] = useState('')
  const [mfaBusy,  setMfaBusy]  = useState(false)

  const goRegister = useCallback(() => {
    const q = new URLSearchParams({ phone })
    if (hasNext) q.set('next', nextPath)
    router.push(`/auth/register?${q.toString()}`)
  }, [phone, router, hasNext, nextPath])

  const runWebAuthn = useCallback(async () => {
    setMfaBusy(true)
    setMfaError('')
    try {
      const optRes = await fetch('/api/auth/webauthn/login-options', { method: 'POST' })
      const options = await optRes.json()
      if (!optRes.ok) {
        setMfaError(options.error ?? 'Could not start Face ID')
        return
      }
      const assertion = await startAuthentication({ optionsJSON: options })
      const verRes = await fetch('/api/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      })
      const data = await verRes.json() as { error?: string; redirect_path?: string }
      if (!verRes.ok) {
        setMfaError(data.error ?? 'Face ID failed. Try again.')
        return
      }
      setSuccess(true)
      // Full navigation (see submitLogin) so the fresh session cookie is sent
      // and we bypass any cached pre-login redirect. Use the server's
      // role-correct redirect_path (or a returning vendor share-link), never a
      // raw `next`, so a privileged role is never dropped on /home.
      setTimeout(() => window.location.assign(popReturnVendor() ?? data.redirect_path ?? '/'), 650)
    } catch (e) {
      const name = (e as { name?: string })?.name
      setMfaError(name === 'NotAllowedError'
        ? 'Face ID was cancelled or timed out.'
        : 'Face ID is not available on this device.')
    } finally {
      setMfaBusy(false)
    }
  }, [])

  const submitLogin = useCallback(async (pinValue: string) => {
    if (pinValue.length !== 6) return
    setError('')
    setNotRegistered(false)
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, pin: pinValue, next: hasNext ? nextPath : undefined }),
      })
      // Parse defensively: a non-JSON response (e.g. an HTML error/redirect page)
      // must surface as a real error, not throw into the "Connection error" catch.
      const data = await res.json().catch(() => ({})) as {
        error?: string
        role?: string
        redirect_path?: string
        pin_reset_pending?: boolean
        webauthn_required?: boolean
        unregistered?: boolean
      }
      if (!res.ok) {
        setPin('')
        setError(data.error ?? 'Invalid phone or PIN')
        setNotRegistered(Boolean(data.unregistered))
        return
      }
      // PIN ok but this account has Face ID enrolled → step up to the second
      // factor before any session is issued.
      if (data.webauthn_required) {
        setStep('mfa')
        void runWebAuthn()
        return
      }
      // Success: play the unlock burst, then navigate. Use a FULL navigation
      // (not router.push): a soft client nav can replay Next's cached
      // pre-login "/orders → /auth" redirect and race the just-set session
      // cookie on iOS Safari, bouncing the user back to login. A full document
      // load always sends the fresh cookie and skips the router cache.
      setSuccess(true)
      setTimeout(() => {
        // Trust the server's role-validated redirect_path (it already folds in a
        // safe `next`). A returning vendor share-link still wins. We never use a
        // raw `next` here — that's how a privileged role got dropped on /home.
        const dest = data.pin_reset_pending ? '/auth/setup' : (popReturnVendor() ?? data.redirect_path ?? '/')
        window.location.assign(dest)
      }, 650)
    } catch {
      setPin('')
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [phone, nextPath, hasNext, runWebAuthn])

  function handlePhoneContinue() {
    if (phone.length < 13) return
    setPin('')
    setError('')
    setNotRegistered(false)
    setStep('pin')
  }

  return (
    <main className="lx-page flex flex-col items-center justify-center px-5 py-12 overflow-hidden">
      <div className="lx-orb lx-orb--amber" aria-hidden="true" />
      <div className="lx-orb lx-orb--indigo" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-sm lx-enter">
        {/* Logo + heading */}
        <div className="text-center mb-8">
          <div className="flex flex-col items-center gap-2.5">
            <BrandLogo size={68} rounded={20} priority className="lx-pop" style={{ boxShadow: '0 10px 40px rgba(245,166,35,0.45)' }} />
            <span className="font-bold text-sm tracking-tight text-white/90">
              LumeX <span style={{ color: '#F5A623' }}>Fud</span>
            </span>
          </div>
          <h1 className="text-[28px] leading-tight font-bold mt-5 tracking-tight">
            Campus life, simplified.
          </h1>
          <p className="text-sm text-white/45 mt-2">
            {step === 'phone' ? 'Sign in with your phone number and PIN' : 'Enter your 6-digit PIN to unlock'}
          </p>
        </div>

        {/* Glass card */}
        <div className="glass p-6">
          {/* ── Phone step ── */}
          {step === 'phone' && (
            <div className="space-y-5">
              {googleError && (
                <p className="text-red-400 text-sm text-center" role="alert">{googleError}</p>
              )}

              {googleEnabled && (
                <>
                  <GoogleButton next={hasNext ? nextPath : undefined} />
                  <div className="flex items-center gap-3 text-white/30 text-xs">
                    <span className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.12)' }} />
                    or
                    <span className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.12)' }} />
                  </div>
                </>
              )}

              <div>
                <label htmlFor="lx-phone" className="block text-xs font-medium text-white/60 mb-2">
                  Phone number
                </label>
                <input
                  id="lx-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    let val = e.target.value
                    if (!val.startsWith('+234')) val = '+234' + val.replace(/^\+?234?/, '')
                    setPhone(val)
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePhoneContinue() }}
                  placeholder="+2348012345678"
                  className="w-full rounded-xl px-4 py-3.5 text-base outline-none transition-colors focus:border-amber-400"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#fff',
                  }}
                  autoComplete="tel"
                  inputMode="tel"
                />
              </div>

              {error && <p className="text-red-400 text-sm" role="alert">{error}</p>}

              <button
                onClick={handlePhoneContinue}
                disabled={phone.length < 13}
                className="lx-btn-amber w-full py-4 text-base"
                style={{ minHeight: 56 }}
                aria-label="Continue to PIN entry"
              >
                Continue
              </button>

              <button
                onClick={() => router.push('/auth/forgot-pin')}
                className="w-full py-2 text-sm text-center hover:opacity-80 transition-opacity"
                style={{ color: '#F5A623' }}
              >
                Forgot PIN?
              </button>
            </div>
          )}

          {/* ── PIN step ── */}
          {step === 'pin' && (
            <div className="space-y-6">
              <p className="text-center text-sm text-white/50 tabular-nums">{phone}</p>

              <PinInput
                value={pin}
                onChange={(v) => { setPin(v); setError(''); setNotRegistered(false) }}
                onComplete={submitLogin}
                error={error}
                success={success}
                disabled={loading || success}
                label="Enter your PIN"
              />

              {loading && !success && (
                <p className="text-center text-sm text-white/40">Verifying…</p>
              )}

              {notRegistered && !success && (
                <div
                  className="rounded-xl p-4 text-center space-y-3"
                  style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.2)' }}
                >
                  <p className="text-sm text-white/70">
                    No account is registered with <span className="tabular-nums text-white/90">{phone}</span>.
                  </p>
                  <button onClick={goRegister} className="lx-btn-amber w-full py-3.5">
                    Create an account →
                  </button>
                </div>
              )}

              <div className="space-y-1 pt-1">
                <button
                  onClick={() => router.push('/auth/forgot-pin')}
                  className="w-full py-2 text-sm text-center hover:opacity-80 transition-opacity"
                  style={{ color: '#F5A623' }}
                  disabled={success}
                >
                  Forgot PIN?
                </button>
                <button
                  onClick={() => { setPin(''); setError(''); setNotRegistered(false); setStep('phone') }}
                  className="w-full py-2 text-sm text-white/35 text-center hover:text-white/60 transition-colors"
                  disabled={success}
                >
                  ← Change number
                </button>
              </div>
            </div>
          )}

          {/* ── Face ID / Touch ID step (second factor) ── */}
          {step === 'mfa' && (
            <div className="space-y-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <div
                  className={`relative flex items-center justify-center w-20 h-20 rounded-3xl ${mfaBusy ? 'animate-pulse' : ''}`}
                  style={{ background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.3)', boxShadow: success ? '0 0 30px rgba(52,211,153,0.5)' : '0 0 30px rgba(245,166,35,0.25)' }}
                >
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={success ? '#34d399' : '#F5A623'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M4 16v2a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M16 20h2a2 2 0 0 0 2-2v-2"/>
                    <path d="M9 9h.01"/><path d="M15 9h.01"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold">{success ? 'Verified ✓' : "Confirm it's you"}</p>
                  <p className="text-sm text-white/45 mt-1">
                    {success ? 'Signing you in…' : 'Use Face ID or Touch ID to finish signing in.'}
                  </p>
                </div>
              </div>

              {mfaError && <p className="text-red-400 text-sm" role="alert">{mfaError}</p>}

              {!success && (
                <button
                  onClick={() => void runWebAuthn()}
                  disabled={mfaBusy}
                  className="lx-btn-amber w-full py-3.5"
                >
                  {mfaBusy ? 'Waiting for Face ID…' : 'Try Face ID again'}
                </button>
              )}

              <button
                onClick={() => { setPin(''); setError(''); setMfaError(''); setStep('phone') }}
                className="w-full py-2 text-sm text-white/35 text-center hover:text-white/60 transition-colors"
                disabled={success}
              >
                ← Start over
              </button>
            </div>
          )}
        </div>

        {/* New-account link sits below the card on both steps */}
        <p className="text-center text-sm text-white/45 pt-5">
          New here?{' '}
          <button
            onClick={() => router.push(hasNext ? `/auth/register?next=${encodeURIComponent(nextPath)}` : '/auth/register')}
            className="font-semibold hover:opacity-80 transition-opacity"
            style={{ color: '#F5A623' }}
          >
            Create account →
          </button>
        </p>
      </div>
    </main>
  )
}
