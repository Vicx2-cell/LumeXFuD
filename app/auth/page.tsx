'use client'

import { useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PinInput from '@/components/auth/PinInput'

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
  const nextPath = params.get('next') ?? '/'

  const [phone,   setPhone]   = useState('+234')
  const [pin,     setPin]     = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [step,    setStep]    = useState<'phone' | 'pin'>('phone')

  const submitLogin = useCallback(async (pinValue: string) => {
    if (pinValue.length !== 6) return
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, pin: pinValue }),
      })
      const data = await res.json() as {
        error?: string
        role?: string
        redirect_path?: string
        pin_reset_pending?: boolean
      }
      if (!res.ok) {
        setPin('')
        setError(data.error ?? 'Invalid phone or PIN')
        return
      }
      if (data.pin_reset_pending) {
        router.push('/auth/setup')
        return
      }
      router.push(data.redirect_path ?? nextPath)
    } catch {
      setPin('')
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [phone, nextPath, router])

  function handlePhoneContinue() {
    if (phone.length < 13) return
    setPin('')
    setError('')
    setStep('pin')
  }

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 py-12"
      style={{ background: '#0A0A0B' }}
    >
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <span
            className="inline-block px-4 py-1.5 rounded-lg font-bold text-sm"
            style={{ background: '#F5A623', color: '#000' }}
          >
            LumeX Fud
          </span>
          <h1 className="text-2xl font-bold mt-4 tracking-tight">Campus life, simplified.</h1>
          <p className="text-sm text-white/40 mt-1">
            {step === 'phone' ? 'Sign in with your phone number and PIN' : 'Enter your 6-digit PIN'}
          </p>
        </div>

        {/* ── Phone step ── */}
        {step === 'phone' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-2">
                Phone number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  let val = e.target.value
                  if (!val.startsWith('+234')) val = '+234' + val.replace(/^\+?234?/, '')
                  setPhone(val)
                }}
                placeholder="+2348012345678"
                className="w-full rounded-xl px-4 py-3.5 text-base outline-none"
                style={{
                  background: '#111113',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                }}
                autoComplete="tel"
                inputMode="tel"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              onClick={handlePhoneContinue}
              disabled={phone.length < 13}
              className="w-full rounded-xl py-4 font-semibold text-base transition-opacity disabled:opacity-50"
              style={{ background: '#F5A623', color: '#000', minHeight: 56 }}
            >
              Login
            </button>

            <button
              onClick={() => router.push('/auth/forgot-pin')}
              className="w-full py-2.5 text-sm text-center"
              style={{ color: '#F5A623' }}
            >
              Forgot PIN?
            </button>

            <p className="text-center text-sm text-white/40 pt-1">
              New here?{' '}
              <button
                onClick={() => router.push('/auth/register')}
                className="font-medium"
                style={{ color: '#F5A623' }}
              >
                Create account →
              </button>
            </p>
          </div>
        )}

        {/* ── PIN step ── */}
        {step === 'pin' && (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-white/50">{phone}</p>
            </div>

            <PinInput
              value={pin}
              onChange={(v) => { setPin(v); setError('') }}
              onComplete={submitLogin}
              error={error}
              disabled={loading}
              label="Enter your PIN"
            />

            {loading && (
              <p className="text-center text-sm text-white/40">Verifying…</p>
            )}

            <div className="space-y-2 pt-1">
              <button
                onClick={() => router.push('/auth/forgot-pin')}
                className="w-full py-2.5 text-sm text-center"
                style={{ color: '#F5A623' }}
              >
                Forgot PIN?
              </button>
              <button
                onClick={() => { setPin(''); setError(''); setStep('phone') }}
                className="w-full py-2 text-sm text-white/30 text-center"
              >
                ← Change number
              </button>
            </div>

            <p className="text-center text-sm text-white/40">
              New here?{' '}
              <button
                onClick={() => router.push('/auth/register')}
                className="font-medium"
                style={{ color: '#F5A623' }}
              >
                Create account →
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
