'use client'

import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { formatPrice } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Pill } from '@/components/ui/pill'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { GlassSheen } from '@/components/fx'

interface OrderRow {
  id: string
  order_number: string
  status: string
  delivery_type: string
  total_amount: number
  platform_markup: number
  platform_delivery_cut: number
  payment_status: string
  rider_payment_status: string
  paystack_reference: string | null
  created_at: string
  updated_at: string
  vendors: { shop_name: string } | null
  customers: { name: string | null; phone: string } | null
  riders: { full_name: string | null; phone: string } | null
}

interface TimelineEvent {
  at: string
  type: string
  label: string
  detail?: Record<string, unknown>
}

interface OrderDetail {
  order: OrderRow
  items: Array<{ id: string; name: string; quantity: number; subtotal: number }>
  disputes: Array<Record<string, unknown>>
  refunds: Array<Record<string, unknown>>
  wallet_transactions: Array<Record<string, unknown>>
  customer_wallet_transactions: Array<Record<string, unknown>>
  webhooks: Array<Record<string, unknown>>
  timeline: TimelineEvent[]
}

const ALL_STATUSES = [
  '', 'PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY',
  'RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'COMPLETED',
  'CANCELLED', 'DISPUTED', 'REFUNDED',
]

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#F5A623',
  VENDOR_ACCEPTED: '#60A5FA',
  PREPARING: '#A78BFA',
  READY: '#34D399',
  RIDER_ASSIGNED: '#22C55E',
  PICKED_UP: '#4ADE80',
  DELIVERED: '#86EFAC',
  COMPLETED: '#22C55E',
  CANCELLED: '#EF4444',
  DISPUTED: '#F97316',
  REFUNDED: '#FB923C',
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [selected, setSelected] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  async function fetchOrders(p: number, filter: string, q: string) {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), limit: '30' })
    if (filter) params.set('status', filter)
    if (q.trim()) params.set('q', q.trim())
    const res = await fetch(`/api/admin/orders?${params}`)
    if (res.ok) {
      const d = await res.json() as { orders: OrderRow[]; page: number; limit: number }
      setOrders(d.orders)
      setHasMore(d.orders.length === d.limit)
    }
    setLoading(false)
  }

  async function fetchDetail(orderId: string) {
    setDetailLoading(true)
    const res = await fetch(`/api/admin/orders?order_id=${encodeURIComponent(orderId)}`)
    if (res.ok) setSelected(await res.json() as OrderDetail)
    setDetailLoading(false)
  }

  useEffect(() => {
    setPage(1)
    const timeout = window.setTimeout(() => fetchOrders(1, statusFilter, search), 250)
    return () => window.clearTimeout(timeout)
  }, [statusFilter, search])

  return (
    <div className="lx-page lx-console px-4 py-8 overflow-hidden">
      <GlassSheen />
      <div className="relative z-10 mx-auto max-w-3xl">
        <PageHeader title="Orders" badge="Admin" />

        <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <Search size={16} className="shrink-0 text-white/45" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, phone, vendor, rider, payment ref"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="grid h-7 w-7 place-items-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="flex gap-2 flex-wrap mb-5">
          {ALL_STATUSES.map((s) => (
            <Pill
              key={s || 'all'}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className="px-3 py-1.5 text-xs"
            >
              {s || 'All'}
            </Pill>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-2xl lx-skeleton" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState title="No orders found" description="Try another status, phone number, vendor, rider, or payment reference." />
        ) : (
          <>
            <div className="space-y-2">
              {orders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => fetchDetail(o.id)}
                  className="lx-surface w-full rounded-2xl px-4 py-3 text-left flex items-center gap-3 transition hover:border-white/20"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white truncate">{o.order_number}</p>
                      <Badge className="shrink-0" color={STATUS_COLORS[o.status] ?? '#999'}>
                        {o.status}
                      </Badge>
                      <span className="text-[11px] uppercase tracking-wide text-white/35">{o.payment_status}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-0.5 truncate">
                      {o.vendors?.shop_name ?? '-'} to {o.customers?.name ?? o.customers?.phone ?? '-'}
                    </p>
                    <p className="text-[11px] text-white/30 mt-0.5 truncate">
                      Rider: {o.riders?.full_name ?? o.riders?.phone ?? 'Unassigned'} | Ref: {o.paystack_reference ?? '-'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-white lx-nums">{formatPrice(o.total_amount)}</p>
                    <p className="text-xs text-white/30 lx-nums">{new Date(o.created_at).toLocaleDateString('en-NG')}</p>
                  </div>
                </button>
              ))}
            </div>

            {selected && (
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">{selected.order.order_number}</h2>
                    <p className="mt-1 text-xs text-white/45">
                      {selected.order.vendors?.shop_name ?? '-'} to {selected.order.customers?.name ?? selected.order.customers?.phone ?? '-'}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white"
                    aria-label="Close order detail"
                  >
                    <X size={16} />
                  </button>
                </div>

                {detailLoading ? (
                  <div className="mt-4 h-24 rounded-xl lx-skeleton" />
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                      <div><span className="text-white/35">Payment</span><p className="text-white">{selected.order.payment_status}</p></div>
                      <div><span className="text-white/35">Rider pay</span><p className="text-white">{selected.order.rider_payment_status}</p></div>
                      <div><span className="text-white/35">Items</span><p className="text-white">{selected.items.length}</p></div>
                      <div><span className="text-white/35">Refunds</span><p className="text-white">{selected.refunds.length}</p></div>
                    </div>

                    <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-white/45">Timeline</h3>
                    <div className="mt-3 space-y-2">
                      {selected.timeline.length === 0 ? (
                        <p className="text-xs text-white/40">No timeline evidence found for this order.</p>
                      ) : selected.timeline.map((event, index) => (
                        <div key={`${event.at}-${event.type}-${index}`} className="flex gap-3 text-xs">
                          <time className="w-24 shrink-0 text-white/35 lx-nums">
                            {new Date(event.at).toLocaleString('en-NG', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </time>
                          <div className="min-w-0 flex-1">
                            <p className="text-white">{event.label}</p>
                            <p className="truncate text-white/35">{event.type}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center justify-center gap-4 mt-5">
              <button
                onClick={() => { const p = page - 1; setPage(p); fetchOrders(p, statusFilter, search) }}
                disabled={page === 1}
                className="px-4 py-2 rounded-xl text-sm disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
              >
                Prev
              </button>
              <span className="text-sm text-white/40">Page {page}</span>
              <button
                onClick={() => { const p = page + 1; setPage(p); fetchOrders(p, statusFilter, search) }}
                disabled={!hasMore}
                className="px-4 py-2 rounded-xl text-sm disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
