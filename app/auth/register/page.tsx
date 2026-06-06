'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import RecoveryCodeDisplay from '@/components/auth/RecoveryCodeDisplay'
import SecurityQuestionSelect from '@/components/auth/SecurityQuestionSelect'
import { SECURITY_QUESTIONS } from '@/lib/pin-auth'
import { BackButton } from '@/components/back-button'

const initialForm = {
  name: '',
  phone: '+234',
  pin: '',
  confirm_pin: '',
  question_1: '',
  answer_1: '',
  question_2: '',
  answer_2: '',
}

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [savedCode, setSavedCode] = useState(false)

  const question2Options = useMemo(
    () => SECURITY_QUESTIONS.filter((question) => question !== form.question_1),
    [form.question_1]
  )

  const handleChange = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
  }

  const handleRegister = async () => {
    setError('')
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
    setLoading(true)
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
              onClick={() => router.push('/')}
              className="rounded-2xl bg-amber-500 py-4 text-sm font-semibold text-black disabled:opacity-50"
            >
              Continue to homepage
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 py-12" style={{ background: '#0A0A0B' }}>
      <div className="w-full max-w-lg space-y-6">
        <BackButton fallback="/auth" />
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-semibold text-white">Create your account</h1>
          <p className="mt-2 text-sm text-white/60">
            Secure your account with a PIN, security questions and a recovery code.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
          <label className="block text-sm text-white/70">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Full name</span>
            <input
              value={form.name}
              onChange={(event) => handleChange('name', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none"
              placeholder="Chibuike Nwosu"
            />
          </label>

          <label className="block text-sm text-white/70">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Phone number</span>
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
              className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none"
              placeholder="+2348012345678"
              inputMode="tel"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Choose PIN</span>
              <input
                type="password"
                value={form.pin}
                onChange={(event) => handleChange('pin', event.target.value.replace(/[^0-9]/g, ''))}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
              />
            </label>
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Confirm PIN</span>
              <input
                type="password"
                value={form.confirm_pin}
                onChange={(event) => handleChange('confirm_pin', event.target.value.replace(/[^0-9]/g, ''))}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
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
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none"
                placeholder="Type your answer"
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
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none"
                placeholder="Type your answer"
              />
            </label>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={handleRegister}
            disabled={loading}
            className="w-full rounded-2xl bg-amber-500 py-4 text-sm font-semibold text-black disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create account'}
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
