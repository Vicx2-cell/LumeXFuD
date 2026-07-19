'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { DefaultAvatar } from '@/components/default-avatar'
import WithdrawSheet from './WithdrawSheet'
import AddBankSheet from './AddBankSheet'
import { BackButton } from '@/components/back-button'
import { downloadReceiptPng } from '@/lib/receipt-download'
import { waLink, telLink } from '@/lib/contact'
import { formatPrice } from '@/lib/money'
import { CountUp } from '@/components/fx'

interface TxParty { name: string; phone: string | null; call_phone: string | null; avatar: string | null }

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
  bank_verified: boolean
  next_sweep_at: string | null
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
  reference: string | null
  balance_after: string
  receipt_code: string
  order_id: string | null
  vendor: TxParty | null
  rider: TxParty | null
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

// The full trust-tier ladder + what each means (shown in the "Trust Tiers" guide).
// Counts = completed orders (vendor) / completed deliveries (rider).
const TIER_CATALOG: Array<{ key: string; emoji: string; name: string; range: string; meaning: string }> = [
  { key: 'BRONZE',  emoji: '🥉', name: 'Bronze',  range: '0–49',  meaning: 'Getting started — earnings are held about 5 hours before you can withdraw.' },
  { key: 'SILVER',  emoji: '🥈', name: 'Silver',  range: '50+',   meaning: 'Established — holds cut in half (about 2½ hours), plus a trusted badge.' },
  { key: 'GOLD',    emoji: '🥇', name: 'Gold',    range: '200+',  meaning: 'Top performer — holds cut by 75% (about 1¼ hours) + priority support.' },
  { key: 'DIAMOND', emoji: '💎', name: 'Diamond', range: '500+ & 4.8★', meaning: 'Elite — the fastest tier, the minimum 1-hour hold.' },
]

// Friendly "unlocks in …" for the held-balance countdown.
function formatCountdown(ms: number): string {
  if (ms <= 0) return 'any moment now'
  const mins = Math.ceil(ms / 60_000)
  if (mins < 1) return 'under a minute'
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const remMin = mins % 60
  if (hrs < 24) return remMin ? `${hrs}h ${remMin}m` : `${hrs}h`
  const days = Math.floor(hrs / 24)
  const remHrs = hrs % 24
  return remHrs ? `${days}d ${remHrs}h` : `${days}d`
}

export default function WalletView({ userType }: Props) {
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [txs, setTxs] = useState<TxRow[]>([])
  const [openReceipt, setOpenReceipt] = useState<string | null>(null)
  const [tiersOpen, setTiersOpen] = useState(false)
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
  const [now, setNow] = useState(() => Date.now())

  // Tick the held-balance countdown once a minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const copyText = (t: string) => { try { void navigator.clipboard?.writeText(t) } catch { /* ignore */ } }

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
      <div className="p-4 space-y-3">
        {[1,2,3].map((i) => (
          <div key={i} className="lx-skeleton h-24 rounded-2xl" />
        ))}
      </div>
    )
  }

  const tier = wallet?.trust_tier ?? 'BRONZE'
  const tierColor = TIER_COLORS[tier] ?? 'text-white'
  const tierMax = TIER_MAX[tier] ?? 50
  const tierCount = wallet?.tier_progress.current_count ?? 0
  const tierPct = Math.min(100, Math.round((tierCount / tierMax) * 100))

  // Soonest upcoming hold release, for the "unlocks in …" countdown.
  const nextUnlockMs = txs
    .filter((t) => t.type === 'HOLD' && t.status === 'PENDING' && t.release_at)
    .map((t) => new Date(t.release_at as string).getTime())
    .filter((ts) => ts > now)
    .sort((a, b) => a - b)[0]
  const hasHeld = (wallet?.held_kobo ?? 0) > 0

  return (
    <div className="p-4 pb-24 space-y-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3">
        <BackButton />
        <h1 className="font-semibold text-base">Wallet</h1>
      </div>
      {/* ── Balance Card ─────────────────────────────────────── */}
      <div className="glass-thin rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-white font-semibold">LumeX Wallet</span>
          <button onClick={() => setTiersOpen(true)} className={`text-sm font-medium ${tierColor} flex items-center gap-1`}>
            {wallet?.tier_emoji} {tier}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </button>
        </div>

        <p className="text-white/50 text-xs mb-1">Total Balance</p>
        <p className="text-white text-4xl font-bold mb-4">
          <CountUp value={(wallet?.available_kobo ?? 0) + (wallet?.held_kobo ?? 0)} format={(n) => formatPrice(Math.round(n))} />
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-white/5 rounded-xl p-3">
            <p className="text-white/50 text-xs mb-1">Available</p>
            <p className="text-green-400 font-semibold">{wallet?.available_balance ?? '₦0'}</p>
            <p className="text-white/30 text-xs mt-1">Withdraw now</p>
          </div>
          {wallet?.next_sweep_at && (wallet?.available_kobo ?? 0) > 0 && (
            <div className="col-span-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <p className="lx-amber text-xs">
                🏦 Auto-payout to your bank {new Date(wallet.next_sweep_at).getTime() <= now
                  ? 'any moment now'
                  : `in ${formatCountdown(new Date(wallet.next_sweep_at).getTime() - now)}`}
              </p>
              <p className="text-white/40 text-xs mt-1">Earnings you don’t withdraw are sent to your registered account after 48 hours.</p>
            </div>
          )}
          <div className="bg-white/5 rounded-xl p-3">
            <p className="text-white/50 text-xs mb-1">Held</p>
            <p className="lx-amber font-semibold">{wallet?.held_balance ?? '₦0'}</p>
            <p className="text-white/30 text-xs mt-1">
              {hasHeld
                ? nextUnlockMs
                  ? `Unlocks in ${formatCountdown(nextUnlockMs - now)}`
                  : 'Unlocking…'
                : 'In hold period'}
            </p>
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
            className="lx-btn-amber flex-1 py-3 disabled:opacity-40"
            disabled={!wallet || (wallet.available_kobo ?? 0) === 0 || wallet.is_frozen}
            onClick={() => setWithdrawOpen(true)}
          >
            Withdraw
          </button>
          <button
            className="flex-1 border border-white/20 text-white font-medium py-3 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors"
            onClick={() => setTxPage(1)}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Trust Tier Progress ────────────────────────────── */}
      {wallet?.tier_progress.next_tier && (
        <div className="glass-thin rounded-2xl p-5">
          <h4 className="text-white font-medium mb-1">Your Tier: {wallet.tier_emoji} {tier}</h4>
          <p className="text-white/50 text-xs mb-3">Benefit: {wallet.tier_label}</p>
          <div className="h-2 bg-white/10 rounded-full mb-2">
            <div
              className="h-2 rounded-full transition-all"
              style={{ width: `${tierPct}%`, background: 'var(--color-amber)' }}
            />
          </div>
          <div className="flex justify-between items-center gap-2 text-xs text-white/40">
            <span className="shrink-0">{tier}</span>
            <span className="text-center min-w-0 truncate">{wallet.tier_progress.orders_to_next} more to {wallet.tier_progress.next_tier}</span>
            <span className="shrink-0">{wallet.tier_progress.next_tier}</span>
          </div>
          <button onClick={() => setTiersOpen(true)} className="lx-amber mt-3 text-xs font-medium">
            What do tiers mean? View all →
          </button>
        </div>
      )}

      {/* ── Trust Tiers guide ──────────────────────────────── */}
      {tiersOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setTiersOpen(false)}>
          <div className="w-full max-w-md rounded-2xl p-5 lx-enter max-h-[88dvh] overflow-y-auto" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-white">Trust Tiers</h3>
              <button onClick={() => setTiersOpen(false)} aria-label="Close" className="text-white/40 text-2xl leading-none w-11 h-11 -mr-2 -mt-2 flex items-center justify-center active:opacity-70">×</button>
            </div>
            <p className="text-xs text-white/45 mb-4">
              You’re {wallet?.tier_emoji} <b className="text-white">{tier}</b> with <b className="text-white">{tierCount}</b> completed order{tierCount === 1 ? '' : 's'}. Tiers reward your track record.
            </p>
            <div className="space-y-2">
              {TIER_CATALOG.map((t) => {
                const isCurrent = t.key === tier
                return (
                  <div key={t.key} className="rounded-xl p-3 flex items-start gap-3"
                    style={{ background: isCurrent ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isCurrent ? 'rgba(245,166,35,0.35)' : 'rgba(255,255,255,0.07)'}` }}>
                    <span className="text-2xl shrink-0" aria-hidden="true">{t.emoji}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white text-sm">{t.name}</p>
                        <span className="text-[11px] text-white/40">{t.range}</span>
                        {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#F5A623', color: '#000' }}>YOU</span>}
                      </div>
                      <p className="text-xs text-white/55 mt-0.5">{t.meaning}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-white/30 mt-4">Counts are your completed orders/deliveries. Every payout is held briefly before withdrawal; higher tiers release faster.</p>
          </div>
        </div>
      )}

      {/* ── Bank Account ───────────────────────────────────── */}
      <div className="glass-thin rounded-2xl p-5">
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
              <p className="lx-amber text-xs mt-2">
                🕐 Withdrawals available from{' '}
                {new Date(wallet.bank_ready_at).toLocaleDateString('en-NG', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
            <button
              className="mt-3 lx-amber text-sm"
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
        <div className="lx-card-amber-soft rounded-2xl p-5">
          <p className="lx-amber text-sm font-medium mb-2">🔑 Set a Wallet PIN</p>
          <p className="text-white/50 text-xs mb-3">Required to withdraw earnings</p>
          <button
            className="lx-btn-amber w-full py-3"
            onClick={() => { setSetPinOpen(true); setPinStep(1) }}
          >
            Set PIN
          </button>
        </div>
      )}

      {/* ── Lifetime Stats ─────────────────────────────────── */}
      <div className="glass-thin rounded-2xl p-5">
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
      <div className="glass-thin rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h4 className="text-white font-medium">Transactions</h4>
        </div>
        {txs.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-8">No transactions yet</p>
        ) : (
          <div className="divide-y divide-white/5">
            {txs.map((tx) => (
              <div key={tx.id}>
                <button
                  type="button"
                  onClick={() => setOpenReceipt((cur) => cur === tx.id ? null : tx.id)}
                  aria-expanded={openReceipt === tx.id}
                  className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors active:bg-white/5"
                >
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
                </button>

                {/* Tamper-evident receipt */}
                {openReceipt === tx.id && (
                  <div className="mx-4 mb-3 rounded-xl p-3 lx-enter" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <p className="text-xs uppercase tracking-wide text-white/40 mb-2 font-semibold">Receipt</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-white/50">Amount</span><span className="text-white tabular-nums">{tx.sign}{tx.amount}</span></div>
                      <div className="flex justify-between"><span className="text-white/50">Type</span><span className="text-white">{tx.type}</span></div>
                      <div className="flex justify-between"><span className="text-white/50">Status</span><span className="text-white">{tx.status}</span></div>
                      <div className="flex justify-between"><span className="text-white/50">Balance after</span><span className="text-white tabular-nums">{tx.balance_after}</span></div>
                      <div className="flex justify-between"><span className="text-white/50">Date</span><span className="text-white">{new Date(tx.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
                      {tx.reference && (
                        <div className="pt-1">
                          <div className="flex items-center justify-between"><span className="text-white/50">Reference</span>
                            <button onClick={() => copyText(tx.reference!)} className="lx-amber text-[11px]">Copy</button>
                          </div>
                          <p className="text-white/80 font-mono text-[11px] break-all mt-0.5">{tx.reference}</p>
                        </div>
                      )}
                    </div>

                    {/* People on this order — profile + contact, from the record */}
                    {(tx.vendor || tx.rider) && (
                      <div className="mt-2 pt-2 border-t border-white/8 space-y-2">
                        <p className="text-[11px] uppercase tracking-wide text-white/40">On this order</p>
                        {tx.vendor && <PartyRow role="Vendor" party={tx.vendor} orderNumber={tx.reference} />}
                        {tx.rider && <PartyRow role="Rider" party={tx.rider} orderNumber={tx.reference} />}
                      </div>
                    )}

                    <div className="mt-2 pt-2 border-t border-white/8 flex items-center gap-2">
                      <span className="text-green-400">🔒</span>
                      <span className="text-[11px] text-white/50">Verified</span>
                      <span className="lx-amber ml-auto font-mono text-[11px] tracking-wider">{tx.receipt_code}</span>
                      <button onClick={() => copyText(tx.receipt_code)} className="lx-amber text-[11px]">Copy</button>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadReceiptPng({
                        title: 'Payment Receipt',
                        party: 'LumeX Wallet',
                        amountLine: `${tx.sign}${tx.amount}`,
                        amountPositive: tx.sign === '+',
                        rows: [
                          ['Type', tx.type],
                          ['Status', tx.status],
                          ['Balance after', tx.balance_after],
                          ['Date', new Date(tx.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
                        ],
                        reference: tx.reference ?? '—',
                        code: tx.receipt_code,
                        refName: tx.reference ?? tx.id.slice(0, 8),
                      })}
                      className="lx-card-amber lx-amber mt-3 w-full py-2.5 rounded-xl text-sm font-medium"
                    >
                      ⬇ Download receipt
                    </button>
                    {tx.reference && (
                      <button
                        type="button"
                        onClick={() => copyText(`${window.location.origin}/admin/verify-receipt?r=${encodeURIComponent(tx.reference!)}&c=${encodeURIComponent(tx.receipt_code)}`)}
                        className="mt-2 w-full py-2.5 rounded-xl text-sm font-medium"
                        style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        🔗 Copy verify link (for support)
                      </button>
                    )}
                  </div>
                )}
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
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60 lx-scrim" onClick={() => setSetPinOpen(false)} />
          <div className="lx-sheet relative w-full sm:max-w-md bg-[#111] rounded-t-2xl sm:rounded-2xl sm:mb-4 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] max-h-[92dvh] overflow-y-auto">
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
                  className="lx-btn-amber w-full py-4 disabled:opacity-40"
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
                  className="lx-btn-amber w-full py-4 disabled:opacity-40"
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

// One person on an order (vendor or rider): avatar + name + one-tap contact. Shown
// in the transaction receipt so each party can see — and reach — who they worked
// with. WhatsApp/Call deep links only; no sensitive data beyond the contact number.
function PartyRow({ role, party, orderNumber }: { role: 'Vendor' | 'Rider'; party: TxParty; orderNumber: string | null }) {
  const initial = (party.name || role).charAt(0).toUpperCase()
  const msg = `Hi${party.name ? ' ' + party.name.split(' ')[0] : ''}, regarding LumeX order ${orderNumber ?? ''}`.trim()
  return (
    <div className="flex items-center gap-2.5">
      {party.avatar ? (
        <div className="relative w-8 h-8 rounded-full overflow-hidden shrink-0" style={{ border: '1px solid rgba(255,255,255,0.15)' }}>
          <Image src={party.avatar} alt="" fill className="object-cover" sizes="32px" />
        </div>
      ) : (
        <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden">
          <DefaultAvatar size={12} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs text-white/90 truncate">{party.name}</p>
        <p className="text-[10px] uppercase tracking-wide text-white/35">{role}</p>
      </div>
      {party.phone && (
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <a href={waLink(party.phone, msg)} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2 py-1 rounded-lg font-medium" style={{ background: 'rgba(37,211,102,0.14)', color: '#25D366' }}>WhatsApp</a>
          <a href={telLink(party.call_phone ?? party.phone)} className="text-[11px] px-2 py-1 rounded-lg font-medium" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)' }}>Call</a>
        </div>
      )}
    </div>
  )
}
