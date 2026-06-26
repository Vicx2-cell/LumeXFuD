'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { GlassSheen } from '@/components/fx'

type Result = {
  result: 'valid' | 'tampered' | 'not_found'
  expected_code?: string
  transaction?: { reference: string; party: string; type: string; status: string; amount: string; created_at: string }
}

export default function VerifyReceiptPage() {
  const router = useRouter()
  const [reference, setReference] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Result | null>(null)
  const [error, setError] = useState('')

  const verify = useCallback(async (refArg?: string, codeArg?: string) => {
    const ref = (refArg ?? reference).trim()
    const cod = (codeArg ?? code).trim()
    if (!ref || !cod) return
    setBusy(true); setError(''); setRes(null)
    try {
      const r = await fetch('/api/admin/verify-receipt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref, code: cod }),
      })
      if (r.status === 401 || r.status === 403) { router.push('/auth'); return }
      const d = await r.json() as Result & { error?: string }
      if (!r.ok) { setError(d.error ?? 'Could not verify'); return }
      setRes(d)
    } catch { setError('Network error') }
    finally { setBusy(false) }
  }, [reference, code, router])

  // Auto-fill + auto-verify from a verify link (?r=…&c=…) — no typing needed.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const r = q.get('r'), c = q.get('c')
    if (r && c) { setReference(r); setCode(c); void verify(r, c) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="lx-page lx-console px-5 py-10 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-md lx-enter">
        <PageHeader title="Verify a receipt" badge="Admin" />
        <p className="text-sm text-white/45 mb-5">Paste the <b>reference</b> and <b>verification code</b> from a customer/vendor/rider receipt. We recompute the cryptographic seal from the real record — a doctored receipt fails.</p>

        <div className="lx-surface p-4 space-y-3">
          <div>
            <label className="text-xs text-white/50 block mb-1">Reference</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. RIDER-abc123… / WD-… / CWUSE-…"
              className="lx-field w-full px-3 py-2.5 text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs text-white/50 block mb-1">Verification code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1B2-C3D4-E5F6-7890"
              className="lx-field w-full px-3 py-2.5 text-sm font-mono uppercase" />
          </div>
          <button onClick={() => verify()} disabled={busy || !reference.trim() || !code.trim()} className="lx-btn-amber w-full py-3 text-sm disabled:opacity-50">
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {/* Result */}
        {res && (
          <div className="mt-4 rounded-2xl p-4 lx-enter" style={{
            background: res.result === 'valid' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${res.result === 'valid' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
          }}>
            {res.result === 'valid' && (
              <>
                <p className="font-bold text-green-400 mb-2">✓ Genuine & unaltered</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-white/50">Party</span><span className="text-white">{res.transaction!.party}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Type</span><span className="text-white">{res.transaction!.type}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Amount</span><span className="text-white tabular-nums">{res.transaction!.amount}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Status</span><span className="text-white">{res.transaction!.status}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Date</span><span className="text-white">{new Date(res.transaction!.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
                </div>
              </>
            )}
            {res.result === 'tampered' && (
              <>
                <p className="font-bold text-red-400 mb-1">✗ Does NOT match — altered or fake code</p>
                <p className="text-xs text-white/60">A transaction with that reference exists, but the code doesn’t match its real details. The receipt was likely edited. The genuine record:</p>
                <div className="space-y-1 text-sm mt-2">
                  <div className="flex justify-between"><span className="text-white/50">True amount</span><span className="text-white tabular-nums">{res.transaction!.amount}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">True type</span><span className="text-white">{res.transaction!.type}</span></div>
                  <div className="flex justify-between"><span className="text-white/50">Status</span><span className="text-white">{res.transaction!.status}</span></div>
                </div>
              </>
            )}
            {res.result === 'not_found' && (
              <p className="font-bold text-red-400">✗ No transaction with that reference. The receipt is fake or the reference is wrong.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
