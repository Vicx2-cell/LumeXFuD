import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import Link from 'next/link'
import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { formatPrice, formatDate } from '@/lib/money'
import { resolveOrdersView } from '@/lib/orders-view'
import { ReorderButton } from '@/components/reorder-button'
import { CancelOrderButton } from '@/components/cancel-order-button'
import { VerifiedBadge } from '@/components/verified-badge'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Scheduled',
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
  SCHEDULED: '#F5A623',
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

  const { data: orders, count, error } = await db
    .from('orders')
    .select(`
      id, order_number, status, total_amount, created_at, delivery_type, vendor_id,
      vendors ( shop_name, logo_url )
    `, { count: 'exact' })
    .eq('customer_id', customer.id)
    .neq('status', 'PENDING_PAYMENT')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  // Which of these vendors are fully KYC-verified (one cheap storage call).
  let verifiedVendors = new Set<string>()
  try {
    const { data: marks } = await db.storage.from('kyc-faces').list('complete', { limit: 1000 })
    verifiedVendors = new Set((marks ?? []).map((m) => m.name))
  } catch { /* no markers — no badges */ }

  const view = resolveOrdersView(orders, error)
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <main className="lx-page pb-24">
      <div className="lx-topbar sticky top-0 z-40 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <BackButton />
          <h1 className="font-semibold text-base">Your orders</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3 lx-stagger">
        {view === 'error' ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">⚠️</p>
            <p className="font-semibold text-lg">Couldn&apos;t load your orders</p>
            <p className="text-sm text-white/40 mt-1">Something went wrong on our end. Your orders are safe — please try again.</p>
            <Link href="/orders" className="lx-btn-amber inline-block mt-6 px-6 py-3">
              Try again
            </Link>
          </div>
        ) : view === 'empty' ? (
          <div className="text-center py-20 px-6">
            <p className="text-5xl mb-4">🍽️</p>
            <p className="font-semibold text-lg">No orders yet</p>
            <p className="text-sm text-white/55 mt-1.5 max-w-xs mx-auto">Your first order is just a few taps away — find something delicious from a campus vendor.</p>
            <Link href="/" className="lx-btn-amber inline-block mt-6 px-6 py-3.5">
              Browse vendors
            </Link>
          </div>
        ) : (
          orders!.map((order) => {
            const vendorRaw = order.vendors
            const vendor = (Array.isArray(vendorRaw) ? vendorRaw[0] : vendorRaw) as { shop_name: string; logo_url: string | null } | null
            const statusColor = STATUS_COLORS[order.status as string] ?? 'rgba(255,255,255,0.4)'

            return (
              <Link
                key={order.id as string}
                href={`/order/${order.order_number}`}
                className="lx-tap glass-thin block rounded-2xl p-4"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-sm flex items-center gap-1.5">
                      {vendor?.shop_name ?? 'Unknown vendor'}
                      {order.vendor_id && verifiedVendors.has(order.vendor_id as string) && <VerifiedBadge kind="vendor" />}
                    </p>
                    <p className="text-xs text-white/40 mt-0.5">#{order.order_number as string}</p>
                  </div>
                  <Badge color={statusColor}>
                    {STATUS_LABELS[order.status as string] ?? order.status as string}
                  </Badge>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-sm text-white/60">
                    {formatDate(order.created_at as string)}
                  </p>
                  <p className="font-semibold text-sm">{formatPrice(order.total_amount as number)}</p>
                </div>
                {(order.status === 'COMPLETED' || order.status === 'CANCELLED') && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    {/* Client island: rebuilds the cart from this order. preventDefault
                        inside stops the surrounding card <Link> from also navigating. */}
                    <ReorderButton orderId={order.id as string} />
                  </div>
                )}
                {/* Cancel — only before the vendor accepts (PENDING / scheduled). */}
                {(order.status === 'PENDING' || order.status === 'SCHEDULED') && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <CancelOrderButton orderId={order.id as string} />
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
