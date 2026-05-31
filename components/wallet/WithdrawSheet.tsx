'use client'

import { useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  availableKobo: number
  bankName: string | null
  bankLast4: string | null
  pinSet: boolean
  bankConnected: boolean
  bankReady: boolean
  bankReadyAt: string | null
}

export default function WithdrawSheet({
  open,
  onClose,
  onSuccess,
  availableKobo,
  bankName,
  bankLast4,
  pinSet,
  bankConnected,
  bankReady,
  bankReadyAt,
}: Props) {
  const [step, setStep] = useState(1)
  const [amountStr, setAmountStr] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ amount: string; bank: string } | null>(null)

  const availableNaira = Math.floor(availableKobo / 100)
  const amountNaira = parseInt(amountStr, 10) || 0

  function reset() {
    setStep(1); setAmountStr(''); setPin(''); setError(''); setResult(null)
  }

  function handleClose() { reset(); onClose() }

  function canProceedAmount() {
    return amountNaira >= 500 && amountNaira <= 25_000 && amountNaira <= availableNaira
  }

  async function handleWithdraw() {
    if (pin.length < 4) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_naira: amountNaira, wallet_pin: pin }),
      })
      const d = await res.json()
      if (!res.ok) {
        setPin(''); setError(d.error ?? 'Withdrawal failed')
        return
      }
      setResult({ amount: d.amount, bank: `${bankName} ****${bankLast4}` })
      setStep(4)
      onSuccess()
    } catch {
      setPin(''); setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Auto-submit when 4th digit is entered
  function handlePinDigit(digit: string) {
    if (pin.length >= 4) return
    const next = pin + digit
    setPin(next)
    if (next.length === 4) {
      setTimeout(() => {
        const event = new CustomEvent('pin-complete', { detail: next })
        document.dispatchEvent(event)
      }, 50)
    }
  }

  // Listen for pin-complete
  if (typeof window !== 'undefined') {
    document.addEventListener('pin-complete', () => {
      handleWithdraw()
    }, { once: true })
  }

  if (!open) return null

  // Pre-flight checks
  if (!pinSet) {
    return (
      <div className="fixed inset-0 z-50 flex items-end">
        <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
        <div className="relative w-full bg-[#111] rounded-t-2xl p-6">
          <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />
          <p className="text-white/60 text-center mb-4">Set a wallet PIN first to enable withdrawals.</p>
          <button className="w-full bg-amber-500 text-black font-semibold py-4 rounded-xl" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  if (!bankConnected) {
    return (
      <div className="fixed inset-0 z-50 flex items-end">
        <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
        <div className="relative w-full bg-[#111] rounded-t-2xl p-6">
          <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />
          <p className="text-white/60 text-center mb-4">Add a bank account to withdraw earnings.</p>
          <button className="w-full bg-amber-500 text-black font-semibold py-4 rounded-xl" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  if (!bankReady) {
    const readyAt = bankReadyAt ? new Date(bankReadyAt).toLocaleDateString('en-NG', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }) : 'soon'
    return (
      <div className="fixed inset-0 z-50 flex items-end">
        <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
        <div className="relative w-full bg-[#111] rounded-t-2xl p-6">
          <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />
          <p className="text-amber-400 text-center font-semibold mb-2">New bank account</p>
          <p className="text-white/60 text-center text-sm mb-4">
            Withdrawals from this bank available from {readyAt}.
          </p>
          <button className="w-full bg-amber-500 text-black font-semibold py-4 rounded-xl" onClick={handleClose}>
            Got it
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
      <div className="relative w-full bg-[#111] rounded-t-2xl p-6">
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />

        {/* Step 1: Enter amount */}
        {step === 1 && (
          <div>
            <h3 className="text-white font-semibold text-lg mb-4">How much to withdraw?</h3>
            <div className="relative mb-2">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 text-xl">₦</span>
              <input
                className="w-full bg-white/10 text-white text-xl text-right rounded-xl px-4 py-4 pr-4 outline-none focus:ring-1 focus:ring-amber-500"
                placeholder="0"
                value={amountStr}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setAmountStr(v)
                }}
                inputMode="numeric"
                autoFocus
              />
            </div>
            <div className="flex justify-between text-white/50 text-xs mb-1">
              <span>Min: ₦500</span>
              <span>Max per transaction: ₦25,000</span>
            </div>
            <p className="text-white/60 text-sm mb-6">
              Available: <span className="text-white font-medium">₦{availableNaira.toLocaleString()}</span>
            </p>
            {amountNaira > availableNaira && (
              <p className="text-red-400 text-sm mb-3">Insufficient available balance</p>
            )}
            {amountNaira > 25_000 && (
              <p className="text-red-400 text-sm mb-3">Maximum ₦25,000 per transaction</p>
            )}
            <button
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold py-4 rounded-xl disabled:opacity-40 transition-colors"
              disabled={!canProceedAmount()}
              onClick={() => { setError(''); setStep(2) }}
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 2: Enter PIN */}
        {step === 2 && (
          <div>
            <h3 className="text-white font-semibold text-lg mb-1">Enter wallet PIN</h3>
            <p className="text-white/50 text-sm mb-6">
              Sending ₦{amountNaira.toLocaleString()} to {bankName} ****{bankLast4}
            </p>

            <div className="flex justify-center gap-4 mb-6">
              {[0,1,2,3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-colors ${
                    i < pin.length ? 'bg-amber-500 border-amber-500' : 'border-white/30'
                  }`}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) => (
                <button
                  key={k}
                  disabled={!k || loading}
                  className="h-16 rounded-2xl bg-white/10 text-white text-xl font-medium active:bg-white/20 disabled:opacity-0 transition-colors"
                  onClick={() => {
                    if (k === '⌫') { setPin((p) => p.slice(0, -1)); setError('') }
                    else handlePinDigit(k)
                  }}
                >
                  {k}
                </button>
              ))}
            </div>

            {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}

            {loading && (
              <p className="text-white/50 text-sm text-center mb-3">Processing withdrawal...</p>
            )}

            <button
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold py-4 rounded-xl disabled:opacity-40 transition-colors"
              disabled={pin.length < 4 || loading}
              onClick={handleWithdraw}
            >
              {loading ? 'Processing...' : `Withdraw ₦${amountNaira.toLocaleString()}`}
            </button>
          </div>
        )}

        {/* Step 4: Success */}
        {step === 4 && result && (
          <div className="text-center py-4">
            <div className="text-5xl mb-4">🎉</div>
            <h3 className="text-white font-semibold text-xl mb-2">{result.amount} sent</h3>
            <p className="text-white/60 mb-1">To {result.bank}</p>
            <p className="text-white/40 text-sm mb-6">Should arrive in a few minutes</p>
            <button
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold py-4 rounded-xl transition-colors"
              onClick={handleClose}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
