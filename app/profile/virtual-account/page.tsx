'use client'

import { useEffect, useState } from 'react'

type Account = {
  bank_name: string | null
  account_name: string | null
  account_number: string | null
  status: string
  failure_reason?: string | null
}

type Tier = {
  id: 'profile' | 'nin' | 'bvn'
  label: string
  desc: string
  identity_type?: 'nin' | 'bvn'
  placeholder?: string
}

const TIERS: Tier[] = [
  { id: 'bvn', label: 'BVN verification', desc: 'Fastest approval when your BVN is available.', identity_type: 'bvn', placeholder: '11-digit BVN' },
  { id: 'nin', label: 'NIN verification', desc: 'Use this if you do not have BVN ready.', identity_type: 'nin', placeholder: '11-digit NIN' },
  { id: 'profile', label: 'Try with my LumeX profile', desc: 'Uses your active LumeX account details only.' },
]

export default function VirtualAccountPage() {
  const [account, setAccount] = useState<Account | null>(null)
  const [tier, setTier] = useState<Tier>(TIERS[0])
  const [identityNumber, setIdentityNumber] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = () => fetch('/api/customer/virtual-account', { cache: 'no-store' })
    .then(async (res) => {
      const data = await res.json()
      if (res.ok) setAccount(data.virtual_account)
      else setMessage(data.error)
    })

  useEffect(() => { void load() }, [])

  async function create() {
    setBusy(true)
    setMessage('')
    const body = {
      consent,
      identity_type: tier.identity_type,
      identity_number: tier.identity_type ? identityNumber : undefined,
    }
    const res = await fetch('/api/customer/virtual-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setMessage(res.ok ? (res.status === 202 ? 'Paystack is assigning your LumeX Wallet account.' : 'LumeX Wallet account ready.') : data.error)
    if (res.ok) void load()
    setBusy(false)
  }

  const identityReady = !tier.identity_type || identityNumber.length === 11

  return (
    <main className="min-h-screen bg-[#090909] p-4 text-white">
      <div className="mx-auto max-w-xl py-10">
        <p className="text-xs uppercase tracking-wider text-amber-400">Payments</p>
        <h1 className="text-3xl font-semibold">LumeX Wallet</h1>
        <p className="mt-2 text-white/55">
          This is your Paystack bank-transfer account. Customers fund it by transfer, then use that balance at checkout.
        </p>

        {account?.status === 'ACTIVE' ? (
          <section className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
            <p className="text-sm text-white/50">{account.bank_name}</p>
            <p className="mt-2 text-3xl font-semibold tracking-wider">{account.account_number}</p>
            <p className="mt-2">{account.account_name}</p>
            <button
              onClick={async () => {
                setBusy(true)
                const res = await fetch('/api/customer/virtual-account', { method: 'PUT' })
                setMessage(res.ok ? 'Paystack is checking for confirmed transfers.' : 'Could not start recheck')
                setBusy(false)
              }}
              disabled={busy}
              className="mt-5 rounded-xl bg-white px-4 py-2 font-semibold text-black disabled:opacity-50"
            >
              Recheck transfer
            </button>
          </section>
        ) : (
          <section className="mt-6 space-y-4 rounded-2xl border border-white/10 p-5">
            <div className="grid gap-3">
              {TIERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => { setTier(option); setIdentityNumber(''); setMessage('') }}
                  className="rounded-xl border p-4 text-left"
                  style={{
                    borderColor: option.id === tier.id ? 'rgba(245,166,35,0.65)' : 'rgba(255,255,255,0.1)',
                    background: option.id === tier.id ? 'rgba(245,166,35,0.08)' : 'rgba(255,255,255,0.04)',
                  }}
                >
                  <p className="font-semibold">{option.label}</p>
                  <p className="mt-1 text-sm text-white/50">{option.desc}</p>
                </button>
              ))}
            </div>

            {tier.identity_type && (
              <label className="block text-sm">
                {tier.placeholder}
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={11}
                  className="mt-1 w-full rounded-xl bg-white/10 px-3 py-3 outline-none"
                  value={identityNumber}
                  onChange={(event) => setIdentityNumber(event.target.value.replace(/\D/g, ''))}
                />
              </label>
            )}

            <label className="flex items-start gap-2 text-sm text-white/70">
              <input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
              <span>I consent to LumeX sending the selected verification details to Paystack to create my LumeX Wallet account.</span>
            </label>

            <button
              type="button"
              onClick={create}
              disabled={!consent || !identityReady || busy}
              className="w-full rounded-xl bg-amber-400 px-4 py-3 font-semibold text-black disabled:opacity-50"
            >
              {busy ? 'Requesting...' : 'Create LumeX Wallet'}
            </button>
          </section>
        )}

        {message && <p className="mt-4 text-sm text-white/70">{message}</p>}
      </div>
    </main>
  )
}
