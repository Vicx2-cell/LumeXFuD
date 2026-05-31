'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import RecoveryCodeDisplay from '@/components/auth/RecoveryCodeDisplay'
import SecurityQuestionSelect from '@/components/auth/SecurityQuestionSelect'
import { SECURITY_QUESTIONS } from '@/lib/pin-auth'

const initialForm = {
  pin: '',
  confirm_pin: '',
  question_1: '',
  answer_1: '',
  question_2: '',
  answer_2: '',
}

export default function SetupPage() {
  const router = useRouter()
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [redirectPath, setRedirectPath] = useState('/')
  const [saved, setSaved] = useState(false)

  const question2Options = useMemo(
    () => SECURITY_QUESTIONS.filter((question) => question !== form.question_1),
    [form.question_1]
  )

  const handleChange = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
  }

  const handleSubmit = async () => {
    if (form.pin !== form.confirm_pin) {
      setError('PIN confirmation does not match.')
      return
    }
    if (!form.question_1 || !form.question_2 || form.question_1 === form.question_2) {
      setError('Choose two different security questions.')
      return
    }
    if (!form.answer_1.trim() || !form.answer_2.trim()) {
      setError('Please answer both security questions.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Unable to complete setup.')
        return
      }
      setRecoveryCode(data.recovery_code)
      setRedirectPath(data.redirect_path ?? '/')
    } catch {
      setError('Unable to complete setup at the moment.')
    } finally {
      setLoading(false)
    }
  }

  if (recoveryCode) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-5 py-12" style={{ background: '#0A0A0B' }}>
        <div className="w-full max-w-lg space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h1 className="text-2xl font-semibold text-white">Setup complete</h1>
            <p className="mt-2 text-sm text-white/60">Your account is ready. Save your new recovery code and continue.</p>
          </div>
          <RecoveryCodeDisplay code={recoveryCode} onSaved={() => setSaved(true)} />
          <button
            type="button"
            disabled={!saved}
            onClick={() => router.push(redirectPath)}
            className="w-full rounded-2xl bg-amber-500 py-4 text-sm font-semibold text-black disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 py-12" style={{ background: '#0A0A0B' }}>
      <div className="w-full max-w-lg space-y-6">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-semibold text-white">Set your permanent PIN</h1>
          <p className="mt-2 text-sm text-white/60">Complete account setup before accessing your dashboard.</p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-white/70">
              <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Choose PIN</span>
              <input
                type="password"
                value={form.pin}
                onChange={(event) => handleChange('pin', event.target.value.replace(/[^0-9]/g, ''))}
                className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none"
                inputMode="numeric"
                maxLength={4}
                placeholder="1234"
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
                maxLength={4}
                placeholder="1234"
              />
            </label>
          </div>

          <SecurityQuestionSelect
            label="Security question 1"
            value={form.question_1}
            options={[...SECURITY_QUESTIONS]}
            onChange={(value) => handleChange('question_1', value)}
          />
          <label className="block text-sm text-white/70">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Answer 1</span>
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
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Answer 2</span>
            <input
              value={form.answer_2}
              onChange={(event) => handleChange('answer_2', event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none"
              placeholder="Type your answer"
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            className="w-full rounded-2xl bg-amber-500 py-4 text-sm font-semibold text-black disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save and continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
