'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'
import { LogoutButton } from '@/components/logout-button'
import { CountUp } from '@/components/fx'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard } from '@/components/ui/stat-card'

interface DashboardMetrics {
  orders_today: number
  avg_profit_kobo: number
  avg_delivery_minutes: number | null
  riders_online: number
  active_disputes: number
  wallet_float_kobo: number
}

const svg = (path: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
)
const ICONS = {
  store:  svg(<><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M12 22V12"/></>),
  bike:   svg(<><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 17.5h-5l-2.5-6"/><path d="M12 6h3l2 5"/><path d="M6 11h7"/></>),
  box:    svg(<><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></>),
  alert:  svg(<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>),
  plus:   svg(<><path d="M5 12h14"/><path d="M12 5v14"/></>),
  wallet: svg(<><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></>),
  log:    svg(<><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></>),
  star:   svg(<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>),
  shield: svg(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12h6"/></>),
  pin:    svg(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>),
  receipt: svg(<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="m9 12 2 2 4-4"/></>),
  radar:  svg(<><path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/></>),
} as const

const NAV_ACTIONS = [
  { href: '/admin/live', label: 'Live Ops', icon: ICONS.radar, desc: 'Watch every active order live · flag & act on trouble' },
  { href: '/admin/vendors', label: 'Vendors', icon: ICONS.store, desc: 'Approve, suspend, manage vendors' },
  { href: '/admin/riders', label: 'Riders', icon: ICONS.bike, desc: 'Manage rider accounts' },
  { href: '/admin/orders', label: 'Orders', icon: ICONS.box, desc: 'Browse all orders' },
  { href: '/admin/disputes', label: 'Disputes', icon: ICONS.alert, desc: 'Resolve customer disputes' },
  { href: '/admin/reviews', label: 'Reviews', icon: ICONS.star, desc: 'Screen & remove vendor reviews' },
  { href: '/admin/accounts', label: 'Accounts', icon: ICONS.shield, desc: 'Suspend accounts · adjust wallets' },
  { href: '/admin/lodges', label: 'Lodges', icon: ICONS.pin, desc: 'Add & verify ABSU lodge locations' },
  { href: '/admin/verify-receipt', label: 'Verify Receipt', icon: ICONS.receipt, desc: 'Check a wallet receipt is genuine' },
  { href: '/admin/kyc', label: 'KYC Review', icon: ICONS.shield, desc: 'Approve vendor & rider documents' },
  { href: '/admin/vendors/new', label: 'Add Vendor', icon: ICONS.plus, desc: 'Create vendor with temp PIN' },
  { href: '/admin/riders/new', label: 'Add Rider', icon: ICONS.plus, desc: 'Onboard a new rider' },
  { href: '/admin/wallets', label: 'Wallets', icon: ICONS.wallet, desc: 'Freeze/unfreeze, float status' },
  { href: '/admin/audit', label: 'Audit Log', icon: ICONS.log, desc: 'All admin actions' },
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
    <div className="lx-page lx-console px-4 py-10 overflow-hidden">
      <div className="relative z-10 mx-auto max-w-2xl lg:max-w-4xl lx-enter">
        {/* Header */}
        <PageHeader
          title="Dashboard"
          subtitle="Daily metrics"
          badge="Admin"
          actions={
            <>
              {lastRefresh && (
                <p className="text-xs text-white/30 lx-nums">
                  {lastRefresh.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              <button
                onClick={fetchMetrics}
                aria-label="Refresh metrics"
                className="w-9 h-9 rounded-full flex items-center justify-center text-white/40 hover:text-white/70 transition-all active:rotate-180"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
              </button>
              <LogoutButton />
            </>
          }
        />

        {/* Metrics grid */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="lx-skeleton h-24" style={{ borderRadius: 20 }} />
            ))}
          </div>
        ) : metrics ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <StatCard
              label="Orders today"
              value={<CountUp value={metrics.orders_today} />}
              sub="Target: 50+ by Month 3"
              status={metrics.orders_today >= 50 ? 'ok' : metrics.orders_today >= 20 ? 'warn' : 'critical'}
              href="/admin/orders"
            />
            <StatCard
              label="Profit / order"
              value={metrics.avg_profit_kobo > 0 ? formatPrice(metrics.avg_profit_kobo) : '—'}
              sub="Must be positive"
              status={profitStatus(metrics.avg_profit_kobo)}
            />
            <StatCard
              label="Avg delivery"
              value={metrics.avg_delivery_minutes != null ? `${Math.round(metrics.avg_delivery_minutes)}m` : '—'}
              sub="Target: under 25 min"
              status={deliveryStatus(metrics.avg_delivery_minutes)}
            />
            <StatCard
              label="Riders online"
              value={<CountUp value={metrics.riders_online} />}
              sub="Currently active"
              status={metrics.riders_online > 0 ? 'ok' : 'warn'}
              href="/admin/riders"
            />
            <StatCard
              label="Active disputes"
              value={<CountUp value={metrics.active_disputes} />}
              sub={metrics.active_disputes === 0 ? 'All clear' : 'Needs attention'}
              status={disputeStatus(metrics.active_disputes)}
              href="/admin/disputes"
            />
            <StatCard
              label="Wallet float"
              value={formatPrice(metrics.wallet_float_kobo)}
              sub="Vendor + rider held funds"
              status="ok"
            />
          </div>
        ) : (
          <div className="lx-surface p-5 mb-6 text-center text-white/45 text-sm">
            Could not load metrics
          </div>
        )}

        {/* Alerts */}
        {metrics && metrics.active_disputes > 0 && (
          <button
            onClick={() => router.push('/admin/disputes')}
            className="w-full text-left rounded-2xl p-4 mb-6 flex items-center gap-3 transition-transform hover:-translate-y-0.5"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', boxShadow: '0 0 24px rgba(239,68,68,0.1)' }}
          >
            <span className="text-red-400 shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            </span>
            <div>
              <p className="font-semibold text-red-400">{metrics.active_disputes} dispute{metrics.active_disputes !== 1 ? 's' : ''} need resolution</p>
              <p className="text-xs text-white/40 mt-0.5">Tap to review</p>
            </div>
          </button>
        )}

        {/* Navigation */}
        <p className="lx-mono mb-4">Manage</p>
        <div className="grid gap-3 sm:grid-cols-2 lx-stagger">
          {NAV_ACTIONS.map((a) => (
            <button
              key={a.href}
              onClick={() => router.push(a.href)}
              className="lx-surface lx-focusable text-left p-4 transition-colors hover:border-white/15 group"
            >
              <div className="flex items-center gap-2.5 mb-1">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white/55" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--lx-border)' }}>
                  {a.icon}
                </span>
                <p className="font-semibold text-white">{a.label}</p>
              </div>
              <p className="text-sm text-white/45">{a.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
