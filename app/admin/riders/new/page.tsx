'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface SuccessData {
  temp_pin: string
  full_name: string
  phone: string
  whatsapp_message: string
}

export default function NewRiderPage() {
  const router = useRouter()
  const [form, setForm] = useState({ full_name: '', phone: '+234' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<SuccessData | null>(null)
  const [copied, setCopied] = useState(false)

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setError('')
  }

  const handleSubmit = async () => {
    if (!form.full_name.trim() || form.phone.length < 13) {
      setError('Please fill in all required fields.')
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
      <div className="min-h-dvh flex items-start justify-center px-5 py-12" style={{ background: '#0A0A0B' }}>
        <div className="w-full max-w-md space-y-4">
          <div className="rounded-3xl border border-green-500/30 bg-green-500/10 p-6">
            <p className="text-lg font-semibold text-white">Rider account created</p>
            <div className="mt-3 space-y-1 text-sm text-white/60">
              <p>Name: <span className="text-white">{success.full_name}</span></p>
              <p>Phone: <span className="text-white">{success.phone}</span></p>
            </div>
            <div className="mt-4">
              <p className="text-xs text-white/40 mb-1 uppercase tracking-widest">Temporary PIN</p>
              <p className="text-4xl font-bold tracking-[0.3em] text-amber-400">{success.temp_pin}</p>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
            <p className="text-xs font-medium text-white/40 uppercase tracking-widest">Send this WhatsApp message to them</p>
            <p
              className="rounded-xl p-3 text-sm text-white/80 whitespace-pre-wrap"
              style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}
            >
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
    <div className="min-h-dvh px-5 py-10" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-md">
        <button onClick={() => router.push('/admin')} className="mb-6 text-sm text-white/40 hover:text-white">
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white mb-1">Add Rider</h1>
        <p className="text-sm text-white/40 mb-8">A temporary PIN will be generated and shown after creation.</p>

        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Full name</span>
            <input
              value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              placeholder="Emeka Eze"
              className={inputCls}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Phone number (+234)</span>
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

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full rounded-2xl py-4 text-sm font-semibold text-black disabled:opacity-50"
            style={{ background: '#F5A623', minHeight: 52 }}
          >
            {loading ? 'Creating…' : 'Create Rider Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none focus:border-amber-500/60'
