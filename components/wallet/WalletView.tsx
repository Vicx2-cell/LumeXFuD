'use client'

import { useState, useEffect, useCallback } from 'react'
import WithdrawSheet from './WithdrawSheet'
import AddBankSheet from './AddBankSheet'

interface TierProgress {
  current_count: number
  next_tier: string | null
  orders_to_next: number | null
}

interface WalletData {
  total_balance: string
  available_balance: string
  held_balance: string
  available_kobo: number
  held_kobo: number
  trust_tier: string
  tier_emoji: string
  tier_label: string
  tier_progress: TierProgress
  wallet_pin_set: boolean
  bank_connected: boolean
  bank_name: string | null
  bank_last_4: string | null
  bank_account_name: string | null
  bank_ready: boolean
  bank_ready_at: string | null
  is_frozen: boolean
  frozen_reason: string | null
  lifetime_earned: string
  total_withdrawn: string
}

interface TxRow {
  id: string
  type: string
  icon: string
  sign: string
  amount: string
  label: string
  status: string
  release_at: string | null
  created_at: string
}

interface Props {
  userType: 'VENDOR' | 'RIDER'
}

const TIER_COLORS: Record<string, string> = {
  BRONZE: 'text-amber-600',
  SILVER: 'text-gray-300',
  GOLD:   'text-yellow-400',
  DIAMOND: 'text-cyan-300',
}

const TIER_MAX: Record<string, number> = {
  BRONZE: 50, SILVER: 200, GOLD: 500, DIAMOND: 1,
}

export default function WalletView({ userType }: Props) {
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [txs, setTxs] = useState<TxRow[]>([])
  const [txPage, setTxPage] = useState(1)
  const [txTotal, setTxTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [addBankOpen, setAddBankOpen] = useState(false)
  const [setPinOpen, setSetPinOpen] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinError, setPinError] = useState('')
  const [pinStep, setPinStep] = useState(1)

  const loadWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet/balance')
      if (!res.ok) return
      setWallet(await res.json())
    } catch {
      // Non-fatal
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTxs = useCallback(async (page: number) => {
    try {
      const res = await fetch(`/api/wallet/transactions?page=${page}&limit=10`)
      if (!res.ok) return
      const d = await res.json()
      setTxs(d.transactions)
      setTxTotal(d.pagination.total)
    } catch {
      // Non-fatal
    }
  }, [])

  useEffect(() => { loadWallet() }, [loadWallet])
  useEffect(() => { loadTxs(txPage) }, [loadTxs, txPage])

  async function savePin() {
    if (newPin !== confirmPin) { setPinError('PINs do not match'); return }
    setPinSaving(true); setPinError('')
    try {
      const res = await fetch('/api/wallet/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: newPin, confirm_pin: confirmPin }),
      })
      const d = await res.json()
      if (!res.ok) { setPinError(d.error ?? 'Failed'); return }
      setSetPinOpen(false); setNewPin(''); setConfirmPin(''); setPinStep(1)
      loadWallet()
    } catch {
      setPinError('Network error')
    } finally {
      setPinSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-3 animate-pulse">
        {[1,2,3].map((i) => (
          <div key={i} className="h-24 bg-white/5 rounded-2xl" />
        ))}
      </div>
    )
  }

  const tier = wallet?.trust_tier ?? 'BRONZE'
  const tierColor = TIER_COLORS[tier] ?? 'text-white'
  const tierMax = TIER_MAX[tier] ?? 50
  const tierCount = wallet?.tier_progress.current_count ?? 0
  const tierPct = Math.min(100, Math.round((tierCount / tierMax) * 100))

  return (
    <div className="p-4 pb-24 space-y-4 max-w-lg mx-auto">
      {/* ── Balance Card ─────────────────────────────────────── */}
      <div className="bg-white/5 backdrop-blur rounded-2xl p-5 border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-white font-semibold">LumeX Wallet</span>
          <span className={`text-sm font-medium ${tierColor}`}>
            {wallet?.tier_emoji} {tier}
          </span>
        </div>

        <p className="text-white/50 text-xs mb-1">Total Balance</p>
        <p className="text-white text-4xl font-bold mb-4">{wallet?.total_balance ?? '₦0'}</p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white/5 rounded-xl p-3">
            <p className="text-white/50 text-xs mb-1">Available</p>
            <p className="text-green-400 font-semibold">{wallet?.available_balance ?? '₦0'}</p>
            <p className="text-white/30 text-xs mt-1">Withdraw now</p>
          </div>
          <div className="bg-white/5 rounded-xl p-3">
            <p className="text-white/50 text-xs mb-1">Held</p>
            <p className="text-amber-400 font-semibold">{wallet?.held_balance ?? '₦0'}</p>
            <p className="text-white/30 text-xs mt-1">In hold period</p>
          </div>
        </div>

        {wallet?.is_frozen && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4">
            <p className="text-red-400 text-sm font-medium">🔒 Wallet frozen</p>
            <p className="text-red-400/70 text-xs mt-1">{wallet.frozen_reason ?? 'Contact support'}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold py-3 rounded-xl transition-colors disabled:opacity-40"
            disabled={!wallet || (wallet.available_kobo ?? 0) === 0 || wallet.is_frozen}
            onClick={() => setWithdrawOpen(true)}
          >
            Withdraw
          </button>
          <button
            className="flex-1 border border-white/20 text-white font-medium py-3 rounded-xl hover:bg-white/5 transition-colors"
            onClick={() => setTxPage(1)}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Trust Tier Progress ────────────────────────────── */}
      {wallet?.tier_progress.next_tier && (
        <div className="bg-white/5 backdrop-blur rounded-2xl p-5 border border-white/10">
          <h4 className="text-white font-medium mb-1">Your Tier: {wallet.tier_emoji} {tier}</h4>
          <p className="text-white/50 text-xs mb-3">Benefit: {wallet.tier_label}</p>
          <div className="h-2 bg-white/10 rounded-full mb-2">
            <div
              className="h-2 bg-amber-500 rounded-full transition-all"
              style={{ width: `${tierPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/40">
            <span>{tier}</span>
            <span>{wallet.tier_progress.orders_to_next} more orders to {wallet.tier_progress.next_tier}</span>
            <span>{wallet.tier_progress.next_tier}</span>
          </div>
        </div>
      )}

      {/* ── Bank Account ───────────────────────────────────── */}
      <div className="bg-white/5 backdrop-blur rounded-2xl p-5 border border-white/10">
        <h4 className="text-white/70 text-xs font-medium uppercase tracking-wide mb-3">
          Withdrawal Account
        </h4>
        {wallet?.bank_connected ? (
          <div>
            <p className="text-white font-medium">{wallet.bank_name}</p>
            <p className="text-white/60 text-sm">
              ****{wallet.bank_last_4} — {wallet.bank_account_name}
            </p>
            {!wallet.bank_ready && wallet.bank_ready_at && (
              <p className="text-amber-400 text-xs mt-2">
                🕐 Withdrawals available from{' '}
                {new Date(wallet.bank_ready_at).toLocaleDateString('en-NG', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
            <button
              className="mt-3 text-amber-400 text-sm"
              onClick={() => setAddBankOpen(true)}
            >
              Change Bank
            </button>
          </div>
        ) : (
          <div>
            <p className="text-white/50 text-sm mb-3">⚠️ No withdrawal account added</p>
            <button
              className="w-full border border-amber-500/50 text-amber-400 font-medium py-3 rounded-xl hover:bg-amber-500/10 transition-colors"
              onClick={() => setAddBankOpen(true)}
            >
              Add Bank Account
            </button>
          </div>
        )}
      </div>

      {/* ── Wallet PIN ─────────────────────────────────────── */}
      {!wallet?.wallet_pin_set && (
        <div className="bg-white/5 backdrop-blur rounded-2xl p-5 border border-amber-500/20">
          <p className="text-amber-400 text-sm font-medium mb-2">🔑 Set a Wallet PIN</p>
          <p className="text-white/50 text-xs mb-3">Required to withdraw earnings</p>
          <button
            className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold py-3 rounded-xl transition-colors"
            onClick={() => { setSetPinOpen(true); setPinStep(1) }}
          >
            Set PIN
          </button>
        </div>
      )}

      {/* ── Lifetime Stats ─────────────────────────────────── */}
      <div className="bg-white/5 backdrop-blur rounded-2xl p-5 border border-white/10">
        <h4 className="text-white/70 text-xs font-medium uppercase tracking-wide mb-3">
          Lifetime Stats
        </h4>
        <div className="flex justify-between">
          <div>
            <p className="text-white/50 text-xs">Total Earned</p>
            <p className="text-white font-semibold">{wallet?.lifetime_earned ?? '₦0'}</p>
          </div>
          <div className="text-right">
            <p className="text-white/50 text-xs">Total Withdrawn</p>
            <p className="text-white font-semibold">{wallet?.total_withdrawn ?? '₦0'}</p>
          </div>
        </div>
      </div>

      {/* ── Recent Transactions ────────────────────────────── */}
      <div className="bg-white/5 backdrop-blur rounded-2xl border border-white/10 overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h4 className="text-white font-medium">Transactions</h4>
        </div>
        {txs.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-8">No transactions yet</p>
        ) : (
          <div className="divide-y divide-white/5">
            {txs.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg flex-shrink-0">{tx.icon}</span>
                  <div className="min-w-0">
                    <p className="text-white text-sm truncate">{tx.label}</p>
                    <p className="text-white/40 text-xs">
                      {new Date(tx.created_at).toLocaleDateString('en-NG', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                <p className={`text-sm font-medium flex-shrink-0 ml-3 ${
                  tx.sign === '+' ? 'text-green-400' : tx.sign === '-' ? 'text-red-400' : 'text-white/60'
                }`}>
                  {tx.sign}{tx.amount}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {txTotal > 10 && (
          <div className="flex justify-between items-center p-3 border-t border-white/10">
            <button
              className="text-white/50 text-sm disabled:opacity-30"
              disabled={txPage <= 1}
              onClick={() => setTxPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span className="text-white/40 text-xs">
              Page {txPage} of {Math.ceil(txTotal / 10)}
            </span>
            <button
              className="text-white/50 text-sm disabled:opacity-30"
              disabled={txPage >= Math.ceil(txTotal / 10)}
              onClick={() => setTxPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Set PIN sheet ──────────────────────────────────── */}
      {setPinOpen && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSetPinOpen(false)} />
          <div className="relative w-full bg-[#111] rounded-t-2xl p-6">
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />
            {pinStep === 1 && (
              <div>
                <h3 className="text-white font-semibold text-lg mb-4">Set your wallet PIN</h3>
                <div className="flex justify-center gap-4 mb-6">
                  {[0,1,2,3].map((i) => (
                    <div key={i} className={`w-4 h-4 rounded-full border-2 ${i < newPin.length ? 'bg-amber-500 border-amber-500' : 'border-white/30'}`} />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) => (
                    <button
                      key={k}
                      disabled={!k || (k !== '⌫' && newPin.length >= 4)}
                      className="h-16 rounded-2xl bg-white/10 text-white text-xl font-medium active:bg-white/20 disabled:opacity-0"
                      onClick={() => {
                        if (k === '⌫') setNewPin((p) => p.slice(0, -1))
                        else if (newPin.length < 4) setNewPin((p) => p + k)
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <button
                  className="w-full bg-amber-500 text-black font-semibold py-4 rounded-xl disabled:opacity-40"
                  disabled={newPin.length < 4}
                  onClick={() => { setPinStep(2); setConfirmPin('') }}
                >
                  Continue
                </button>
              </div>
            )}
            {pinStep === 2 && (
              <div>
                <h3 className="text-white font-semibold text-lg mb-4">Confirm your PIN</h3>
                <div className="flex justify-center gap-4 mb-6">
                  {[0,1,2,3].map((i) => (
                    <div key={i} className={`w-4 h-4 rounded-full border-2 ${i < confirmPin.length ? 'bg-amber-500 border-amber-500' : 'border-white/30'}`} />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) => (
                    <button
                      key={k}
                      disabled={!k || (k !== '⌫' && confirmPin.length >= 4)}
                      className="h-16 rounded-2xl bg-white/10 text-white text-xl font-medium active:bg-white/20 disabled:opacity-0"
                      onClick={() => {
                        if (k === '⌫') setConfirmPin((p) => p.slice(0, -1))
                        else if (confirmPin.length < 4) setConfirmPin((p) => p + k)
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                {pinError && <p className="text-red-400 text-sm text-center mb-3">{pinError}</p>}
                <button
                  className="w-full bg-amber-500 text-black font-semibold py-4 rounded-xl disabled:opacity-40"
                  disabled={confirmPin.length < 4 || pinSaving}
                  onClick={savePin}
                >
                  {pinSaving ? 'Saving...' : 'Set PIN'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Withdraw Sheet ─────────────────────────────────── */}
      <WithdrawSheet
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onSuccess={() => { loadWallet(); loadTxs(1) }}
        availableKobo={wallet?.available_kobo ?? 0}
        bankName={wallet?.bank_name ?? null}
        bankLast4={wallet?.bank_last_4 ?? null}
        pinSet={wallet?.wallet_pin_set ?? false}
        bankConnected={wallet?.bank_connected ?? false}
        bankReady={wallet?.bank_ready ?? false}
        bankReadyAt={wallet?.bank_ready_at ?? null}
      />

      {/* ── Add Bank Sheet ─────────────────────────────────── */}
      <AddBankSheet
        open={addBankOpen}
        onClose={() => setAddBankOpen(false)}
        onSuccess={() => loadWallet()}
      />
    </div>
  )
}
