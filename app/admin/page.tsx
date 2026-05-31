'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'

interface DashboardMetrics {
  orders_today: number
  profit_per_order_kobo: number
  avg_delivery_minutes: number | null
  riders_online: number
  active_disputes: number
  wallet_float_kobo: number
}

interface MetricCardProps {
  label: string
  value: string
  sub?: string
  status?: 'ok' | 'warn' | 'critical'
  href?: string
}

function MetricCard({ label, value, sub, status = 'ok', href }: MetricCardProps) {
  const router = useRouter()
  const statusColor = status === 'critical' ? '#EF4444' : status === 'warn' ? '#F5A623' : '#22C55E'

  return (
    <button
      onClick={() => href && router.push(href)}
      className="text-left rounded-2xl p-4 transition-colors hover:border-white/20"
      style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)', cursor: href ? 'pointer' : 'default' }}
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs text-white/40 uppercase tracking-wide">{label}</p>
        <span className="w-2 h-2 rounded-full mt-0.5 shrink-0" style={{ background: statusColor }} />
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-white/40 mt-1">{sub}</p>}
    </button>
  )
}

const NAV_ACTIONS = [
  { href: '/admin/vendors', label: 'Vendors', icon: '🏪', desc: 'Approve, suspend, manage vendors' },
  { href: '/admin/riders', label: 'Riders', icon: '🏍️', desc: 'Manage rider accounts' },
  { href: '/admin/orders', label: 'Orders', icon: '📦', desc: 'Browse all orders' },
  { href: '/admin/disputes', label: 'Disputes', icon: '⚠️', desc: 'Resolve customer disputes' },
  { href: '/admin/vendors/new', label: 'Add Vendor', icon: '➕', desc: 'Create vendor with temp PIN' },
  { href: '/admin/riders/new', label: 'Add Rider', icon: '➕', desc: 'Onboard a new rider' },
  { href: '/admin/wallets', label: 'Wallets', icon: '💰', desc: 'Freeze/unfreeze, float status' },
  { href: '/admin/audit', label: 'Audit Log', icon: '📋', desc: 'All admin actions' },
]

export default function AdminDashboard() {
  const router = useRouter()
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  async function fetchMetrics() {
    const res = await fetch('/api/admin/dashboard')
    if (res.ok) {
      const d = await res.json() as DashboardMetrics
      setMetrics(d)
      setLastRefresh(new Date())
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 60_000)
    return () => clearInterval(interval)
  }, [])

  function deliveryStatus(mins: number | null | undefined): 'ok' | 'warn' | 'critical' {
    if (!mins) return 'ok'
    if (mins > 30) return 'critical'
    if (mins > 25) return 'warn'
    return 'ok'
  }

  function disputeStatus(count: number): 'ok' | 'warn' | 'critical' {
    if (count === 0) return 'ok'
    if (count <= 3) return 'warn'
    return 'critical'
  }

  function profitStatus(kobo: number): 'ok' | 'warn' | 'critical' {
    if (kobo <= 0) return 'critical'
    return 'ok'
  }

  return (
    <div className="min-h-dvh px-4 py-10" style={{ background: '#0A0A0B' }}>
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-6">
          <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold mb-3"
            style={{ background: '#F5A623', color: '#000' }}>Admin</span>
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <p className="text-sm text-white/40 mt-0.5">Daily metrics</p>
            </div>
            <div className="flex items-center gap-2">
              {lastRefresh && (
                <p className="text-xs text-white/30">
                  {lastRefresh.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              <button
                onClick={fetchMetrics}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                ↻
              </button>
            </div>
          </div>
        </div>

        {/* Metrics grid */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: '#111113' }} />
            ))}
          </div>
        ) : metrics ? (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <MetricCard
              label="Orders today"
              value={String(metrics.orders_today)}
              sub="Target: 50+ by Month 3"
              status={metrics.orders_today >= 50 ? 'ok' : metrics.orders_today >= 20 ? 'warn' : 'critical'}
              href="/admin/orders"
            />
            <MetricCard
              label="Profit / order"
              value={metrics.profit_per_order_kobo > 0 ? formatPrice(metrics.profit_per_order_kobo) : '—'}
              sub="Must be positive"
              status={profitStatus(metrics.profit_per_order_kobo)}
            />
            <MetricCard
              label="Avg delivery"
              value={metrics.avg_delivery_minutes != null ? `${Math.round(metrics.avg_delivery_minutes)}m` : '—'}
              sub="Target: under 25 min"
              status={deliveryStatus(metrics.avg_delivery_minutes)}
            />
            <MetricCard
              label="Riders online"
              value={String(metrics.riders_online)}
              sub="Currently active"
              status={metrics.riders_online > 0 ? 'ok' : 'warn'}
              href="/admin/riders"
            />
            <MetricCard
              label="Active disputes"
              value={String(metrics.active_disputes)}
              sub={metrics.active_disputes === 0 ? 'All clear' : 'Needs attention'}
              status={disputeStatus(metrics.active_disputes)}
              href="/admin/disputes"
            />
            <MetricCard
              label="Wallet float"
              value={formatPrice(metrics.wallet_float_kobo)}
              sub="Vendor + rider held funds"
              status="ok"
            />
          </div>
        ) : (
          <div className="rounded-2xl p-5 mb-6 text-center text-white/40 text-sm" style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}>
            Could not load metrics
          </div>
        )}

        {/* Alerts */}
        {metrics && metrics.active_disputes > 0 && (
          <button
            onClick={() => router.push('/admin/disputes')}
            className="w-full text-left rounded-2xl p-4 mb-6 flex items-center gap-3"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-semibold text-red-400">{metrics.active_disputes} dispute{metrics.active_disputes !== 1 ? 's' : ''} need resolution</p>
              <p className="text-xs text-white/40 mt-0.5">Tap to review</p>
            </div>
          </button>
        )}

        {/* Navigation */}
        <div className="grid gap-3 sm:grid-cols-2">
          {NAV_ACTIONS.map((a) => (
            <button
              key={a.href}
              onClick={() => router.push(a.href)}
              className="text-left rounded-2xl border border-white/10 bg-white/5 p-4 transition-colors hover:border-amber-500/40 hover:bg-white/8"
            >
              <div className="flex items-center gap-2 mb-1">
                <span>{a.icon}</span>
                <p className="font-semibold text-white">{a.label}</p>
              </div>
              <p className="text-sm text-white/40">{a.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
