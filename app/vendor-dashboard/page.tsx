'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Clock3, Share2, Store, UtensilsCrossed } from 'lucide-react'
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
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 sm:pt-7">
        <PageHeader
          title={vendor?.shop_name ?? 'Store'}
          actions={
            <div className="flex items-center gap-2">
              <Link href="/vendor-dashboard/share" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm font-semibold text-white/80 hover:bg-white/[0.04]">
                <Share2 size={16} /> <span className="hidden sm:inline">Share store</span>
              </Link>
              <LogoutButton />
            </div>
          }
        />
      </div>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        <section className="border-b border-white/10 pb-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={storeStatus === 'OPEN' ? 'var(--lx-green)' : storeStatus === 'BUSY' ? 'var(--color-amber)' : 'rgba(255,255,255,0.45)'}>
                  {storeStatus === 'OPEN' ? 'Taking orders' : storeStatus === 'BUSY' ? 'Paused' : 'Store closed'}
                </Badge>
                {vendor?.pickup_enabled && <span className="text-xs font-medium text-white/45">Pickup enabled</span>}
              </div>
              <h2 className="mt-3 text-xl font-semibold text-white">{focus.title}</h2>
              <p className="mt-1 max-w-2xl text-sm text-white/50">{focus.body}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {focus.href && (
                <Link href={focus.href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#F5A623] px-4 text-sm font-bold text-black">
                  {focus.action}<ArrowRight size={17} />
                </Link>
              )}
              <button
                type="button"
                disabled={statusBusy}
                onClick={() => void updateStoreStatus(storeStatus === 'OPEN' ? 'CLOSED' : 'OPEN')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold text-white/75 disabled:opacity-60"
              >
                <Store size={17} />
                {statusBusy ? 'Saving…' : storeStatus === 'OPEN' ? 'Close store' : 'Open store'}
              </button>
            </div>
          </div>
          {statusError && <p className="mt-3 text-xs text-red-300">{statusError}</p>}
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Food sales today" value={formatMoney(salesToday)} sub="Your menu subtotal only" status={salesToday > 0 ? 'ok' : 'none'} href="/vendor-dashboard/earnings" />
          <StatCard label="New orders" value={pendingOrders} sub={pendingOrders > 0 ? 'Waiting for your response' : 'Nothing waiting'} status={pendingOrders > 0 ? 'warn' : 'none'} href="/vendor-dashboard/orders" />
          <StatCard label="Active kitchen" value={activeOrders} sub="Accepted through handoff" status={activeOrders > 0 ? 'ok' : 'none'} href="/vendor-dashboard/orders" />
          <StatCard label="Completed today" value={completedToday} sub={`${summary?.orders_today ?? 0} total order${(summary?.orders_today ?? 0) === 1 ? '' : 's'} today`} status={completedToday > 0 ? 'ok' : 'none'} href="/vendor-dashboard/orders" />
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <DashboardAction href="/vendor-dashboard/orders" icon={ArrowRight} title="Run the queue" body="Accept and move orders through prep." />
          <DashboardAction href="/vendor-dashboard/menu" icon={UtensilsCrossed} title="Update menu" body="Prices, stock, photos, and items." />
          <DashboardAction href="/vendor-dashboard/share" icon={Share2} title="Share your store" body="Copy the customer storefront link or send it on WhatsApp." />
        </section>

        <section className="border-y border-white/10 py-4 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/38">Recent orders</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Latest activity</h2>
            </div>
            <Link href="/vendor-dashboard/orders" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#F5A623]">
              All orders <ArrowRight size={15} />
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
          <div className="flex items-center gap-3 border-t border-white/10 pt-4 text-sm text-white/50">
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
    <Link href={href} className="group flex min-h-24 items-center gap-3 rounded-lg border border-white/10 px-4 transition hover:border-white/20 hover:bg-white/[0.03]">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 text-[#F5A623]"><Icon size={18} /></span>
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
