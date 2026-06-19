'use client'

import { useEffect, useState } from 'react'
import { useFeatures } from '@/lib/use-features'
import { downloadReceiptPng } from '@/lib/receipt-download'

const PRESETS = [1000, 2000, 5000, 10000]

interface Receipt { reference: string; amount_formatted: string; student_first_name: string; from?: string | null; created_at: string; receipt_code: string }

export default function SponsorPage() {
  const features = useFeatures()
  const [phone, setPhone] = useState('+234')
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [receiptPending, setReceiptPending] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('status') === 'success') setDone(true)
    // A student shares /sponsor?phone=+234… so the parent lands prefilled.
    const p = q.get('phone')
    if (p && /^\+?\d{7,}$/.test(p)) setPhone(p.startsWith('+') ? p : '+' + p)

    // Poll for the receipt once the payment confirms (webhook credits async).
    const ref = q.get('ref')
    if (q.get('status') === 'success' && ref) {
      setReceiptPending(true)
      let tries = 0
      const tick = async () => {
        tries++
        try {
          const res = await fetch(`/api/sponsor-wallet/receipt?ref=${encodeURIComponent(ref)}`, { cache: 'no-store' })
          const d = await res.json()
          if (res.ok && d.pending === false) { setReceipt(d); setReceiptPending(false); return }
        } catch { /* retry */ }
        if (tries < 8) setTimeout(tick, 2000)
        else setReceiptPending(false)
      }
      tick()
    }
  }, [])

  const saveReceipt = () => {
    if (!receipt) return
    downloadReceiptPng({
      title: 'Wallet Top-up Receipt',
      party: 'LumeX Wallet',
      amountLine: `+${receipt.amount_formatted}`,
      amountPositive: true,
      rows: [
        ...(receipt.from ? [['From', receipt.from] as [string, string]] : []),
        ['To', receipt.student_first_name],
        ['Date', new Date(receipt.created_at).toLocaleString()],
        ['Method', 'Paystack'],
      ],
      reference: receipt.reference,
      code: receipt.receipt_code,
      refName: receipt.reference,
    })
  }

  if (features.sponsor_topup === false) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-5" style={{ background: '#0A0A0B' }}>
        <p className="text-white/60 text-sm text-center max-w-xs">Topping up a student’s wallet isn’t available right now. Please check back later.</p>
      </div>
    )
  }

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
        <div className="w-full max-w-md rounded-3xl border border-green-500/30 bg-green-500/10 p-8">
          <div className="text-center">
            <div className="text-4xl mb-3">✅</div>
            <h1 className="text-xl font-bold text-white">Thank you!</h1>
            <p className="text-sm text-white/60 mt-2">
              {receipt
                ? `${receipt.amount_formatted} sent to ${receipt.student_first_name}'s wallet. They've been notified.`
                : 'The wallet will be credited as soon as the payment confirms (usually seconds). The student gets a notification.'}
            </p>
          </div>

          {receiptPending && !receipt && (
            <p className="mt-5 text-center text-xs text-white/40">Preparing your receipt…</p>
          )}

          {receipt && (
            <div className="mt-5 rounded-2xl p-4 text-sm" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="flex justify-between py-1"><span className="text-white/45">Amount</span><span className="text-white font-semibold">{receipt.amount_formatted}</span></div>
              {receipt.from && <div className="flex justify-between py-1"><span className="text-white/45">From</span><span className="text-white">{receipt.from}</span></div>}
              <div className="flex justify-between py-1"><span className="text-white/45">To</span><span className="text-white">{receipt.student_first_name}</span></div>
              <div className="flex justify-between py-1"><span className="text-white/45">Date</span><span className="text-white">{new Date(receipt.created_at).toLocaleString()}</span></div>
              <div className="py-1"><span className="text-white/45">Reference</span><p className="text-white/80 text-xs font-mono break-all">{receipt.reference}</p></div>
              <div className="py-1"><span className="text-white/45">Verification code</span><p className="text-white/80 text-xs font-mono">{receipt.receipt_code}</p></div>
              <button onClick={saveReceipt} className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold text-black" style={{ background: '#F5A623' }}>
                Download receipt
              </button>
            </div>
          )}

          <button onClick={() => { setDone(false); setReceipt(null); setAmount(''); window.history.replaceState({}, '', '/sponsor') }}
            className="mt-4 w-full rounded-2xl py-3 text-sm font-semibold text-white/70 border border-white/10">
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
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">Your name (so they know it’s from you)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mum, Dad, Uncle Chidi" className={inputCls} />
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
