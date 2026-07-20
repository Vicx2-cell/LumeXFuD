'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CircleDollarSign, Clock3, Store, UtensilsCrossed } from 'lucide-react'
import { GlassSheen } from '@/components/fx'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { LogoutButton } from '@/components/logout-button'
import { StatCard } from '@/components/ui/stat-card'
import {
  STATUS_COLOR,
  STATUS_LABEL,
  formatMoney,
  type VendorDashboardRecentOrder,
  type VendorDashboardSummary,
  type VendorDashboardVendor,
} from '@/components/vendor-dashboard/helpers'
import { useVendorDashboard } from '@/components/vendor-dashboard/shell'

export default function VendorDashboard() {
  const dashboard = useVendorDashboard()
  const vendor: VendorDashboardVendor | null = dashboard?.vendor ?? null
  const summary: VendorDashboardSummary | null = dashboard?.summary ?? null
  const [statusOverride, setStatusOverride] = useState<'OPEN' | 'BUSY' | 'CLOSED' | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState('')
  const recent = dashboard?.recent ?? []
  const loading = !dashboard

  if (loading) {
    return (
      <div className="lx-page flex min-h-dvh items-center justify-center">
        <div className="w-full max-w-lg space-y-3 px-4">
          <div className="lx-skeleton h-20 rounded-3xl" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((item) => <div key={item} className="lx-skeleton h-28 rounded-3xl" />)}
          </div>
        </div>
      </div>
    )
  }

  const storeStatus = statusOverride ?? summary?.store_status ?? vendor?.status ?? 'OPEN'
  const completedToday = summary?.completed_today ?? 0
  const pendingOrders = summary?.pending_orders ?? 0
  const activeOrders = summary?.active_orders ?? 0
  const salesToday = summary?.vendor_sales_today_kobo ?? 0
  const focus = getFocus({ storeStatus, pendingOrders, activeOrders })

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
      const data = await res.json().catch(() => ({})) as { error?: string; status?: 'OPEN' | 'BUSY' | 'CLOSED' }
      if (!res.ok) {
        setStatusError(data.error ?? 'Could not update store status.')
        return
      }
      const status = data.status ?? nextStatus
      setStatusOverride(status)
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="lx-page lx-console min-h-dvh overflow-hidden pb-28 lg:pb-12">
      <GlassSheen />
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 sm:pt-7">
        <PageHeader
          title={`Good ${greeting()}, ${vendor?.shop_name ?? 'vendor'}`}
          subtitle="Your kitchen at a glance—what needs attention, what you earned, and what comes next."
          badge="Today"
          actions={<LogoutButton />}
        />
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6 lg:space-y-5">
        <section className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(135deg,rgba(245,166,35,0.16),rgba(255,255,255,0.035)_48%,rgba(34,197,94,0.08))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.32)] sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[#F5A623]/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={storeStatus === 'OPEN' ? 'var(--lx-green)' : storeStatus === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}>
                  {storeStatus === 'OPEN' ? 'Taking orders' : storeStatus === 'BUSY' ? 'Paused' : 'Store closed'}
                </Badge>
                {vendor?.pickup_enabled && <span className="text-xs font-medium text-white/45">Pickup enabled</span>}
              </div>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#F5A623]">Right now</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{focus.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">{focus.body}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
              {focus.href && (
                <Link href={focus.href} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#F5A623] px-5 text-sm font-bold text-black transition hover:bg-[#ffc35c]">
                  {focus.action}<ArrowRight size={17} />
                </Link>
              )}
              <button
                type="button"
                disabled={statusBusy}
                onClick={() => void updateStoreStatus(storeStatus === 'OPEN' ? 'CLOSED' : 'OPEN')}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-5 text-sm font-semibold text-white/75 transition hover:bg-white/[0.08] disabled:opacity-60"
              >
                <Store size={17} />
                {statusBusy ? 'Saving…' : storeStatus === 'OPEN' ? 'Close store' : 'Open store'}
              </button>
            </div>
          </div>
          {statusError && <p className="relative mt-3 text-xs text-red-300">{statusError}</p>}
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Food sales today" value={formatMoney(salesToday)} sub="Your menu subtotal only" status={salesToday > 0 ? 'ok' : 'none'} href="/vendor-dashboard/earnings" />
          <StatCard label="New orders" value={pendingOrders} sub={pendingOrders > 0 ? 'Waiting for your response' : 'Nothing waiting'} status={pendingOrders > 0 ? 'warn' : 'none'} href="/vendor-dashboard/orders" />
          <StatCard label="Active kitchen" value={activeOrders} sub="Accepted through handoff" status={activeOrders > 0 ? 'ok' : 'none'} href="/vendor-dashboard/orders" />
          <StatCard label="Completed today" value={completedToday} sub={`${summary?.orders_today ?? 0} total order${(summary?.orders_today ?? 0) === 1 ? '' : 's'} today`} status={completedToday > 0 ? 'ok' : 'none'} href="/vendor-dashboard/orders" />
        </section>

        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] px-4 py-3 text-xs leading-5 text-emerald-100/70">
          <span className="font-semibold text-emerald-200">Clear earnings:</span> food sales show only your menu subtotal. LumeX platform and delivery fees are excluded from your figures.
        </div>

        <section className="grid gap-3 sm:grid-cols-3">
          <DashboardAction href="/vendor-dashboard/orders" icon={ArrowRight} title="Run the queue" body="Accept and move orders through prep." />
          <DashboardAction href="/vendor-dashboard/menu" icon={UtensilsCrossed} title="Update menu" body="Prices, stock, photos, and items." />
          <DashboardAction href="/vendor-dashboard/earnings" icon={CircleDollarSign} title="View payouts" body="Available, held, and withdrawn money." />
        </section>

        <section className="lx-surface overflow-hidden p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Recent orders</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Latest activity</h2>
            </div>
            <Link href="/vendor-dashboard/orders" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white/70">
              All orders<ArrowRight size={15} />
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-white/75">No recent orders yet</p>
              <p className="mt-1 text-xs text-white/40">Completed and cancelled orders will appear here.</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-white/6">
              {recent.slice(0, 5).map((order) => (
                <RecentOrder key={order.id} order={order} />
              ))}
            </div>
          )}
        </section>

        {summary?.avg_prep_minutes != null && (
          <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3 text-sm text-white/50">
            <Clock3 size={17} className="text-[#F5A623]" />
            Your average kitchen prep time today is <span className="font-semibold text-white/80">{summary.avg_prep_minutes} minutes</span>.
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardAction({ href, icon: Icon, title, body }: { href: string; icon: typeof ArrowRight; title: string; body: string }) {
  return (
    <Link href={href} className="group flex min-h-24 items-center gap-3 rounded-3xl border border-white/8 bg-white/[0.03] p-4 transition hover:-translate-y-0.5 hover:border-white/14 hover:bg-white/[0.055]">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.05] text-[#F5A623]"><Icon size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-white/42">{body}</span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-white/25 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

function RecentOrder({ order }: { order: VendorDashboardRecentOrder }) {
  const items = order.order_items ?? []
  const itemLabel = items.length > 0
    ? items.slice(0, 2).map((item) => `${item.quantity}× ${item.name}`).join(' · ')
    : 'No item summary available'

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{order.order_number}</p>
        <p className="mt-0.5 truncate text-xs text-white/43">{itemLabel}</p>
        <p className="mt-0.5 text-[11px] text-white/30">{new Date(order.created_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="tabular-nums text-sm font-semibold text-white">{formatMoney(order.subtotal)}</p>
        <p className="text-[10px] text-white/35">Your food sale</p>
        <p className="mt-0.5 text-xs font-medium" style={{ color: STATUS_COLOR[order.status] ?? 'rgba(255,255,255,0.4)' }}>{STATUS_LABEL[order.status] ?? order.status}</p>
      </div>
    </div>
  )
}

function getFocus({ storeStatus, pendingOrders, activeOrders }: { storeStatus: string; pendingOrders: number; activeOrders: number }) {
  if (storeStatus !== 'OPEN') return { title: 'Your store is not taking orders', body: 'Open when your kitchen is ready. Customers will immediately see that you are available.', action: 'Open store', href: null }
  if (pendingOrders > 0) return { title: `${pendingOrders} order${pendingOrders === 1 ? '' : 's'} waiting for you`, body: 'A quick response keeps customers confident and helps riders arrive at the right time.', action: 'Review now', href: '/vendor-dashboard/orders' }
  if (activeOrders > 0) return { title: `${activeOrders} active order${activeOrders === 1 ? '' : 's'} in the kitchen`, body: 'Keep each order moving and mark it ready as soon as it is packed.', action: 'Run the queue', href: '/vendor-dashboard/orders' }
  return { title: 'You are open and all caught up', body: 'Nothing needs your attention right now. Keep the menu accurate and we will alert you when an order lands.', action: 'Check your menu', href: '/vendor-dashboard/menu' }
}

function greeting() {
  const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date())
  const value = Number(hour)
  if (value < 12) return 'morning'
  if (value < 17) return 'afternoon'
  return 'evening'
}
