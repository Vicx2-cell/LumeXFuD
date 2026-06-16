'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { downloadReceiptPng } from '@/lib/receipt-download'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WalletData {
  balance_kobo:        number
  balance_formatted:   string
  lifetime_topup:      string
  lifetime_topup_kobo: number
  lifetime_spent:      string
  lifetime_spent_kobo: number
  is_frozen:           boolean
  frozen_reason:       string | null
}

interface TxRow {
  id:          string
  type:        string
  icon:        string
  sign:        string
  amount:      string
  amount_kobo: number
  description: string
  status:      string
  created_at:  string
  reference:     string | null
  balance_after: string
  receipt_code:  string
}

// ─── Top-up amount pills ──────────────────────────────────────────────────────

const TOPUP_PILLS = [
  { label: '₦500',    naira: 500   },
  { label: '₦1,000',  naira: 1000  },
  { label: '₦2,000',  naira: 2000  },
  { label: '₦5,000',  naira: 5000  },
  { label: '₦10,000', naira: 10000 },
]

function formatBalance(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0 })}`
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CustomerWalletClient() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [wallet,   setWallet]   = useState<WalletData | null>(null)
  const [txs,      setTxs]      = useState<TxRow[]>([])
  const [openReceipt, setOpenReceipt] = useState<string | null>(null)
  const [txPage,   setTxPage]   = useState(1)
  const [txTotal,  setTxTotal]  = useState(0)
  const [loading,  setLoading]  = useState(true)

  // Top-up flow state
  const [topupOpen,   setTopupOpen]   = useState(false)
  const [customAmt,   setCustomAmt]   = useState('')
  const [selectedAmt, setSelectedAmt] = useState<number | null>(null)
  const [topupLoading, setTopupLoading] = useState(false)
  const [topupError,   setTopupError]   = useState('')
  const [bonusPreview, setBonusPreview] = useState<{ bonus: number; total: number } | null>(null)

  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/customer-wallet/balance')
      if (res.status === 401) { router.push('/auth?next=/profile/wallet'); return }
      if (!res.ok) return
      setWallet(await res.json())
    } finally {
      setLoading(false)
    }
  }, [router])

  const loadTxs = useCallback(async (page: number) => {
    try {
      const res = await fetch(`/api/customer-wallet/transactions?page=${page}&limit=15`)
      if (!res.ok) return
      const d = await res.json() as { transactions: TxRow[]; pagination: { total: number } }
      setTxs(d.transactions)
      setTxTotal(d.pagination.total)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { loadWallet() }, [loadWallet])
  useEffect(() => { loadTxs(txPage) }, [loadTxs, txPage])

  // After returning from Paystack, the wallet is credited by an ASYNC webhook
  // that often hasn't finished by the time this page loads — so a single fetch
  // shows the old balance and the top-up + 1% bonus look like they "didn't work".
  // Poll the balance for a few seconds until it goes up, refreshing the tx list
  // too so the TOPUP and TOPUP_BONUS rows appear.
  useEffect(() => {
    if (searchParams.get('topup') !== 'success') return
    showToast('🎉 Top-up received! Crediting your wallet…')
    let cancelled = false
    let attempts = 0
    let baseline: number | null = null
    const poll = async () => {
      if (cancelled) return
      attempts++
      try {
        const res = await fetch('/api/customer-wallet/balance')
        if (res.ok) {
          const w = (await res.json()) as WalletData
          setWallet(w)
          void loadTxs(1)
          if (baseline === null) {
            baseline = w.balance_kobo
          } else if (w.balance_kobo > baseline) {
            showToast('🎉 Wallet topped up — 1% bonus added!')
            return
          }
        }
      } catch { /* transient — retry */ }
      if (attempts < 8) setTimeout(poll, 2500)
    }
    void poll()
    return () => { cancelled = true }
  }, [searchParams, loadTxs])

  // ── Bonus preview ─────────────────────────────────────────────────────────

  const updateBonusPreview = (naira: number) => {
    if (!naira || naira < 500) { setBonusPreview(null); return }
    // 1% bonus — mirrors server setting (wallet_topup_bonus_percent)
    const bonusKobo = Math.floor(naira * 100 * 1 / 100)
    setBonusPreview({ bonus: bonusKobo, total: naira * 100 + bonusKobo })
  }

  // ── Handle top-up ─────────────────────────────────────────────────────────

  async function handleTopup() {
    const amountNaira = selectedAmt ?? parseInt(customAmt, 10)
    if (!amountNaira || amountNaira < 500) {
      setTopupError('Minimum top-up is ₦500')
      return
    }
    if (amountNaira > 50_000) {
      setTopupError('Maximum top-up is ₦50,000')
      return
    }

    setTopupLoading(true); setTopupError('')

    try {
      const res = await fetch('/api/customer-wallet/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_naira: amountNaira }),
      })
      const d = await res.json() as { error?: string; authorization_url?: string }
      if (!res.ok) { setTopupError(d.error ?? 'Failed'); return }
      window.location.href = d.authorization_url!
    } catch {
      setTopupError('Network error. Try again.')
    } finally {
      setTopupLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const txColorClass = (sign: string) =>
    sign === '+' ? 'text-green-400' : sign === '-' ? 'text-red-400' : 'text-white/60'

  return (
    <main className="min-h-dvh pb-28" style={{ background: '#0A0A0B', color: '#fff' }}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-xl max-w-xs text-center"
          style={{ background: '#F5A623', color: '#000' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/8 px-4 py-3"
        style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => router.push('/profile')}
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="font-semibold text-lg">💰 LumeX Wallet</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* ── Balance Card ─────────────────────────────────────── */}
        {loading ? (
          <div className="h-44 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
        ) : (
          <div className="rounded-2xl p-6" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            {wallet?.is_frozen && (
              <div className="mb-4 rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <p className="text-sm font-medium text-red-400">🔒 Wallet frozen</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(239,68,68,0.7)' }}>{wallet.frozen_reason ?? 'Contact support'}</p>
              </div>
            )}
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Available Balance</p>
            <p className="text-5xl font-bold mb-5" style={{ color: '#F5A623' }}>
              {wallet?.balance_formatted ?? '₦0'}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => { setTopupOpen(true); setTopupError(''); setSelectedAmt(null); setCustomAmt(''); setBonusPreview(null) }}
                className="flex-1 py-3.5 rounded-xl font-semibold text-sm transition-colors"
                style={{ background: '#F5A623', color: '#000' }}
              >
                Load Money
              </button>
              <button
                onClick={() => { setTxPage(1); loadTxs(1) }}
                className="px-5 py-3.5 rounded-xl font-medium text-sm transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Refresh
              </button>
            </div>
          </div>
        )}

        {/* ── Why Use Wallet ───────────────────────────────────── */}
        <div className="rounded-2xl p-4 grid grid-cols-2 gap-2"
          style={{ background: 'rgba(245,166,35,0.05)', border: '1px solid rgba(245,166,35,0.12)' }}>
          {[
            ['⚡', 'Instant checkout — no card entry'],
            ['🎁', '1% bonus on every top-up'],
            ['🚀', 'Faster than Paystack popup'],
            ['☕', 'Perfect for daily orders'],
          ].map(([icon, text]) => (
            <div key={text} className="flex items-start gap-2">
              <span className="text-base shrink-0">{icon}</span>
              <p className="text-xs leading-snug" style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</p>
            </div>
          ))}
        </div>

        {/* ── Lifetime Stats ───────────────────────────────────── */}
        {!loading && wallet && (
          <div className="rounded-2xl p-4 grid grid-cols-2 gap-4"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div>
              <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Total Loaded</p>
              <p className="font-semibold">{wallet.lifetime_topup}</p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Total Spent</p>
              <p className="font-semibold">{wallet.lifetime_spent}</p>
            </div>
          </div>
        )}

        {/* ── Transaction History ──────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-4 py-3 border-b border-white/5">
            <h3 className="font-medium">Transaction History</h3>
          </div>

          {txs.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-4xl mb-3">💳</p>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No transactions yet</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>Load money to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {txs.map((tx) => (
                <div key={tx.id}>
                <button type="button" onClick={() => setOpenReceipt((c) => c === tx.id ? null : tx.id)} aria-expanded={openReceipt === tx.id}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-white/5">
                  <span className="text-xl w-8 text-center shrink-0">{tx.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{tx.description}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {new Date(tx.created_at).toLocaleDateString('en-NG', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <p className={`text-sm font-semibold shrink-0 ${txColorClass(tx.sign)}`}>
                    {tx.sign}{tx.amount}
                  </p>
                </button>
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
                            <button onClick={() => { try { void navigator.clipboard?.writeText(tx.reference!) } catch {} }} className="text-[11px]" style={{ color: '#F5A623' }}>Copy</button>
                          </div>
                          <p className="text-white/80 font-mono text-[11px] break-all mt-0.5">{tx.reference}</p>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 pt-2 border-t border-white/8 flex items-center gap-2">
                      <span className="text-green-400">🔒</span><span className="text-[11px] text-white/50">Verified</span>
                      <span className="ml-auto font-mono text-[11px] tracking-wider" style={{ color: '#F5A623' }}>{tx.receipt_code}</span>
                      <button onClick={() => { try { void navigator.clipboard?.writeText(tx.receipt_code) } catch {} }} className="text-[11px]" style={{ color: '#F5A623' }}>Copy</button>
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
                      className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium"
                      style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}
                    >
                      ⬇ Download receipt
                    </button>
                    {tx.reference && (
                      <button
                        type="button"
                        onClick={() => { try { void navigator.clipboard?.writeText(`${window.location.origin}/admin/verify-receipt?r=${encodeURIComponent(tx.reference!)}&c=${encodeURIComponent(tx.receipt_code)}`) } catch {} }}
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
          {txTotal > 15 && (
            <div className="flex justify-between items-center px-4 py-3 border-t border-white/5">
              <button
                disabled={txPage <= 1}
                onClick={() => setTxPage((p) => p - 1)}
                className="text-sm px-3 py-1.5 rounded-lg disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
              >
                ← Prev
              </button>
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {txPage} / {Math.ceil(txTotal / 15)}
              </span>
              <button
                disabled={txPage >= Math.ceil(txTotal / 15)}
                onClick={() => setTxPage((p) => p + 1)}
                className="text-sm px-3 py-1.5 rounded-lg disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Top-Up Sheet ──────────────────────────────────────────── */}
      {topupOpen && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setTopupOpen(false)}
          />
          <div className="relative w-full rounded-t-3xl p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: 'rgba(255,255,255,0.2)' }} />

            <h3 className="font-semibold text-xl mb-1">Load LumeX Wallet</h3>
            <p className="text-sm mb-5" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Pay with card or bank transfer via Paystack
            </p>

            {/* Amount pills */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {TOPUP_PILLS.map((pill) => (
                <button
                  key={pill.naira}
                  onClick={() => {
                    setSelectedAmt(pill.naira)
                    setCustomAmt('')
                    setTopupError('')
                    updateBonusPreview(pill.naira)
                  }}
                  className="py-3 rounded-xl text-sm font-medium transition-colors"
                  style={{
                    background:  selectedAmt === pill.naira ? '#F5A623' : 'rgba(255,255,255,0.07)',
                    color:       selectedAmt === pill.naira ? '#000' : 'rgba(255,255,255,0.8)',
                    border:      selectedAmt === pill.naira ? '1px solid #F5A623' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="relative mb-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>₦</span>
              <input
                type="number"
                min="500"
                max="50000"
                placeholder="Custom amount"
                value={customAmt}
                onChange={(e) => {
                  setCustomAmt(e.target.value)
                  setSelectedAmt(null)
                  const n = parseInt(e.target.value, 10)
                  updateBonusPreview(n)
                }}
                className="w-full pl-8 pr-4 py-3.5 rounded-xl text-sm outline-none"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                }}
              />
            </div>

            {/* Bonus preview */}
            {bonusPreview && bonusPreview.bonus > 0 && (
              <div className="mb-4 rounded-xl px-4 py-2.5 text-sm flex items-center justify-between"
                style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.15)' }}>
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>1% bonus 🎁</span>
                <span className="font-semibold" style={{ color: '#F5A623' }}>
                  +{formatBalance(bonusPreview.bonus)} → {formatBalance(bonusPreview.total)} total
                </span>
              </div>
            )}

            {topupError && (
              <p className="text-sm text-red-400 mb-3">{topupError}</p>
            )}

            <button
              onClick={handleTopup}
              disabled={topupLoading || (!selectedAmt && !customAmt)}
              className="w-full py-4 rounded-xl font-semibold text-base transition-opacity disabled:opacity-40 mt-1"
              style={{ background: '#F5A623', color: '#000' }}
            >
              {topupLoading ? 'Opening Paystack…' : 'Continue to Payment'}
            </button>

            <p className="text-xs text-center mt-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
              ⚡ Instant withdrawal — FREE · Secured by Paystack
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
