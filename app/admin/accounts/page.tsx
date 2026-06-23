'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'

interface Found { found: boolean; role?: string; name?: string; suspended?: boolean; reason?: string | null; blocked?: boolean }

export default function AdminAccounts() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [result, setResult] = useState<Found | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  // Wallet adjustment
  const [adjAmount, setAdjAmount] = useState('')
  const [adjDir, setAdjDir] = useState<'credit' | 'debit'>('credit')
  const [adjReason, setAdjReason] = useState('')
  const [adjBusy, setAdjBusy] = useState(false)
  const [adjError, setAdjError] = useState('')

  const [faceUrl, setFaceUrl] = useState('')
  const [faceVerified, setFaceVerified] = useState(false)
  const [faceBusy, setFaceBusy] = useState(false)
  async function viewFace() {
    setFaceBusy(true); setFaceUrl('')
    try {
      const res = await fetch(`/api/admin/face?phone=${encodeURIComponent(phone.trim())}`)
      const d = await res.json() as { found?: boolean; url?: string; verified?: boolean }
      if (d.found && d.url) { setFaceUrl(d.url); setFaceVerified(!!d.verified) }
      else setToast('No photo on file for this account')
    } catch { setToast('Could not load photo') }
    finally { setFaceBusy(false) }
  }
  async function reviewFace(action: 'approve' | 'reject') {
    setFaceBusy(true)
    try {
      const res = await fetch('/api/admin/face', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), action }),
      })
      if (res.ok) {
        setToast(action === 'approve' ? 'Photo verified ✓' : 'Photo rejected — user must re-upload')
        if (action === 'approve') setFaceVerified(true)
        else setFaceUrl('')
      } else setToast('Could not update photo')
    } catch { setToast('Network error') }
    finally { setFaceBusy(false) }
  }
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }

  async function adjustWallet() {
    const n = parseInt(adjAmount, 10)
    if (!n || n <= 0) { setAdjError('Enter an amount'); return }
    if (adjReason.trim().length < 3) { setAdjError('Add a reason'); return }
    setAdjBusy(true); setAdjError('')
    try {
      const res = await fetch('/api/admin/wallet-adjust', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), amount_naira: adjDir === 'debit' ? -n : n, reason: adjReason.trim() }),
      })
      const d = await res.json() as { error?: string; new_balance_kobo?: number }
      if (!res.ok) { setAdjError(d.error ?? 'Failed'); return }
      showToast(`${adjDir === 'credit' ? 'Credited' : 'Debited'} ₦${n.toLocaleString()} — new balance ₦${((d.new_balance_kobo ?? 0) / 100).toLocaleString()}`)
      setAdjAmount(''); setAdjReason('')
    } catch { setAdjError('Network error') } finally { setAdjBusy(false) }
  }

  async function lookup() {
    if (phone.trim().length < 7) { setError('Enter a phone number'); return }
    setBusy(true); setError(''); setResult(null); setFaceUrl('')
    try {
      const res = await fetch(`/api/admin/suspend?phone=${encodeURIComponent(phone.trim())}`)
      const d = await res.json() as Found & { error?: string }
      if (!res.ok) { setError(d.error ?? 'Lookup failed'); return }
      setResult(d)
      if (d.reason) setReason(d.reason)
    } catch { setError('Network error') } finally { setBusy(false) }
  }

  async function act(action: 'suspend' | 'unsuspend') {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/admin/suspend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), action, reason: reason.trim() || undefined }),
      })
      const d = await res.json() as { error?: string; suspended?: boolean }
      if (!res.ok) { setError(d.error ?? 'Action failed'); return }
      showToast(action === 'suspend' ? 'Account suspended' : 'Account reinstated')
      setResult((r) => r ? { ...r, suspended: action === 'suspend' } : r)
    } catch { setError('Network error') } finally { setBusy(false) }
  }

  const [banBusy, setBanBusy] = useState(false)
  async function banAct(action: 'block' | 'unblock') {
    if (action === 'block' && !window.confirm('Ban this number? They will be logged out, blocked from ordering, and can NEVER register again until you unblock. Reversible.')) return
    setBanBusy(true); setError('')
    try {
      const res = await fetch('/api/admin/block', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), action, reason: reason.trim() || undefined }),
      })
      const d = await res.json() as { error?: string; blocked?: boolean }
      if (!res.ok) { setError(d.error ?? 'Action failed'); return }
      showToast(action === 'block' ? 'Number banned & blocked' : 'Number unblocked')
      // Ban blocks + suspends; unban unblocks + lifts the suspension (server mirrors this).
      setResult((r) => r ? { ...r, blocked: action === 'block', suspended: action === 'block' } : r)
    } catch { setError('Network error') } finally { setBanBusy(false) }
  }

  return (
    <div className="lx-page px-4 py-8">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg" style={{ background: '#F5A623', color: '#000' }}>{toast}</div>}
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} aria-label="Go back" className="w-11 h-11 rounded-full flex items-center justify-center text-white/50" style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <h1 className="text-xl font-bold text-white">Accounts</h1>
        </div>

        <div className="glass-thin rounded-2xl p-5">
          <label className="text-xs text-white/50 block mb-1.5">Find an account by phone</label>
          <div className="flex gap-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lookup() }} placeholder="+234… or 0…"
              className="lx-field flex-1 px-3 py-2.5 text-sm outline-none" />
            <button onClick={lookup} disabled={busy} className="lx-btn-amber px-4 text-sm disabled:opacity-50">Find</button>
          </div>

          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

          {result && !result.found && <p className="text-sm text-white/50 mt-4">No account found for that number.</p>}

          {result?.found && (
            <div className="mt-5 pt-4 border-t border-white/8">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-white">{result.name}</p>
                  <p className="text-xs text-white/45 uppercase tracking-wide">{result.role}</p>
                </div>
                <Badge color={(result.blocked || result.suspended) ? 'var(--lx-red)' : 'var(--lx-green)'}>
                  {result.blocked ? 'Banned' : result.suspended ? 'Suspended' : 'Active'}
                </Badge>
              </div>

              {/* KYC selfie (fraud review) — private, fetched via a short-lived signed URL */}
              <div className="mb-3">
                {faceUrl ? (
                  <div className="flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={faceUrl} alt="KYC selfie" className="w-28 h-28 rounded-xl object-cover" style={{ border: '1px solid rgba(255,255,255,0.1)' }} />
                    <div className="flex-1">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: faceVerified ? 'rgba(34,197,94,0.15)' : 'rgba(245,166,35,0.15)', color: faceVerified ? '#22C55E' : '#F5A623' }}>
                        {faceVerified ? '✓ Verified' : 'Pending review'}
                      </span>
                      {!faceVerified && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => reviewFace('approve')} disabled={faceBusy} className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}>Approve</button>
                          <button onClick={() => reviewFace('reject')} disabled={faceBusy} className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}>Reject</button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <button onClick={viewFace} disabled={faceBusy} className="lx-amber text-xs font-medium disabled:opacity-50">
                    {faceBusy ? 'Loading…' : '🪪 View KYC photo'}
                  </button>
                )}
              </div>

              {!result.suspended && (
                <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} placeholder="Reason (optional, shown to them)"
                  className="lx-field w-full px-3 py-2.5 text-sm outline-none mb-3" />
              )}

              {result.suspended ? (
                <button onClick={() => act('unsuspend')} disabled={busy} className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}>
                  Reinstate account
                </button>
              ) : (
                <button onClick={() => act('suspend')} disabled={busy} className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                  Suspend account
                </button>
              )}
              <p className="text-[11px] text-white/30 mt-2 text-center">Suspending blocks login{result.role === 'customer' ? ' and ordering' : ''}.</p>

              {/* Ban & block number (super admin) — permanent restriction */}
              <div className="mt-5 pt-4 border-t border-white/8">
                <p className="text-xs uppercase tracking-wide text-white/40 mb-2 font-semibold">Ban &amp; block number</p>
                {result.blocked ? (
                  <button onClick={() => banAct('unblock')} disabled={banBusy} className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}>
                    {banBusy ? 'Working…' : 'Unblock this number'}
                  </button>
                ) : (
                  <button onClick={() => banAct('block')} disabled={banBusy} className="w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.2)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.4)' }}>
                    {banBusy ? 'Working…' : 'Ban & block this number'}
                  </button>
                )}
                <p className="text-[11px] text-white/30 mt-2 text-center">Super admin only · blocks login + ordering AND stops the number from ever registering again · reversible · audited.</p>
              </div>

              {/* Wallet adjustment (super admin) */}
              <div className="mt-5 pt-4 border-t border-white/8">
                <p className="text-xs uppercase tracking-wide text-white/40 mb-2 font-semibold">Adjust wallet</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button onClick={() => setAdjDir('credit')} className="py-2 rounded-xl text-xs font-semibold" style={{ background: adjDir === 'credit' ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)', color: adjDir === 'credit' ? '#22C55E' : 'rgba(255,255,255,0.6)', border: `1px solid ${adjDir === 'credit' ? '#22C55E55' : 'rgba(255,255,255,0.1)'}` }}>+ Credit</button>
                  <button onClick={() => setAdjDir('debit')} className="py-2 rounded-xl text-xs font-semibold" style={{ background: adjDir === 'debit' ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.06)', color: adjDir === 'debit' ? '#EF4444' : 'rgba(255,255,255,0.6)', border: `1px solid ${adjDir === 'debit' ? '#EF444455' : 'rgba(255,255,255,0.1)'}` }}>− Debit</button>
                </div>
                <div className="relative mb-2">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">₦</span>
                  <input type="number" min="1" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="Amount in naira"
                    className="lx-field w-full pl-7 pr-3 py-2.5 text-sm outline-none" />
                </div>
                <input value={adjReason} onChange={(e) => setAdjReason(e.target.value.slice(0, 300))} placeholder="Reason (required, audited)"
                  className="lx-field w-full px-3 py-2.5 text-sm outline-none mb-2" />
                {adjError && <p className="text-sm text-red-400 mb-2">{adjError}</p>}
                <button onClick={adjustWallet} disabled={adjBusy} className="lx-btn-amber w-full py-3 text-sm disabled:opacity-50">
                  {adjBusy ? 'Applying…' : `${adjDir === 'credit' ? 'Credit' : 'Debit'} wallet`}
                </button>
                <p className="text-[11px] text-white/30 mt-2 text-center">Super admin only · max ₦500,000 · fully audited.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
