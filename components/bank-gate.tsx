'use client'

import { useEffect, useState } from 'react'
import AddBankSheet from '@/components/wallet/AddBankSheet'

// Mandatory verified-bank gate for vendors & riders. Wrap a dashboard's content:
//   <BankGate><Dashboard/></BankGate>
// Until a Paystack-verified payout bank is on file, the children are NOT rendered
// — the dashboard, accepting orders and going online are all blocked (the matching
// API routes enforce the same gate server-side). The bank is the destination for
// both manual withdrawals and the 48h auto-sweep, so it's collected up front.
//
// save-bank requires a wallet PIN first, so the gate sequences PIN → bank. It
// fails OPEN on a network blip (never lock someone out of their own dashboard) —
// the server-side checks remain the hard backstop.
interface Status { exempt?: boolean; has_pin: boolean; has_verified_bank: boolean }

export function BankGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [checking, setChecking] = useState(true)
  const [addBankOpen, setAddBankOpen] = useState(false)

  // PIN setup (inline — the wallet page lives behind this gate, so we can't send
  // them there to set it).
  const [pinOpen, setPinOpen] = useState(false)
  const [pinStep, setPinStep] = useState(1)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinError, setPinError] = useState('')

  async function refresh() {
    try {
      const r = await fetch('/api/auth/bank/status')
      const d = (await r.json()) as Status
      setStatus(d)
    } catch {
      setStatus({ exempt: true, has_pin: true, has_verified_bank: true }) // fail open
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => { refresh() }, [])

  async function savePin() {
    if (newPin !== confirmPin) { setPinError('PINs do not match'); return }
    setPinSaving(true); setPinError('')
    try {
      const r = await fetch('/api/wallet/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: newPin, confirm_pin: confirmPin }),
      })
      const d = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok) { setPinError(d.error ?? 'Could not set PIN'); return }
      setPinOpen(false); setNewPin(''); setConfirmPin(''); setPinStep(1)
      await refresh()
      setAddBankOpen(true) // straight into adding the bank
    } catch { setPinError('Network error. Try again.') }
    finally { setPinSaving(false) }
  }

  if (checking) {
    return <div className="lx-page flex items-center justify-center"><p className="text-white/40 text-sm">Loading…</p></div>
  }

  // Verified (or exempt) → show the app.
  if (status?.exempt || status?.has_verified_bank) return <>{children}</>

  return (
    <div className="lx-page flex items-start sm:items-center justify-center px-5 py-10 sm:py-12 overflow-x-hidden" style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-md space-y-6 lx-enter">
        <div className="glass p-6">
          <span className="text-4xl" aria-hidden="true">🏦</span>
          <h1 className="text-2xl font-bold text-white mt-3">Add your payout account</h1>
          <p className="mt-2 text-sm text-white/65 leading-relaxed">
            Before you start, add the bank account where you’ll get paid. This is the only place your earnings go.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-white/65">
            <li className="flex gap-2"><span aria-hidden="true">💸</span> Withdraw anytime — and any earnings you don’t withdraw are <b className="text-white">automatically paid out after 48 hours</b>.</li>
            <li className="flex gap-2"><span aria-hidden="true">✅</span> We verify the account with your bank so your money never goes astray.</li>
            <li className="flex gap-2"><span aria-hidden="true">🔒</span> Your account number is encrypted. You can change it later (re-verified each time).</li>
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          {!status?.has_pin ? (
            <button
              type="button"
              onClick={() => { setPinOpen(true); setPinStep(1); setNewPin(''); setConfirmPin(''); setPinError('') }}
              className="lx-btn-amber w-full py-4 text-sm font-semibold"
            >
              Step 1: Set your wallet PIN
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAddBankOpen(true)}
              className="lx-btn-amber w-full py-4 text-sm font-semibold"
            >
              Add &amp; verify bank account
            </button>
          )}
          <p className="text-xs text-white/30 text-center">A 4-digit wallet PIN protects your payouts. You’ll set it once.</p>
        </div>
      </div>

      {/* Inline PIN setup */}
      {pinOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60 lx-scrim" onClick={() => setPinOpen(false)} />
          <div className="lx-sheet relative w-full sm:max-w-md bg-[#111] rounded-t-2xl sm:rounded-2xl sm:mb-4 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto">
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />
            <h3 className="text-white font-semibold text-lg mb-4">{pinStep === 1 ? 'Set your wallet PIN' : 'Confirm your PIN'}</h3>
            <div className="flex justify-center gap-4 mb-6">
              {[0,1,2,3].map((i) => {
                const len = pinStep === 1 ? newPin.length : confirmPin.length
                return <div key={i} className={`w-4 h-4 rounded-full border-2 ${i < len ? 'bg-amber-500 border-amber-500' : 'border-white/30'}`} />
              })}
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) => {
                const val = pinStep === 1 ? newPin : confirmPin
                const set = pinStep === 1 ? setNewPin : setConfirmPin
                return (
                  <button
                    key={k}
                    disabled={!k || (k !== '⌫' && val.length >= 4)}
                    className="h-16 rounded-2xl bg-white/10 text-white text-xl font-medium active:bg-white/20 disabled:opacity-0"
                    onClick={() => {
                      if (k === '⌫') { set((p) => p.slice(0, -1)); setPinError('') }
                      else if (val.length < 4) set((p) => p + k)
                    }}
                  >
                    {k}
                  </button>
                )
              })}
            </div>
            {pinError && <p className="text-red-400 text-sm text-center mb-3">{pinError}</p>}
            {pinStep === 1 ? (
              <button className="lx-btn-amber w-full py-4 disabled:opacity-40" disabled={newPin.length < 4} onClick={() => { setPinStep(2); setConfirmPin('') }}>
                Continue
              </button>
            ) : (
              <button className="lx-btn-amber w-full py-4 disabled:opacity-40" disabled={confirmPin.length < 4 || pinSaving} onClick={savePin}>
                {pinSaving ? 'Saving…' : 'Set PIN'}
              </button>
            )}
          </div>
        </div>
      )}

      <AddBankSheet
        open={addBankOpen}
        onClose={() => setAddBankOpen(false)}
        onSuccess={() => { refresh() }}
      />
    </div>
  )
}
