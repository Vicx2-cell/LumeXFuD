'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Pill } from '@/components/ui/pill'

interface FloatStats {
  total_wallet:        string
  total_available:     string
  total_held:          string
  vendor_total:        string
  rider_total:         string
  customer_float:      string
  customer_float_kobo: number
  platform_total:      string
  frozen_count:        number
  paystack_balance:    string | null
  difference:          string | null
  reconciled:          boolean | null
}

interface WalletRow {
  user_id:            string
  user_type:          string
  name:               string
  owner:              string | null
  phone:              string
  total_balance:      string
  available_balance:  string
  held_balance:       string
  total_balance_kobo: number
  trust_tier:         string
  is_frozen:          boolean
  frozen_reason:      string | null
  bank_name:          string | null
  bank_last_4:        string | null
  bank_verified:      boolean
  sweep_fail_count:   number
  lifetime_earned:    string
  total_withdrawn:    string
  updated_at:         string
}

const TIER_COLORS: Record<string, string> = {
  BRONZE: '#CD7F32', SILVER: '#C0C0C0', GOLD: '#FFD700', DIAMOND: '#B9F2FF',
}

const TYPE_FILTER_LABELS = [
  { key: '',         label: 'All' },
  { key: 'VENDOR',   label: 'Vendors' },
  { key: 'RIDER',    label: 'Riders' },
  { key: 'CUSTOMER', label: 'Customers' },
] as const

export default function AdminWalletsPage() {
  const router = useRouter()
  const [float,      setFloat]      = useState<FloatStats | null>(null)
  const [wallets,    setWallets]    = useState<WalletRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | 'VENDOR' | 'RIDER' | 'CUSTOMER'>('')
  const [frozenFilter, setFrozenFilter] = useState(false)
  const [selected,   setSelected]   = useState<WalletRow | null>(null)
  const [freezeReason,   setFreezeReason]   = useState('')
  const [unfreezeReason, setUnfreezeReason] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (typeFilter) params.set('type', typeFilter)
    if (frozenFilter) params.set('frozen', 'true')
    if (search) params.set('q', search)

    const res = await fetch(`/api/admin/wallets?${params}`)
    if (res.status === 401 || res.status === 403) { router.push('/auth'); return }
    if (!res.ok) { setLoading(false); return }
    const d = await res.json() as { float: FloatStats; wallets: WalletRow[] }
    setFloat(d.float)
    setWallets(d.wallets)
    setLoading(false)
  }, [router, typeFilter, frozenFilter, search])

  useEffect(() => { load() }, [load])

  async function freezeWallet(row: WalletRow) {
    if (!freezeReason.trim()) return
    setActionLoading(true)
    const res = await fetch('/api/wallet/freeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: row.user_id, user_type: row.user_type, reason: freezeReason }),
    })
    setActionLoading(false)
    if (res.ok) { showToast(`Wallet frozen for ${row.name}`); setSelected(null); setFreezeReason(''); load() }
    else { const d = await res.json() as { error?: string }; showToast(d.error ?? 'Failed') }
  }

  async function unfreezeWallet(row: WalletRow) {
    if (!unfreezeReason.trim()) return
    setActionLoading(true)
    const res = await fetch('/api/wallet/unfreeze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: row.user_id, user_type: row.user_type, reason: unfreezeReason }),
    })
    setActionLoading(false)
    if (res.ok) { showToast(`Wallet unfrozen for ${row.name}`); setSelected(null); setUnfreezeReason(''); load() }
    else { const d = await res.json() as { error?: string }; showToast(d.error ?? 'Failed') }
  }

  const badgeColor = (type: string) => {
    if (type === 'VENDOR')   return { bg: 'rgba(96,165,250,0.15)',  fg: '#60a5fa' }
    if (type === 'RIDER')    return { bg: 'rgba(74,222,128,0.15)',  fg: '#4ade80' }
    if (type === 'CUSTOMER') return { bg: 'rgba(167,139,250,0.15)', fg: '#a78bfa' }
    return { bg: 'rgba(255,255,255,0.08)', fg: '#fff' }
  }

  return (
    <div className="lx-page px-4 py-8">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg"
          style={{ background: '#F5A623', color: '#000' }}>{toast}</div>
      )}

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} aria-label="Go back"
            className="w-11 h-11 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <div>
            <span className="inline-block px-2 py-0.5 rounded text-xs font-bold mb-1"
              style={{ background: '#F5A623', color: '#000' }}>Admin</span>
            <h1 className="text-xl font-bold text-white">Wallets</h1>
          </div>
        </div>

        {/* Platform Float Summary */}
        {float && (
          <div className="glass-thin rounded-2xl p-5 mb-6">
            <p className="text-xs text-white/40 uppercase tracking-widest mb-4">Platform Float</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-white/40 mb-1">Vendor Wallets</p>
                <p className="text-xl font-bold text-white">{float.vendor_total}</p>
              </div>
              <div>
                <p className="text-xs text-white/40 mb-1">Rider Wallets</p>
                <p className="text-xl font-bold text-white">{float.rider_total}</p>
              </div>
              <div>
                <p className="text-xs text-white/40 mb-1">Customer Wallets 💡</p>
                <p className="text-xl font-bold" style={{ color: '#a78bfa' }}>{float.customer_float}</p>
                <p className="text-xs text-white/30 mt-0.5">Pre-loaded float</p>
              </div>
              <div>
                <p className="text-xs text-white/40 mb-1">Available (V+R)</p>
                <p className="text-lg font-semibold text-green-400">{float.total_available}</p>
              </div>
              <div>
                <p className="text-xs text-white/40 mb-1">Still Held</p>
                <p className="text-lg font-semibold text-amber-400">{float.total_held}</p>
              </div>
              <div>
                <p className="text-xs text-white/40 mb-1">Total Platform Float</p>
                <p className="lx-amber text-lg font-semibold">{float.platform_total}</p>
              </div>
              {float.frozen_count > 0 && (
                <div>
                  <p className="text-xs text-white/40 mb-1">Frozen Wallets</p>
                  <p className="text-lg font-semibold text-red-400">{float.frozen_count}</p>
                </div>
              )}
            </div>

            {/* Reconciliation */}
            {float.paystack_balance && (
              <div className={`rounded-xl p-3 flex items-center justify-between ${
                float.reconciled ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/30'
              }`}>
                <div>
                  <p className="text-xs font-medium" style={{ color: float.reconciled ? '#4ade80' : '#f87171' }}>
                    {float.reconciled ? '✅ Reconciled' : '🚨 MISMATCH — Investigate immediately'}
                  </p>
                  <p className="text-xs text-white/40 mt-0.5">
                    Paystack: {float.paystack_balance} · Difference: {float.difference}
                  </p>
                </div>
                <button onClick={() => load()}
                  className="text-xs px-3 py-1.5 rounded-lg text-white/50 hover:text-white"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  Refresh
                </button>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            className="lx-field flex-1 min-w-[200px] px-4 py-2.5 text-sm placeholder-white/30"
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex gap-1">
            {TYPE_FILTER_LABELS.map(({ key, label }) => (
              <Pill key={key}
                active={typeFilter === key}
                onClick={() => setTypeFilter(key)}
                className="px-3 py-2 text-sm">
                {label}
              </Pill>
            ))}
          </div>
          <Pill
            variant="danger"
            active={frozenFilter}
            onClick={() => setFrozenFilter((v) => !v)}
            className="px-3 py-2 text-sm">
            🔒 Frozen
          </Pill>
        </div>

        {/* Wallet Table */}
        {loading ? (
          <div className="space-y-2">
            {[1,2,3,4,5].map((i) => (
              <div key={i} className="h-16 rounded-2xl lx-skeleton" />
            ))}
          </div>
        ) : wallets.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-white/30">No wallets found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {wallets.map((w) => {
              const badge = badgeColor(w.user_type)
              return (
                <button
                  key={`${w.user_id}:${w.user_type}`}
                  onClick={() => setSelected(w)}
                  className="w-full text-left rounded-2xl px-4 py-3 transition-colors hover:border-white/20"
                  style={{
                    background: '#111113',
                    border: `1px solid ${w.is_frozen ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.07)'}`,
                  }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge color={badge.fg}>{w.user_type[0]}</Badge>
                        <p className="text-white font-medium text-sm truncate">{w.name}</p>
                        {w.is_frozen && <span className="text-xs text-red-400">🔒</span>}
                      </div>
                      <p className="text-white/40 text-xs truncate">{w.phone}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-white font-semibold text-sm">{w.total_balance}</p>
                      <div className="flex items-center gap-2 justify-end mt-0.5">
                        <span className="text-green-400 text-xs">{w.available_balance} avail</span>
                        {w.held_balance !== '₦0' && (
                          <span className="text-amber-400 text-xs">{w.held_balance} held</span>
                        )}
                      </div>
                    </div>
                    {w.trust_tier !== 'N/A' && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: TIER_COLORS[w.trust_tier] ?? '#CD7F32', color: '#000' }}>
                        {w.trust_tier[0]}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Wallet Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/70"
            onClick={() => { setSelected(null); setFreezeReason(''); setUnfreezeReason('') }} />
          <div className="relative w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: '#111' }}>
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-5 sm:hidden" />

            <div className="flex items-start justify-between mb-4">
              <div>
                <Badge color={badgeColor(selected.user_type).fg} className="mb-1 inline-block">
                  {selected.user_type}
                </Badge>
                <h2 className="text-white font-semibold text-lg">{selected.name}</h2>
                {selected.owner && <p className="text-white/40 text-sm">{selected.owner}</p>}
                <p className="text-white/40 text-sm">{selected.phone}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-white/40 hover:text-white text-xl">✕</button>
            </div>

            {selected.is_frozen && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4">
                <p className="text-red-400 text-sm font-medium">🔒 Wallet is frozen</p>
                {selected.frozen_reason && (
                  <p className="text-red-400/70 text-xs mt-1">Reason: {selected.frozen_reason}</p>
                )}
              </div>
            )}

            {/* Balances */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-xs mb-1">Total</p>
                <p className="text-white font-semibold text-sm">{selected.total_balance}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-xs mb-1">Available</p>
                <p className="text-green-400 font-semibold text-sm">{selected.available_balance}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 text-center">
                <p className="text-white/40 text-xs mb-1">Held</p>
                <p className="text-amber-400 font-semibold text-sm">{selected.held_balance}</p>
              </div>
            </div>

            {/* Stats */}
            {selected.lifetime_earned !== '—' && (
              <div className="flex justify-between text-sm mb-5">
                <div>
                  <p className="text-white/40 text-xs">Lifetime Earned</p>
                  <p className="text-white">{selected.lifetime_earned}</p>
                </div>
                <div className="text-right">
                  <p className="text-white/40 text-xs">Total Withdrawn</p>
                  <p className="text-white">{selected.total_withdrawn}</p>
                </div>
              </div>
            )}

            {/* Bank */}
            {selected.bank_name ? (
              <div className="bg-white/5 rounded-xl p-3 mb-5">
                <p className="text-white/40 text-xs mb-1">Withdrawal Bank</p>
                <p className="text-white text-sm">{selected.bank_name} ****{selected.bank_last_4}</p>
                <p className="text-xs mt-1">
                  {selected.bank_verified
                    ? <span className="text-green-400">✓ Verified — eligible for 48h auto-sweep</span>
                    : <span className="lx-amber">⚠ Not verified — won’t auto-sweep until re-verified</span>}
                </p>
                {selected.sweep_fail_count > 0 && (
                  <p className="text-red-400 text-xs mt-1">⚠ {selected.sweep_fail_count} failed auto-sweep{selected.sweep_fail_count === 1 ? '' : 's'} — check this account</p>
                )}
              </div>
            ) : selected.user_type !== 'CUSTOMER' && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-5">
                <p className="lx-amber text-xs">⚠ No payout bank on file — this {selected.user_type.toLowerCase()} is gated from operating until they add one.</p>
              </div>
            )}

            {/* Trust tier */}
            {selected.trust_tier !== 'N/A' && (
              <div className="flex items-center gap-2 mb-5">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: TIER_COLORS[selected.trust_tier] ?? '#CD7F32', color: '#000' }}>
                  {selected.trust_tier}
                </span>
                <span className="text-white/40 text-xs">Trust Tier</span>
              </div>
            )}

            {/* Freeze / Unfreeze actions (not for customers — handled separately) */}
            {selected.user_type !== 'CUSTOMER' && (
              !selected.is_frozen ? (
                <div>
                  <p className="text-white/50 text-sm mb-2">Freeze wallet</p>
                  <textarea
                    className="w-full bg-white/5 text-white text-sm rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-red-500 mb-3 resize-none"
                    placeholder="Reason for freezing (required)…" rows={2}
                    value={freezeReason}
                    onChange={(e) => setFreezeReason(e.target.value)}
                  />
                  <button
                    className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-40 transition-colors"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
                    disabled={!freezeReason.trim() || actionLoading}
                    onClick={() => freezeWallet(selected)}>
                    {actionLoading ? 'Freezing…' : '🔒 Freeze Wallet'}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-white/50 text-sm mb-2">Unfreeze wallet</p>
                  <textarea
                    className="w-full bg-white/5 text-white text-sm rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-green-500 mb-3 resize-none"
                    placeholder="Reason for unfreezing (required)…" rows={2}
                    value={unfreezeReason}
                    onChange={(e) => setUnfreezeReason(e.target.value)}
                  />
                  <button
                    className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-40 transition-colors"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}
                    disabled={!unfreezeReason.trim() || actionLoading}
                    onClick={() => unfreezeWallet(selected)}>
                    {actionLoading ? 'Unfreezing…' : '✅ Unfreeze Wallet'}
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
