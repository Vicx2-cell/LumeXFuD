import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import Link from 'next/link'
import { BottomNav } from '@/components/nav-bottom'
import { formatPrice } from '@/lib/money'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Waiting',
  VENDOR_ACCEPTED: 'Confirmed',
  PREPARING: 'Preparing',
  READY: 'Ready',
  RIDER_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'On the way',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
  REFUNDED: 'Refunded',
}

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: '#22c55e',
  DELIVERED: '#F5A623',
  CANCELLED: '#ef4444',
  REFUNDED: '#8b5cf6',
  DISPUTED: '#f97316',
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') redirect('/auth?next=/orders')

  const db = createSupabaseAdmin()
  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('phone', session.phone)
    .single()

  if (!customer) redirect('/')

  const { page: pageStr } = await searchParams
  const page = Math.max(1, parseInt(pageStr ?? '1', 10))
  const PAGE_SIZE = 20
  const offset = (page - 1) * PAGE_SIZE

  const { data: orders, count } = await db
    .from('orders')
    .select(`
      id, order_number, status, total_amount, created_at, delivery_type,
      vendors ( shop_name, logo_url ),
      ratings ( id )
    `, { count: 'exact' })
    .eq('customer_id', customer.id)
    .neq('status', 'PENDING_PAYMENT')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <main className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
      <div className="sticky top-0 z-40 border-b border-white/8 px-4 py-3"
        style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-lg mx-auto">
          <h1 className="font-semibold text-base">Your orders</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {!orders || orders.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">📋</p>
            <p className="font-semibold text-lg">No orders yet</p>
            <p className="text-sm text-white/40 mt-1">Your order history will appear here</p>
            <Link
              href="/"
              className="inline-block mt-6 px-6 py-3 rounded-xl font-medium"
              style={{ background: '#F5A623', color: '#000' }}
            >
              Order food
            </Link>
          </div>
        ) : (
          orders.map((order) => {
            const vendorRaw = order.vendors
            const vendor = (Array.isArray(vendorRaw) ? vendorRaw[0] : vendorRaw) as { shop_name: string; logo_url: string | null } | null
            const hasRating = Array.isArray(order.ratings) && order.ratings.length > 0
            const needsRating = order.status === 'COMPLETED' && !hasRating
            const statusColor = STATUS_COLORS[order.status as string] ?? 'rgba(255,255,255,0.4)'

            return (
              <Link
                key={order.id as string}
                href={`/order/${order.order_number}`}
                className="block rounded-2xl p-4"
                style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-sm">{vendor?.shop_name ?? 'Unknown vendor'}</p>
                    <p className="text-xs text-white/40 mt-0.5">#{order.order_number as string}</p>
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-full font-medium"
                    style={{ background: `${statusColor}18`, color: statusColor }}
                  >
                    {STATUS_LABELS[order.status as string] ?? order.status as string}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-sm text-white/60">
                    {new Date(order.created_at as string).toLocaleDateString('en-NG', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </p>
                  <p className="font-semibold text-sm">{formatPrice(order.total_amount as number)}</p>
                </div>
                {needsRating && (
                  <div className="mt-2 text-xs font-medium" style={{ color: '#F5A623' }}>
                    ★ Rate this order
                  </div>
                )}
                {order.status === 'COMPLETED' && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <button
                      onClick={(e) => e.preventDefault()}
                      className="text-xs text-white/50"
                      aria-label="Reorder"
                    >
                      🔁 Order again
                    </button>
                  </div>
                )}
              </Link>
            )
          })
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-3 py-4">
            {page > 1 && (
              <Link
                href={`/orders?page=${page - 1}`}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'rgba(255,255,255,0.07)' }}
              >
                ← Previous
              </Link>
            )}
            <span className="px-4 py-2 text-sm text-white/40">
              {page} / {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/orders?page=${page + 1}`}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ background: 'rgba(255,255,255,0.07)' }}
              >
                Next →
              </Link>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  )
}
