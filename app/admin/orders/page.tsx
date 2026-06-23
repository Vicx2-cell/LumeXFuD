'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Pill } from '@/components/ui/pill'

interface OrderRow {
  id: string
  order_number: string
  status: string
  delivery_type: string
  total_amount: number
  platform_markup: number
  platform_delivery_cut: number
  created_at: string
  vendors: { shop_name: string } | null
  customers: { name: string | null; phone: string } | null
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
  const router = useRouter()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  async function fetchOrders(p: number, filter: string) {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p) })
    if (filter) params.set('status', filter)
    const res = await fetch(`/api/admin/orders?${params}`)
    if (res.ok) {
      const d = await res.json() as { orders: OrderRow[]; page: number }
      setOrders(d.orders)
      setHasMore(d.orders.length === 50)
    }
    setLoading(false)
  }

  useEffect(() => {
    setPage(1)
    fetchOrders(1, statusFilter)
  }, [statusFilter])

  return (
    <div className="lx-page px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.back()} aria-label="Go back" className="w-11 h-11 rounded-full flex items-center justify-center text-white/50"
            style={{ background: 'rgba(255,255,255,0.06)' }}>←</button>
          <h1 className="text-xl font-bold text-white">Orders</h1>
        </div>

        {/* Status filter */}
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
          <div className="text-center py-16 text-white/30 text-sm">No orders found</div>
        ) : (
          <>
            <div className="space-y-2">
              {orders.map((o) => (
                <div key={o.id} className="glass-thin rounded-2xl px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white truncate">{o.order_number}</p>
                      <Badge className="shrink-0" color={STATUS_COLORS[o.status] ?? '#999'}>
                        {o.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-white/40 mt-0.5 truncate">
                      {o.vendors?.shop_name ?? '—'} → {o.customers?.name ?? o.customers?.phone ?? '—'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-white">{formatPrice(o.total_amount)}</p>
                    <p className="text-xs text-white/30">{new Date(o.created_at).toLocaleDateString('en-NG')}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center gap-4 mt-5">
              <button onClick={() => { const p = page - 1; setPage(p); fetchOrders(p, statusFilter) }}
                disabled={page === 1}
                className="px-4 py-2 rounded-xl text-sm disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}>← Prev</button>
              <span className="text-sm text-white/40">Page {page}</span>
              <button onClick={() => { const p = page + 1; setPage(p); fetchOrders(p, statusFilter) }}
                disabled={!hasMore}
                className="px-4 py-2 rounded-xl text-sm disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}>Next →</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
