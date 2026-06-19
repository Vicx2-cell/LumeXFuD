'use client'

import { useEffect, useState } from 'react'

const PRESETS = [1000, 2000, 5000, 10000]

export default function SponsorPage() {
  const [phone, setPhone] = useState('+234')
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('status') === 'success') setDone(true)
  }, [])

  const submit = async () => {
    setError('')
    const n = parseInt(amount, 10)
    if (phone.length < 13) { setError('Enter the student’s phone number.'); return }
    if (!n || n <= 0) { setError('Enter an amount.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/sponsor-wallet/topup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, amount_naira: n, sponsor_name: name.trim() || undefined }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not start the payment.'); return }
      window.location.href = d.authorization_url
    } catch { setError('Network error. Please try again.') } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-5" style={{ background: '#0A0A0B' }}>
        <div className="w-full max-w-md text-center rounded-3xl border border-green-500/30 bg-green-500/10 p-8">
          <div className="text-4xl mb-3">✅</div>
          <h1 className="text-xl font-bold text-white">Thank you!</h1>
          <p className="text-sm text-white/60 mt-2">
            The wallet will be credited as soon as the payment confirms (usually seconds). The student gets a notification.
          </p>
          <button onClick={() => { setDone(false); setAmount(''); window.history.replaceState({}, '', '/sponsor') }}
            className="mt-6 w-full rounded-2xl py-3 text-sm font-semibold text-black" style={{ background: '#F5A623' }}>
            Send another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-5 py-12" style={{ background: '#0A0A0B' }}>
      <div className="w-full max-w-md space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-bold" style={{ background: 'linear-gradient(135deg,#fff,#F5A623)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            Send food money
          </h1>
          <p className="text-sm text-white/50 mt-2">Top up a student’s LumeX wallet. They can spend it on any meal — you don’t need an account.</p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Student’s phone number</span>
            <input value={phone} inputMode="tel"
              onChange={(e) => { let v = e.target.value; if (!v.startsWith('+234')) v = '+234' + v.replace(/^\+?234?/, ''); setPhone(v); setError('') }}
              placeholder="+2348012345678" className={inputCls} />
          </label>

          <div>
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Amount</span>
            <div className="grid grid-cols-4 gap-2 mb-2">
              {PRESETS.map((p) => (
                <button key={p} onClick={() => { setAmount(String(p)); setError('') }}
                  className="py-2 rounded-xl text-sm font-semibold"
                  style={{ background: amount === String(p) ? 'rgba(245,166,35,0.2)' : 'rgba(255,255,255,0.06)', color: amount === String(p) ? '#F5A623' : '#fff', border: `1px solid ${amount === String(p) ? '#F5A62355' : 'rgba(255,255,255,0.1)'}` }}>
                  ₦{p.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">₦</span>
              <input type="number" min="1" value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }}
                placeholder="Other amount" className={`${inputCls} pl-7`} />
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Your name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="From… (e.g. Mum)" className={inputCls} />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button onClick={submit} disabled={busy}
            className="w-full rounded-2xl py-4 text-sm font-semibold text-black disabled:opacity-50" style={{ background: '#F5A623', minHeight: 52 }}>
            {busy ? 'Starting payment…' : 'Continue to payment'}
          </button>
          <p className="text-[11px] text-white/30 text-center">Secured by Paystack. The money goes straight into the student’s food wallet.</p>
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-white outline-none focus:border-amber-500/60'
