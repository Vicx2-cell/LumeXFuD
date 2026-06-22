'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFeatures } from '@/lib/use-features'
import PhoneVerifyInline from '@/components/auth/PhoneVerifyInline'

interface SuccessData {
  temp_pin: string
  vendor_name: string
  phone: string
  whatsapp_message: string
}

const CATEGORIES = ['Rice', 'Protein', 'Drinks', 'Snacks', 'Other'] as const
const TIERS = ['FOUNDING', 'EARLY', 'STANDARD'] as const

export default function NewVendorPage() {
  const router = useRouter()
  // OTP gate mirrors customer sign-up; a super admin can disable it (phone_verification)
  // while OTP delivery is down. Defaults to required until flags load.
  const features = useFeatures()
  const verificationRequired = features.phone_verification !== false
  const [form, setForm] = useState({
    owner_name: '',
    shop_name: '',
    phone: '+234',
    call_phone: '',
    category: 'Other',
    subscription_tier: 'STANDARD',
  })
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
    if (!form.owner_name.trim() || !form.shop_name.trim() || form.phone.length < 13) {
      setError('Please fill in all required fields.')
      return
    }
    if (verificationRequired && !phoneVerified) {
      setError('Verify the vendor’s phone number first.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/admin/vendors/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create vendor.')
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
      <div className="lx-page flex items-start justify-center px-5 py-12">
        <div className="w-full max-w-md space-y-4">
          <div className="rounded-3xl border border-green-500/30 bg-green-500/10 p-6">
            <p className="text-lg font-semibold text-white">Vendor account created</p>
            <div className="mt-3 space-y-1 text-sm text-white/60">
              <p>Shop: <span className="text-white">{success.vendor_name}</span></p>
              <p>Phone: <span className="text-white">{success.phone}</span></p>
            </div>
            <div className="mt-4">
              <p className="text-xs text-white/40 mb-1 uppercase tracking-widest">Temporary PIN</p>
              <p className="text-4xl font-bold tracking-[0.3em] text-amber-400">{success.temp_pin}</p>
            </div>
          </div>

          <div className="glass-thin rounded-3xl p-5 space-y-3">
            <p className="text-xs font-medium text-white/40 uppercase tracking-widest">Send this WhatsApp message to them</p>
            <p className="glass-thin rounded-xl p-3 text-sm text-white/80 whitespace-pre-wrap">
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
    <div className="lx-page px-5 py-10">
      <div className="mx-auto max-w-md">
        <button onClick={() => router.back()} className="mb-6 text-sm text-white/40 hover:text-white">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white mb-1">Add Vendor</h1>
        <p className="text-sm text-white/40 mb-8">A temporary PIN will be generated and shown after creation.</p>

        <div className="glass-thin space-y-4 rounded-3xl p-6">
          <Field label="Owner full name">
            <input
              value={form.owner_name}
              onChange={(e) => set('owner_name', e.target.value)}
              placeholder="Ngozi Okafor"
              className={inputCls}
            />
          </Field>

          <Field label="Shop name">
            <input
              value={form.shop_name}
              onChange={(e) => set('shop_name', e.target.value)}
              placeholder="Belleful Kitchen"
              className={inputCls}
            />
          </Field>

          <Field label="WhatsApp number (+234) — for messages & login">
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
          </Field>

          {verificationRequired && (
            <PhoneVerifyInline
              phone={form.phone}
              verified={phoneVerified}
              onVerified={() => setPhoneVerified(true)}
            />
          )}

          <Field label="Phone number for calls (leave blank if same as WhatsApp)">
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
          </Field>

          <Field label="Category">
            <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>

          <Field label="Subscription tier">
            <select value={form.subscription_tier} onChange={(e) => set('subscription_tier', e.target.value)} className={inputCls}>
              {TIERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading || (verificationRequired && !phoneVerified)}
            className="lx-btn-amber w-full py-4 text-sm disabled:opacity-50"
            style={{ minHeight: 52 }}
          >
            {loading ? 'Creating…' : (verificationRequired && !phoneVerified) ? 'Verify phone to continue' : 'Create Vendor Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'lx-field w-full px-4 py-3'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">{label}</span>
      {children}
    </label>
  )
}
