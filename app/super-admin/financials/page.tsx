'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Financials {
  gmv_kobo:                       number
  platform_revenue_kobo:          number
  subscription_revenue_kobo:      number
  total_revenue_kobo:             number
  take_rate_pct:                  number
  orders_this_month:              number
  orders_today:                   number
  vendor_wallet_kobo:             number
  rider_wallet_kobo:              number
  total_held_kobo:                number
  customer_float_kobo:            number
  lifetime_topup_kobo:            number
  customer_wallet_count:          number
  float_annual_potential_kobo:    number
  topup_today_kobo:               number
  bonus_issued_today_kobo:        number
  net_float_gain_today_kobo:      number
  rider_bonus_paid_today_kobo:    number
  platform_revenue_today_kobo:    number
  net_platform_profit_today_kobo: number
}

interface EarningsBreakdown {
  FOOD_MARKUP?:         number
  DELIVERY_CUT?:        number
  VENDOR_SUBSCRIPTION?: number
  WALLET_TOPUP_FLOAT?:  number
  RIDER_BONUS_COST?:    number
  TOPUP_BONUS_COST?:    number
  REFUND_COST?:         number
}

interface EarningsPeriod {
  gross:     number
  net:       number
  breakdown: EarningsBreakdown
}

interface EarningsSummary {
  today:                       EarningsPeriod
  week:                        EarningsPeriod
  month:                       EarningsPeriod
  paystack_balance_kobo:       number
  vendor_wallet_total_kobo:    number
  rider_wallet_total_kobo:     number
  customer_wallet_total_kobo:  number
  founder_actual_money_kobo:   number
}

interface EarningsRecord {
  id:          string
  type:        string
  amount_kobo: number
  description: string | null
  order_id:    string | null
  created_at:  string
}

// ─── Shared UI atoms ─────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, highlight, warn, accent,
}: {
  label: string; value: string; sub?: string
  highlight?: boolean; warn?: boolean; accent?: string
}) {
  const color = accent ?? (highlight ? '#F5A623' : warn ? '#EF4444' : '#fff')
  return (
    <div className="rounded-2xl p-4" style={{
      background: highlight ? 'rgba(245,166,35,0.07)' : warn ? 'rgba(239,68,68,0.07)' : '#111113',
      border: `1px solid ${highlight ? 'rgba(245,166,35,0.2)' : warn ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.07)'}`,
    }}>
      <p className="text-xs text-white/40 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-white/40 mt-1">{sub}</p>}
    </div>
  )
}

function Section({ title }: { title: string }) {
  return <p className="text-xs text-white/30 uppercase tracking-widest mb-3 mt-6">{title}</p>
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
      ))}
    </div>
  )
}

// ─── Type label helpers ───────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  FOOD_MARKUP:          'Food markup',
  DELIVERY_CUT:         'Delivery cut',
  VENDOR_SUBSCRIPTION:  'Vendor subscription',
  WALLET_TOPUP_FLOAT:   'Wallet float',
  RIDER_BONUS_COST:     'Rider bonus',
  TOPUP_BONUS_COST:     'Top-up bonus',
  REFUND_COST:          'Refund',
}

const TYPE_ICON: Record<string, string> = {
  FOOD_MARKUP:          '🍔',
  DELIVERY_CUT:         '🛵',
  VENDOR_SUBSCRIPTION:  '🏪',
  WALLET_TOPUP_FLOAT:   '💳',
  RIDER_BONUS_COST:     '🏆',
  TOPUP_BONUS_COST:     '🎁',
  REFUND_COST:          '↩️',
}

// ─── Withdraw modal ───────────────────────────────────────────────────────────

function WithdrawModal({
  available,
  onClose,
}: {
  available: number
  onClose: () => void
}) {
  const [amount,   setAmount]   = useState('')
  const [note,     setNote]     = useState('')
  const [loading,  setLoading]  = useState(false)
  const [warning,  setWarning]  = useState<string | null>(null)
  const [warningData, setWarningData] = useState<{
    min_safe_balance_kobo: number
    remaining_after_kobo: number
  } | null>(null)
  const [success,  setSuccess]  = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  const amountKobo = Math.round(parseFloat(amount || '0') * 100)

  async function submit(confirmed = false) {
    if (amountKobo < 50_000) { setError('Minimum withdrawal is ₦500'); return }
    if (amountKobo > available) { setError('Amount exceeds your available money'); return }
    setLoading(true); setError(null); setWarning(null)

    try {
      const res = await fetch('/api/super-admin/withdraw', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_kobo: amountKobo, note: note || undefined, confirmed }),
      })
      const json = await res.json() as {
        warning?: boolean; message?: string
        success?: boolean; transfer_code?: string; error?: string
        min_safe_balance_kobo?: number; remaining_after_kobo?: number
      }

      if (res.status === 422 && json.warning) {
        setWarning(json.message ?? 'Safety warning triggered.')
        setWarningData({
          min_safe_balance_kobo: json.min_safe_balance_kobo ?? 0,
          remaining_after_kobo:  json.remaining_after_kobo  ?? 0,
        })
      } else if (json.success) {
        setSuccess(`Transfer initiated! Code: ${json.transfer_code ?? '—'}. Funds arrive within minutes.`)
      } else {
        setError(json.error ?? 'Withdrawal failed')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-3xl p-6" style={{ background: '#111113', border: '1px solid rgba(245,166,35,0.25)' }}>

        {success ? (
          <>
            <p className="text-2xl font-bold text-white mb-2">✅ Done!</p>
            <p className="text-sm text-white/60 mb-6">{success}</p>
            <button onClick={onClose}
              className="w-full py-3 rounded-2xl font-bold text-black"
              style={{ background: '#F5A623' }}>
              Close
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <p className="text-lg font-bold text-white">Withdraw Your Earnings</p>
              <button onClick={onClose} className="text-white/40 text-xl leading-none">✕</button>
            </div>

            <div className="rounded-2xl p-3 mb-5" style={{ background: 'rgba(245,166,35,0.07)', border: '1px solid rgba(245,166,35,0.15)' }}>
              <p className="text-xs text-white/40 mb-1">Available to withdraw</p>
              <p className="text-2xl font-bold" style={{ color: '#F5A623' }}>{formatPrice(available)}</p>
              <p className="text-xs text-white/30 mt-1">Paystack balance minus all vendor / rider / customer floats</p>
            </div>

            <label className="block mb-4">
              <span className="text-xs text-white/40 uppercase tracking-wide mb-1 block">Amount (₦)</span>
              <input
                type="number"
                min="500"
                placeholder="0.00"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(null); setWarning(null) }}
                className="w-full rounded-xl px-4 py-3 text-white text-lg font-semibold outline-none"
                style={{ background: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </label>

            <label className="block mb-5">
              <span className="text-xs text-white/40 uppercase tracking-wide mb-1 block">Note (optional)</span>
              <input
                type="text"
                placeholder="e.g. Weekly payout"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-white outline-none"
                style={{ background: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            </label>

            <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs text-white/40">
                ⚠️ Keep at least ₦2,000 in Paystack to cover vendor/rider withdrawals. This transfers to your personal bank account on file.
              </p>
            </div>

            {error && (
              <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {warning && warningData && (
              <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.25)' }}>
                <p className="text-sm text-amber-300 mb-3">{warning}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setWarning(null); setWarningData(null) }}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold text-white/60"
                    style={{ background: 'rgba(255,255,255,0.06)' }}>
                    Cancel
                  </button>
                  <button
                    onClick={() => submit(true)}
                    disabled={loading}
                    className="flex-1 py-2 rounded-xl text-sm font-bold text-black"
                    style={{ background: '#F5A623', opacity: loading ? 0.6 : 1 }}>
                    Proceed anyway
                  </button>
                </div>
              </div>
            )}

            {!warning && (
              <div className="flex gap-3">
                <button onClick={onClose}
                  className="flex-1 py-3 rounded-2xl font-semibold text-white/60"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  Cancel
                </button>
                <button
                  onClick={() => submit(false)}
                  disabled={loading || amountKobo <= 0}
                  className="flex-1 py-3 rounded-2xl font-bold text-black"
                  style={{ background: '#F5A623', opacity: (loading || amountKobo <= 0) ? 0.5 : 1 }}>
                  {loading ? 'Processing…' : 'Withdraw'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Founder Earnings section ─────────────────────────────────────────────────

function FounderEarnings() {
  const [earnings,     setEarnings]     = useState<EarningsSummary | null>(null)
  const [loadingE,     setLoadingE]     = useState(true)
  const [showWithdraw, setShowWithdraw] = useState(false)

  useEffect(() => {
    fetch('/api/super-admin/earnings')
      .then((r) => r.json())
      .then((d: EarningsSummary) => setEarnings(d))
      .catch(() => {})
      .finally(() => setLoadingE(false))
  }, [])

  if (loadingE) {
    return (
      <div className="rounded-3xl p-6 mb-6 animate-pulse" style={{ background: '#111113', border: '1px solid rgba(245,166,35,0.15)', minHeight: 220 }} />
    )
  }

  if (!earnings) {
    return (
      <div className="rounded-3xl p-5 mb-6" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-white/30 text-sm">Failed to load earnings — check API.</p>
      </div>
    )
  }

  const { today, week, month, paystack_balance_kobo, vendor_wallet_total_kobo, rider_wallet_total_kobo, customer_wallet_total_kobo, founder_actual_money_kobo } = earnings
  const bd = today.breakdown

  const breakdownItems: Array<{ label: string; icon: string; amount: number }> = [
    { label: 'Food markup',          icon: '🍔', amount: bd.FOOD_MARKUP         ?? 0 },
    { label: 'Delivery cuts',        icon: '🛵', amount: bd.DELIVERY_CUT        ?? 0 },
    { label: 'Vendor subscriptions', icon: '🏪', amount: bd.VENDOR_SUBSCRIPTION ?? 0 },
    { label: 'Rider bonuses paid',   icon: '🏆', amount: bd.RIDER_BONUS_COST    ?? 0 },
    { label: 'Top-up bonuses issued',icon: '🎁', amount: bd.TOPUP_BONUS_COST    ?? 0 },
    { label: 'Refunds issued',       icon: '↩️', amount: bd.REFUND_COST         ?? 0 },
  ].filter((item) => item.amount !== 0)

  return (
    <>
      <div className="rounded-3xl p-5 mb-6" style={{
        background: 'linear-gradient(135deg, rgba(245,166,35,0.08) 0%, rgba(245,166,35,0.03) 100%)',
        border: '1px solid rgba(245,166,35,0.25)',
      }}>
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-amber-400 uppercase tracking-widest">💰 Your Earnings</p>
          <button
            onClick={() => setShowWithdraw(true)}
            className="px-4 py-1.5 rounded-full text-xs font-bold text-black"
            style={{ background: '#F5A623' }}>
            Withdraw →
          </button>
        </div>

        {/* Today / Week / Month */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Today',      net: today.net },
            { label: 'This Week',  net: week.net  },
            { label: 'This Month', net: month.net },
          ].map(({ label, net }) => (
            <div key={label} className="rounded-2xl p-3 text-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
              <p className="text-xs text-white/40 mb-1">{label}</p>
              <p className={`text-lg font-bold ${net >= 0 ? 'text-white' : 'text-red-400'}`}>
                {formatPrice(Math.abs(net))}
              </p>
              {net < 0 && <p className="text-xs text-red-400">loss</p>}
            </div>
          ))}
        </div>

        {/* Today breakdown */}
        {breakdownItems.length > 0 && (
          <>
            <div className="border-t mb-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
            <p className="text-xs text-white/30 uppercase tracking-widest mb-2">Breakdown Today</p>
            <div className="space-y-1.5 mb-3">
              {breakdownItems.map(({ label, icon, amount }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-white/60">{icon} {label}</span>
                  <span className={`text-sm font-semibold ${amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {amount >= 0 ? '+' : ''}{formatPrice(amount)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center py-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <span className="text-sm font-bold text-white">NET TODAY</span>
              <span className={`text-lg font-bold ${today.net >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                {formatPrice(today.net)}
              </span>
            </div>
          </>
        )}

        {/* Your Actual Money */}
        <div className="border-t mt-4 pt-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Paystack Balance Breakdown</p>
          <div className="space-y-1.5 mb-3">
            <div className="flex justify-between">
              <span className="text-sm text-white/50">Paystack account balance</span>
              <span className="text-sm text-white">{formatPrice(paystack_balance_kobo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-white/50">Vendor wallet float</span>
              <span className="text-sm text-red-400">−{formatPrice(vendor_wallet_total_kobo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-white/50">Rider wallet float</span>
              <span className="text-sm text-red-400">−{formatPrice(rider_wallet_total_kobo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-white/50">Customer wallet float</span>
              <span className="text-sm text-red-400">−{formatPrice(customer_wallet_total_kobo)}</span>
            </div>
          </div>
          <div className="rounded-2xl p-3 flex justify-between items-center" style={{
            background: founder_actual_money_kobo >= 0 ? 'rgba(245,166,35,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${founder_actual_money_kobo >= 0 ? 'rgba(245,166,35,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            <span className="text-sm font-bold text-white">YOUR ACTUAL MONEY</span>
            <span className={`text-xl font-bold ${founder_actual_money_kobo >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
              {formatPrice(founder_actual_money_kobo)}
            </span>
          </div>
          <button
            onClick={() => setShowWithdraw(true)}
            className="w-full mt-3 py-3 rounded-2xl font-bold text-black text-sm"
            style={{ background: '#F5A623' }}>
            Withdraw from Paystack
          </button>
        </div>
      </div>

      {showWithdraw && (
        <WithdrawModal
          available={Math.max(0, founder_actual_money_kobo)}
          onClose={() => setShowWithdraw(false)}
        />
      )}
    </>
  )
}

// ─── My Earnings History tab ──────────────────────────────────────────────────

type DateRange = 'today' | 'week' | 'month' | 'custom'

function MyEarningsTab() {
  const [records,    setRecords]    = useState<EarningsRecord[]>([])
  const [total,      setTotal]      = useState(0)
  const [page,       setPage]       = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading,    setLoading]    = useState(true)
  const [range,      setRange]      = useState<DateRange>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')

  const buildParams = useCallback(() => {
    const now  = new Date()
    const params = new URLSearchParams({ page: String(page), limit: '50' })
    if (range === 'today') {
      params.set('from', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString())
    } else if (range === 'week') {
      params.set('from', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
    } else if (range === 'month') {
      params.set('from', new Date(now.getFullYear(), now.getMonth(), 1).toISOString())
    } else {
      if (customFrom) params.set('from', new Date(customFrom).toISOString())
      if (customTo)   params.set('to',   new Date(customTo + 'T23:59:59').toISOString())
    }
    return params
  }, [page, range, customFrom, customTo])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/super-admin/earnings/history?${buildParams()}`)
      .then((r) => r.json())
      .then((d: { records: EarningsRecord[]; total: number; total_pages: number }) => {
        setRecords(d.records ?? [])
        setTotal(d.total ?? 0)
        setTotalPages(d.total_pages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [buildParams])

  function exportCSV() {
    const header = 'Date,Type,Amount (₦),Description,Order ID'
    const rows = records.map((r) => [
      new Date(r.created_at).toLocaleString('en-NG'),
      TYPE_LABEL[r.type] ?? r.type,
      (r.amount_kobo / 100).toFixed(2),
      (r.description ?? '').replace(/,/g, ';'),
      r.order_id ?? '',
    ].join(','))
    const csv  = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `lumex-earnings-${range}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const RANGE_BTNS: Array<{ key: DateRange; label: string }> = [
    { key: 'today', label: 'Today'  },
    { key: 'week',  label: 'Week'   },
    { key: 'month', label: 'Month'  },
    { key: 'custom',label: 'Custom' },
  ]

  return (
    <div>
      {/* Range filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {RANGE_BTNS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setRange(key); setPage(1) }}
            className="px-4 py-1.5 rounded-full text-xs font-semibold transition-colors"
            style={{
              background: range === key ? '#F5A623' : 'rgba(255,255,255,0.06)',
              color:      range === key ? '#000'     : 'rgba(255,255,255,0.5)',
            }}>
            {label}
          </button>
        ))}
        {records.length > 0 && (
          <button
            onClick={exportCSV}
            className="ml-auto px-4 py-1.5 rounded-full text-xs font-semibold"
            style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)' }}>
            ↓ Export CSV
          </button>
        )}
      </div>

      {range === 'custom' && (
        <div className="flex gap-2 mb-4">
          <input type="date" value={customFrom} onChange={(e) => { setCustomFrom(e.target.value); setPage(1) }}
            className="flex-1 rounded-xl px-3 py-2 text-sm text-white outline-none"
            style={{ background: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)' }} />
          <input type="date" value={customTo}   onChange={(e) => { setCustomTo(e.target.value);   setPage(1) }}
            className="flex-1 rounded-xl px-3 py-2 text-sm text-white outline-none"
            style={{ background: '#1a1a1c', border: '1px solid rgba(255,255,255,0.1)' }} />
        </div>
      )}

      {/* Summary line */}
      <div className="flex justify-between items-center mb-3">
        <p className="text-xs text-white/30">{total} records</p>
        <p className="text-xs text-white/30">
          Net: <span className={records.reduce((s, r) => s + r.amount_kobo, 0) >= 0 ? 'text-amber-400' : 'text-red-400'}>
            {formatPrice(records.reduce((s, r) => s + r.amount_kobo, 0))}
          </span>
        </p>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: '#111113' }} />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">💰</p>
          <p className="text-white/40 text-sm">No earnings recorded yet for this period.</p>
          <p className="text-white/20 text-xs mt-1">Complete orders to start seeing data here.</p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          {records.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center justify-between px-4 py-3"
              style={{
                background: i % 2 === 0 ? '#0f0f11' : '#111113',
                borderBottom: i < records.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              }}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg flex-shrink-0">{TYPE_ICON[r.type] ?? '·'}</span>
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">{TYPE_LABEL[r.type] ?? r.type}</p>
                  <p className="text-xs text-white/30 truncate">
                    {new Date(r.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <span className={`text-sm font-bold flex-shrink-0 ml-3 ${r.amount_kobo >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {r.amount_kobo >= 0 ? '+' : ''}{formatPrice(r.amount_kobo)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-xl text-sm text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)', opacity: page === 1 ? 0.4 : 1 }}>
            ← Prev
          </button>
          <span className="px-4 py-2 text-sm text-white/30">{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-xl text-sm text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)', opacity: page === totalPages ? 0.4 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Platform Overview tab (existing content) ─────────────────────────────────

function PlatformOverview({ data }: { data: Financials }) {
  const now       = new Date()
  const monthName = now.toLocaleString('en-NG', { month: 'long', year: 'numeric' })

  return (
    <>
      {/* ── Today's Profit ─────────────────────────────────── */}
      <div className="rounded-2xl p-5 mb-6" style={{
        background: 'rgba(245,166,35,0.05)',
        border: '1px solid rgba(245,166,35,0.18)',
      }}>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">Today's Platform Snapshot</p>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <p className="text-xs text-white/40 mb-1">Orders today</p>
            <p className="text-2xl font-bold text-white">{data.orders_today}</p>
          </div>
          <div>
            <p className="text-xs text-white/40 mb-1">Platform revenue today</p>
            <p className="text-2xl font-bold text-white">{formatPrice(data.platform_revenue_today_kobo)}</p>
          </div>
        </div>
        <div className="border-t border-white/8 pt-3">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-white/40 mb-1">Net float gain today</p>
              <p className="text-lg font-semibold text-green-400">{formatPrice(data.net_float_gain_today_kobo)}</p>
              <p className="text-xs text-white/30">Top-ups minus bonuses issued</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-white/40 mb-1">NET PROFIT TODAY</p>
              <p className="text-2xl font-bold" style={{ color: '#F5A623' }}>
                {formatPrice(data.net_platform_profit_today_kobo)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Monthly GMV + Revenue ───────────────────────────── */}
      <Section title={`Revenue — ${monthName}`} />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard label="GMV" value={formatPrice(data.gmv_kobo)} sub="Gross merchandise value" highlight />
        <StatCard
          label="Take rate"
          value={`${data.take_rate_pct}%`}
          sub="Target: 15–20%"
          highlight={data.take_rate_pct >= 15 && data.take_rate_pct <= 20}
          warn={data.take_rate_pct < 10}
        />
        <StatCard label="Platform revenue" value={formatPrice(data.platform_revenue_kobo)} sub="Markup + delivery cut" />
        <StatCard label="Subscription MRR" value={formatPrice(data.subscription_revenue_kobo)} sub="Vendor monthly fees" />
        <div className="col-span-2">
          <StatCard label="Total revenue (month)" value={formatPrice(data.total_revenue_kobo)} sub={`${data.orders_this_month} orders · ${data.orders_today} today`} highlight />
        </div>
      </div>

      {/* ── Customer Wallet Float ───────────────────────────── */}
      <Section title="Customer Wallet Float" />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard label="Total float" value={formatPrice(data.customer_float_kobo)} sub={`${data.customer_wallet_count} active wallets`} accent="#a78bfa" />
        <StatCard label="Lifetime loaded" value={formatPrice(data.lifetime_topup_kobo)} sub="All time top-ups" />
        <StatCard label="Top-ups today" value={formatPrice(data.topup_today_kobo)} sub={`Bonuses: −${formatPrice(data.bonus_issued_today_kobo)}`} />
        <StatCard label="Net float gain today" value={formatPrice(data.net_float_gain_today_kobo)} sub="Working capital gained" highlight={data.net_float_gain_today_kobo > 0} />
      </div>

      <div className="rounded-2xl p-4 mb-6" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.15)' }}>
        <p className="text-xs font-semibold mb-1" style={{ color: '#a78bfa' }}>💡 Customer float earning potential</p>
        <p className="text-2xl font-bold text-white">{formatPrice(data.float_annual_potential_kobo)}</p>
        <p className="text-xs text-white/40 mt-1">If {formatPrice(data.customer_float_kobo)} deployed at 12%/year — grows as platform scales</p>
      </div>

      {/* ── Vendor + Rider Wallet Balances ──────────────────── */}
      <Section title="Vendor + Rider Wallets" />
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard label="Vendor wallets" value={formatPrice(data.vendor_wallet_kobo)} />
        <StatCard label="Rider wallets" value={formatPrice(data.rider_wallet_kobo)} />
        <StatCard label="Rider bonuses today" value={formatPrice(data.rider_bonus_paid_today_kobo)} sub="Milestones awarded" />
        <StatCard label="Total held" value={formatPrice(data.total_held_kobo)} sub="Pending releases" />
      </div>

      {/* ── Reconciliation Rule ──────────────────────────────── */}
      <div className="rounded-2xl p-4" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.15)' }}>
        <p className="text-sm font-semibold text-amber-400 mb-1">Daily reconciliation rule</p>
        <p className="text-xs text-white/50">
          If (vendor wallets + rider wallets + customer wallets) ≠ Paystack balance: STOP everything. Investigate before any payouts.
          Cron runs daily at 6am — check /admin/wallets for status.
        </p>
      </div>
    </>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'my-earnings'

export default function SuperAdminFinancials() {
  const router             = useRouter()
  const [data,    setData] = useState<Financials | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]  = useState<Tab>('overview')

  const now       = new Date()
  const monthName = now.toLocaleString('en-NG', { month: 'long', year: 'numeric' })

  useEffect(() => {
    fetch('/api/super-admin/financials')
      .then((r) => {
        if (r.status === 403 || r.status === 401) { router.push('/auth'); return null }
        return r.json()
      })
      .then((d: Financials | null) => { if (d) setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [router])

  return (
    <div className="min-h-dvh px-4 py-8" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/super-admin')}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-xs font-bold mb-1"
              style={{ background: '#F5A623', color: '#000' }}>Super Admin</span>
            <h1 className="text-xl font-bold text-white">Financials</h1>
            <p className="text-sm text-white/40">{monthName}</p>
          </div>
        </div>

        {/* ── Founder Earnings — always at top ─────────────── */}
        <FounderEarnings />

        {/* ── Tab switcher ─────────────────────────────────── */}
        <div className="flex gap-2 mb-6">
          {([
            { key: 'overview',    label: 'Platform Overview' },
            { key: 'my-earnings', label: 'My Earnings History' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex-1 py-2.5 rounded-2xl text-sm font-semibold transition-colors"
              style={{
                background: tab === key ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.04)',
                color:      tab === key ? '#F5A623'               : 'rgba(255,255,255,0.4)',
                border:     `1px solid ${tab === key ? 'rgba(245,166,35,0.25)' : 'rgba(255,255,255,0.06)'}`,
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab content ──────────────────────────────────── */}
        {tab === 'overview' && (
          loading ? <Skeleton /> : !data
            ? <p className="text-white/30 text-center py-16">Failed to load financials</p>
            : <PlatformOverview data={data} />
        )}

        {tab === 'my-earnings' && <MyEarningsTab />}

      </div>
    </div>
  )
}
