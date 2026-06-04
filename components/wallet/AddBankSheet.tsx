'use client'

import { useState, useEffect, useCallback } from 'react'

interface Bank { name: string; code: string }

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AddBankSheet({ open, onClose, onSuccess }: Props) {
  const [step, setStep] = useState(1)
  const [banks, setBanks] = useState<Bank[]>([])
  const [bankSearch, setBankSearch] = useState('')
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null)
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Avoid synchronous setState in effect to prevent cascading renders
    let t: number | undefined
    if (!open) {
      t = window.setTimeout(() => {
        setStep(1)
        setBankSearch('')
        setSelectedBank(null)
        setAccountNumber('')
        setAccountName('')
        setPin('')
        setError('')
      }, 0)
    }
    return () => { if (t) clearTimeout(t) }
  }, [open])

  useEffect(() => {
    if (open && banks.length === 0) {
      fetch('/api/wallet/banks')
        .then((r) => r.json())
        .then((d) => { if (d.banks) setBanks(d.banks) })
        .catch(() => {})
    }
  }, [open, banks.length])

  const verifyAccount = useCallback(async (num: string, bank: Bank) => {
    if (num.length !== 10) return
    setVerifying(true); setAccountName(''); setError('')
    try {
      const res = await fetch('/api/wallet/verify-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number: num, bank_code: bank.code }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Account not found'); return }
      setAccountName(d.account_name)
    } catch {
      setError('Could not verify account. Check your connection.')
    } finally {
      setVerifying(false)
    }
  }, [])

  async function handleSave() {
    if (!selectedBank || !accountName || pin.length !== 4) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/wallet/save-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_number: accountNumber,
          bank_code: selectedBank.code,
          bank_name: selectedBank.name,
          account_name: accountName,
          wallet_pin: pin,
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Failed to save bank'); return }
      setStep(4)
    } catch {
      setError('Failed to save. Check your connection.')
    } finally {
      setSaving(false)
    }
  }

  const filteredBanks = banks.filter((b) =>
    b.name.toLowerCase().includes(bankSearch.toLowerCase())
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full bg-[#111] rounded-t-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />

        {/* Step 1: Select bank */}
        {step === 1 && (
          <div>
            <h3 className="text-white font-semibold text-lg mb-4">Select your bank</h3>
            <input
              className="w-full bg-white/10 text-white placeholder-white/40 rounded-xl px-4 py-3 mb-3 outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="Search banks..."
              value={bankSearch}
              onChange={(e) => setBankSearch(e.target.value)}
              autoFocus
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filteredBanks.length === 0 && (
                <p className="text-white/50 text-sm text-center py-4">
                  {banks.length === 0 ? 'Loading banks...' : 'No banks found'}
                </p>
              )}
              {filteredBanks.map((b, i) => (
                <button
                  key={`${b.code}-${i}`}
                  className="w-full text-left px-4 py-3 rounded-xl text-white hover:bg-white/10 transition-colors"
                  onClick={() => { setSelectedBank(b); setStep(2) }}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Enter account number */}
        {step === 2 && (
          <div>
            <button className="text-amber-400 text-sm mb-4" onClick={() => setStep(1)}>
              ← {selectedBank?.name}
            </button>
            <h3 className="text-white font-semibold text-lg mb-4">Enter account number</h3>
            <input
              className="w-full bg-white/10 text-white placeholder-white/40 rounded-xl px-4 py-3 text-center text-xl tracking-widest outline-none focus:ring-1 focus:ring-amber-500"
              placeholder="0000000000"
              value={accountNumber}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 10)
                setAccountNumber(v)
                if (v.length < 10) { setAccountName(''); setError('') }
                if (v.length === 10 && selectedBank) { verifyAccount(v, selectedBank) }
              }}
              inputMode="numeric"
              autoFocus
            />
            {verifying && (
              <p className="text-white/50 text-sm text-center mt-2">Verifying account...</p>
            )}
            {accountName && !verifying && (
              <div className="mt-3 bg-green-500/10 border border-green-500/30 rounded-xl p-3">
                <p className="text-white/60 text-xs">Account name</p>
                <p className="text-white font-semibold">{accountName}</p>
                <p className="text-white/50 text-xs mt-1">Is this your name?</p>
              </div>
            )}
            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
            {accountName && !verifying && (
              <button
                className="w-full mt-4 bg-amber-500 hover:bg-amber-400 text-black font-semibold py-4 rounded-xl transition-colors"
                onClick={() => setStep(3)}
              >
                Yes, continue
              </button>
            )}
          </div>
        )}

        {/* Step 3: Enter wallet PIN */}
        {step === 3 && (
          <div>
            <h3 className="text-white font-semibold text-lg mb-2">Confirm with wallet PIN</h3>
            <p className="text-white/50 text-sm mb-6">
              Saving {selectedBank?.name} ****{accountNumber.slice(-4)}
            </p>

            {/* PIN display circles */}
            <div className="flex justify-center gap-4 mb-6">
              {[0,1,2,3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 ${
                    i < pin.length ? 'bg-amber-500 border-amber-500' : 'border-white/30'
                  }`}
                />
              ))}
            </div>

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) => (
                <button
                  key={k}
                  disabled={!k || (k !== '⌫' && pin.length >= 4)}
                  className="h-16 rounded-2xl bg-white/10 text-white text-xl font-medium active:bg-white/20 disabled:opacity-0 transition-colors"
                  onClick={() => {
                    if (k === '⌫') { setPin((p) => p.slice(0, -1)); setError('') }
                    else if (pin.length < 4) setPin((p) => p + k)
                  }}
                >
                  {k}
                </button>
              ))}
            </div>

            {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}

            <button
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold py-4 rounded-xl disabled:opacity-50 transition-colors"
              disabled={pin.length < 4 || saving}
              onClick={handleSave}
            >
              {saving ? 'Saving...' : 'Save Bank Account'}
            </button>
          </div>
        )}

        {/* Step 4: Success */}
        {step === 4 && (
          <div className="text-center py-4">
            <div className="text-5xl mb-4">✅</div>
            <h3 className="text-white font-semibold text-xl mb-2">Bank saved!</h3>
            <p className="text-white/60 mb-1">{selectedBank?.name} ****{accountNumber.slice(-4)}</p>
            <p className="text-white/50 text-sm mb-6">
              First withdrawal available in 24 hours.<br />
              You&apos;ll get a WhatsApp confirmation.
            </p>
            <button
              className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold py-4 rounded-xl transition-colors"
              onClick={() => { onSuccess(); onClose() }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
