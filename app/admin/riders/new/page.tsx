'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFeatures } from '@/lib/use-features'
import PhoneVerifyInline from '@/components/auth/PhoneVerifyInline'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

interface SuccessData {
  temp_pin: string
  full_name: string
  phone: string
  whatsapp_message: string
}

export default function NewRiderPage() {
  const router = useRouter()
  // OTP gate mirrors customer sign-up; a super admin can disable it (phone_verification)
  // while OTP delivery is down. Defaults to required until flags load.
  const features = useFeatures()
  const verificationRequired = features.phone_verification !== false
  const [form, setForm] = useState({ full_name: '', phone: '+234', call_phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<SuccessData | null>(null)
  const [copied, setCopied] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setError('')
    // The verified cookie is bound to a specific number — changing it invalidates it.
    if (k === 'phone') setPhoneVerified(false)
  }

  const handleSubmit = async () => {
    if (!form.full_name.trim() || form.phone.length < 13) {
      setError('Please fill in all required fields.')
      return
    }
    if (verificationRequired && !phoneVerified) {
      setError('Verify the rider’s phone number first.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/admin/riders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create rider.')
        return
      }
      setSuccess(data)
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const copyMessage = () => {
    if (!success) return
    navigator.clipboard.writeText(success.whatsapp_message).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const openWhatsApp = () => {
    if (!success) return
    const phone = success.phone.replace(/^\+/, '')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(success.whatsapp_message)}`, '_blank')
  }

  if (success) {
    return (
      <div className="lx-page lx-console flex items-start justify-center px-5 py-12 overflow-hidden">
        <GlassSheen />
        <div className="relative z-10 w-full max-w-md space-y-4">
          <div className="rounded-3xl border border-green-500/30 bg-green-500/10 p-6">
            <p className="text-lg font-semibold text-white">Rider record created</p>
            <div className="mt-3 space-y-1 text-sm text-white/60">
              <p>Name: <span className="text-white">{success.full_name}</span></p>
              <p>Phone: <span className="text-white">{success.phone}</span></p>
            </div>
            <p className="mt-3 text-sm text-white/60">
              This account is pending review and will not receive orders until approval is complete.
            </p>
            <div className="mt-4">
              <p className="lx-mono mb-1">Temporary PIN</p>
              <p className="text-4xl font-bold tracking-[0.3em] text-amber-400 lx-nums">{success.temp_pin}</p>
            </div>
          </div>

          <div className="lx-surface rounded-3xl p-5 space-y-3">
            <p className="lx-mono">Send this WhatsApp message to them</p>
            <p className="lx-surface rounded-xl p-3 text-sm text-white/80 whitespace-pre-wrap">
              {success.whatsapp_message}
            </p>
            <div className="flex gap-3">
              <button
                onClick={copyMessage}
                className="flex-1 rounded-xl py-3 text-sm font-semibold transition-colors"
                style={{ background: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)', color: copied ? '#4ade80' : '#fff' }}
              >
                {copied ? 'Copied!' : 'Copy Message'}
              </button>
              <button
                onClick={openWhatsApp}
                className="flex-1 rounded-xl py-3 text-sm font-semibold"
                style={{ background: '#25D366', color: '#fff' }}
              >
                Open WhatsApp
              </button>
            </div>
          </div>

          <button
            onClick={() => router.push('/admin')}
            className="w-full rounded-2xl py-4 text-sm font-semibold text-white/60 border border-white/10"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="lx-page lx-console px-5 py-10 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-md">
        <PageHeader
          title="Add Rider"
          subtitle="A temporary PIN will be generated and the rider will stay pending until approval."
          badge="Admin"
        />

        <div className="lx-surface space-y-4 rounded-3xl p-6">
          <label className="block">
            <span className="lx-mono mb-2 block">Full name</span>
            <input
              value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              placeholder="Emeka Eze"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="lx-mono mb-2 block">WhatsApp number (+234) — for messages &amp; login</span>
            <input
              value={form.phone}
              onChange={(e) => {
                let v = e.target.value
                if (!v.startsWith('+234')) v = '+234' + v.replace(/^\+?234?/, '')
                set('phone', v)
              }}
              placeholder="+2348012345678"
              inputMode="tel"
              className={inputCls}
            />
          </label>

          {verificationRequired && (
            <PhoneVerifyInline
              phone={form.phone}
              verified={phoneVerified}
              onVerified={() => setPhoneVerified(true)}
            />
          )}

          <label className="block">
            <span className="lx-mono mb-2 block">Phone number for calls (leave blank if same as WhatsApp)</span>
            <input
              value={form.call_phone}
              onChange={(e) => {
                const v = e.target.value
                set('call_phone', v && !v.startsWith('+234') ? '+234' + v.replace(/^\+?234?/, '') : v)
              }}
              placeholder="Same as WhatsApp"
              inputMode="tel"
              className={inputCls}
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading || (verificationRequired && !phoneVerified)}
            className="lx-btn-amber w-full py-4 text-sm disabled:opacity-50"
            style={{ minHeight: 52 }}
          >
            {loading ? 'Creating…' : (verificationRequired && !phoneVerified) ? 'Verify phone to continue' : 'Create Rider Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'lx-field w-full px-4 py-3'
