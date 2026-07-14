'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GlassSheen } from '@/components/fx'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { LogoutButton } from '@/components/logout-button'
import { StatCard } from '@/components/ui/stat-card'
import { STATUS_COLOR, STATUS_LABEL, type VendorDashboardRecentOrder, type VendorDashboardSummary, type VendorDashboardVendor } from '@/components/vendor-dashboard/helpers'
import { useVendorDashboard } from '@/components/vendor-dashboard/shell'
import { Store, UtensilsCrossed } from 'lucide-react'

export default function VendorDashboard() {
  const router = useRouter()
  const dashboard = useVendorDashboard()
  const [vendor, setVendor] = useState<VendorDashboardVendor | null>(null)
  const [summary, setSummary] = useState<VendorDashboardSummary | null>(null)
  const recent = dashboard?.recent ?? []
  const loading = !dashboard && !vendor && !summary
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    if (!dashboard) return
    setVendor(dashboard.vendor)
    setSummary(dashboard.summary)
  }, [dashboard])

  if (loading) {
    return (
      <div className="lx-page flex items-center justify-center">
        <div className="space-y-3 w-full max-w-lg px-4">
          <div className="lx-skeleton h-16" style={{ borderRadius: 16 }} />
          {[1, 2].map((i) => <div key={i} className="lx-skeleton h-24" style={{ borderRadius: 20 }} />)}
        </div>
      </div>
    )
  }

  const quickActions = [
    { href: '/vendor-dashboard/menu', label: 'Add menu item', desc: 'Edit what customers can order', icon: UtensilsCrossed },
    { href: '/vendor-dashboard/orders', label: 'View orders', desc: 'Open the live queue', icon: Store },
    { href: '/feed-v2/create', label: 'Create post/story', desc: 'Share a menu update or campus story', icon: UtensilsCrossed },
    { href: '/vendor-dashboard/support', label: 'Support', desc: 'Get help with orders or access', icon: Store },
  ] as const

  const storeStatus = summary?.store_status ?? vendor?.status ?? dashboard?.summary.store_status ?? dashboard?.vendor.status ?? 'OPEN'
  const completedToday = summary?.completed_today ?? 0
  const revenueText = formatMoney(summary?.revenue_today_kobo ?? 0)
  const revenueSub = completedToday > 0
    ? `From ${completedToday} completed order${completedToday === 1 ? '' : 's'}`
    : 'No completed orders yet'
  const recentLabel = (order: VendorDashboardRecentOrder) => {
    const items = order.order_items ?? []
    if (items.length === 0) return 'No item summary available'
    return items.slice(0, 2).map((item) => `${item.quantity}x ${item.name}`).join(' | ')
  }

  const updateStoreStatus = async (nextStatus: 'OPEN' | 'CLOSED') => {
    if (!vendor || statusBusy) return
    setStatusBusy(true)
    setStatusError('')
    try {
      const res = await fetch(`/api/vendors/${vendor.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string; status?: 'OPEN' | 'BUSY' | 'CLOSED'; code?: string }
      if (!res.ok) {
        setStatusError(data.error ?? 'Could not update store status.')
        return
      }
      const status = data.status ?? nextStatus
      setVendor((current) => (current ? { ...current, status, paused_until: null } : current))
      setSummary((current) => (current ? { ...current, store_status: status } : current))
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="lx-page lx-console overflow-hidden pb-12">
      <GlassSheen />
      <div className="mx-auto max-w-5xl px-4 pt-6">
        <PageHeader
          title={`Good ${greeting()}, ${vendor?.shop_name ?? 'vendor'}`}
          subtitle="A quick read on orders, revenue, and what needs attention right now."
          badge="Dashboard"
          actions={<LogoutButton />}
        />
      </div>

      <div className="mx-auto max-w-5xl px-4 py-5 space-y-5">
        <section className="lx-surface p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Store status</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">{vendor?.shop_name ?? 'Vendor workspace'}</h2>
              <p className="mt-2 text-sm text-white/55">Open or close the store, then keep the dashboard focused on today.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                color={storeStatus === 'OPEN' ? 'var(--lx-green)' : storeStatus === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}
              >
                {storeStatus}
              </Badge>
              {vendor?.pickup_enabled && (
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs font-medium text-white/55">
                  Pickup available
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Today's Orders"
            value={summary?.orders_today ?? 0}
            sub="Orders placed so far today"
            status="ok"
            href="/vendor-dashboard/orders"
          />
          <StatCard
            label="Today's Revenue"
            value={revenueText}
            sub={revenueSub}
            status="ok"
            href="/vendor-dashboard/earnings"
          />
          <StatCard
            label="Pending Orders"
            value={summary?.pending_orders ?? 0}
            sub="Waiting in the queue"
            status={(summary?.pending_orders ?? 0) > 0 ? 'warn' : 'none'}
            href="/vendor-dashboard/orders"
          />
          <StatCard
            label="Completed Today"
            value={completedToday}
            sub="Finished orders"
            status={completedToday > 0 ? 'ok' : 'none'}
            href="/vendor-dashboard/orders"
          />
        </section>

        <section className="lx-surface p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Quick actions</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Jump straight to the next job</h2>
            </div>
            <p className="text-xs text-white/35">The dashboard stays focused; the work lives on the next page.</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.href}
                  type="button"
                  onClick={() => router.push(action.href)}
                  className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-left transition hover:border-white/14 hover:bg-white/[0.05]"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/80">
                      <Icon size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{action.label}</p>
                      <p className="text-xs text-white/40">{action.desc}</p>
                    </div>
                  </div>
                </button>
              )
            })}
            <button
              type="button"
              disabled={statusBusy}
              onClick={() => void updateStoreStatus(storeStatus === 'OPEN' ? 'CLOSED' : 'OPEN')}
              className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-left transition hover:border-white/14 hover:bg-white/[0.05] disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/80">
                  <Store size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{storeStatus === 'OPEN' ? 'Close store' : 'Open store'}</p>
                  <p className="text-xs text-white/40">{statusBusy ? 'Saving status...' : 'Toggle orders on or off'}</p>
                </div>
              </div>
            </button>
          </div>
          {statusError && <p className="mt-3 text-xs text-red-300">{statusError}</p>}
        </section>

        <section className="lx-surface p-4 md:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Recent orders</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Latest activity</h2>
            </div>
            <button
              type="button"
              onClick={() => router.push('/vendor-dashboard/orders')}
              className="rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/75"
            >
              Open Orders
            </button>
          </div>

          {recent.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-white/75">No recent orders yet</p>
              <p className="mt-1 text-xs text-white/40">New completed or cancelled orders will appear here.</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {recent.slice(0, 5).map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{order.order_number}</p>
                    <p className="mt-1 truncate text-xs text-white/45">{recentLabel(order)}</p>
                    <p className="text-[11px] text-white/32">{new Date(order.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums text-sm font-semibold text-white">{formatMoney(order.total_amount)}</p>
                    <p className="text-xs font-medium" style={{ color: STATUS_COLOR[order.status] ?? 'rgba(255,255,255,0.4)' }}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function formatMoney(kobo: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kobo / 100)
}

function greeting() {
  const hour = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Africa/Lagos',
  }).format(new Date())
  const value = Number(hour)
  if (value < 12) return 'morning'
  if (value < 17) return 'afternoon'
  return 'evening'
}
