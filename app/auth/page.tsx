'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  )
}

function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = searchParams.get('next') ?? '/'

  const [step, setStep] = useState<'phone' | 'otp' | 'name'>('phone')
  const [phone, setPhone] = useState('+234')
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [name, setName] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const otpRefs = useRef<Array<HTMLInputElement | null>>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (countdown > 0) {
      timerRef.current = setInterval(() => setCountdown((c) => c - 1), 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [countdown])

  async function sendOtp() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Failed to send OTP')
        return
      }
      setStep('otp')
      setCountdown(45)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function verifyOtp() {
    const otp = otpDigits.join('')
    if (otp.length !== 6) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      })
      const data = await res.json() as { error?: string; role?: string; redirect_path?: string }
      if (!res.ok) {
        setError(data.error ?? 'Invalid OTP')
        setOtpDigits(['', '', '', '', '', ''])
        otpRefs.current[0]?.focus()
        return
      }
      if (data.role === 'customer') {
        setStep('name')
      } else {
        router.push(data.redirect_path ?? nextPath)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function saveName() {
    if (name.trim()) {
      try {
        await fetch('/api/auth/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        })
      } catch {
        // non-critical
      }
    }
    router.push(nextPath)
  }

  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otpDigits]
    next[index] = digit
    setOtpDigits(next)
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
    if (next.every((d) => d) && next.join('').length === 6) {
      setOtpDigits(next)
      setTimeout(verifyOtp, 100)
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 py-12" style={{ background: '#0A0A0B' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <span className="inline-block px-4 py-1.5 rounded-lg font-bold text-sm" style={{ background: '#F5A623', color: '#000' }}>
            LumeX Fud
          </span>
          <h1 className="text-2xl font-bold mt-4 tracking-tight">Campus life, simplified.</h1>
          <p className="text-sm text-white/40 mt-1">Sign in or create your account</p>
        </div>

        {step === 'phone' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-2">Your phone number</label>
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
                style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                autoComplete="tel"
                inputMode="tel"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              onClick={sendOtp}
              disabled={loading || phone.length < 13}
              className="w-full rounded-xl py-4 font-semibold text-base transition-opacity disabled:opacity-50"
              style={{ background: '#F5A623', color: '#000', minHeight: 56 }}
            >
              {loading ? 'Sending…' : 'Send OTP'}
            </button>

            <button
              onClick={() => router.push(nextPath)}
              className="w-full py-3 text-sm text-white/40 text-center"
            >
              Continue as Guest
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-white/60">Code sent to</p>
              <p className="font-medium mt-1">{phone}</p>
            </div>

            <div className="flex gap-3 justify-center">
              {otpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  className="w-12 h-14 text-center text-xl font-bold rounded-xl outline-none"
                  style={{
                    background: '#111113',
                    border: `1px solid ${digit ? '#F5A623' : 'rgba(255,255,255,0.1)'}`,
                    color: '#fff',
                  }}
                  autoFocus={i === 0}
                />
              ))}
            </div>

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}

            <button
              onClick={verifyOtp}
              disabled={loading || otpDigits.join('').length !== 6}
              className="w-full rounded-xl py-4 font-semibold text-base transition-opacity disabled:opacity-50"
              style={{ background: '#F5A623', color: '#000', minHeight: 56 }}
            >
              {loading ? 'Verifying…' : 'Verify OTP'}
            </button>

            <div className="text-center">
              {countdown > 0 ? (
                <p className="text-sm text-white/40">Resend in {countdown}s</p>
              ) : (
                <button onClick={sendOtp} disabled={loading} className="text-sm text-[#F5A623]">
                  Resend OTP
                </button>
              )}
            </div>

            <button onClick={() => setStep('phone')} className="w-full py-2 text-sm text-white/40 text-center">
              ← Change number
            </button>
          </div>
        )}

        {step === 'name' && (
          <div className="space-y-5">
            <div className="text-center">
              <p className="text-xl font-bold">Welcome!</p>
              <p className="text-sm text-white/50 mt-1">What should we call you?</p>
            </div>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your first name"
              className="w-full rounded-xl px-4 py-3.5 text-base outline-none"
              style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
              autoFocus
            />

            <button
              onClick={saveName}
              className="w-full rounded-xl py-4 font-semibold text-base"
              style={{ background: '#F5A623', color: '#000', minHeight: 56 }}
            >
              {name.trim() ? 'Get started' : 'Skip'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
