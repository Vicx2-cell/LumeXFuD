import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react'
import { BottomNav } from '@/components/nav-bottom'
import { BackButton } from '@/components/back-button'
import { formatPrice, formatDate } from '@/lib/money'
import { resolveOrdersView } from '@/lib/orders-view'
import { ReorderButton } from '@/components/reorder-button'
import { CancelOrderButton } from '@/components/cancel-order-button'
import { VerifiedBadge } from '@/components/verified-badge'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'

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
  SCHEDULED: 'var(--color-amber)',
  COMPLETED: 'var(--lx-green)',
  DELIVERED: 'var(--color-amber)',
  CANCELLED: 'var(--lx-red)',
  REFUNDED: 'var(--lx-violet)',
  DISPUTED: 'var(--lx-warn)',
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
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <BackButton />
          <div>
            <h1 className="text-base font-semibold">Your orders</h1>
            <p className="text-xs text-[var(--lx-text-muted)]">Track active orders or order your favourites again</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {view === 'error' ? (
          <EmptyState
            icon={<ReceiptText size={22} />}
            title="Couldn't load your orders"
            description="Something went wrong on our end. Your orders are safe—please try again."
            action={<Link href="/orders" className="lx-btn-amber inline-flex min-h-11 items-center px-6 py-3 text-sm">Try again</Link>}
          />
        ) : view === 'empty' ? (
          <EmptyState
            icon={<ReceiptText size={22} />}
            title="No orders yet"
            description="Your first order is just a few taps away—find something delicious from a campus vendor."
            action={<Link href="/" className="lx-btn-amber inline-flex min-h-11 items-center px-6 py-3 text-sm">Browse vendors</Link>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lx-stagger">{orders!.map((order) => {
            const vendorRaw = order.vendors
            const vendor = (Array.isArray(vendorRaw) ? vendorRaw[0] : vendorRaw) as { shop_name: string; logo_url: string | null } | null
            const statusColor = STATUS_COLORS[order.status as string] ?? 'rgba(255,255,255,0.4)'

            return (
              <Link
                key={order.id as string}
                href={`/order/${order.order_number}`}
                className="lx-tap lx-surface block p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--lx-border)] bg-[var(--lx-surface-2)] text-[var(--color-amber)]">
                    {vendor?.logo_url ? <Image src={vendor.logo_url} alt="" fill className="object-cover" sizes="44px" /> : <ReceiptText size={18} aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
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
                <div className="mt-4 flex items-end justify-between border-t border-[var(--lx-border)] pt-4">
                  <div>
                  <p className="text-[11px] text-[var(--lx-text-faint)]">{order.delivery_type === 'PICKUP' ? 'Pickup' : 'Delivery'}</p>
                  <p className="mt-1 text-sm text-[var(--lx-text-muted)]">
                    {formatDate(order.created_at as string)}
                  </p>
                  </div>
                  <p className="text-base font-semibold tabular-nums">{formatPrice(order.total_amount as number)}</p>
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
          })}</div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-3 py-4">
            {page > 1 && (
              <Link
                href={`/orders?page=${page - 1}`}
                className="lx-btn-secondary inline-flex min-h-11 items-center gap-1 px-4 py-2 text-sm"
              >
                <ChevronLeft size={15} aria-hidden="true" /> Previous
              </Link>
            )}
            <span className="px-4 py-2 text-sm text-white/40">
              {page} / {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/orders?page=${page + 1}`}
                className="lx-btn-secondary inline-flex min-h-11 items-center gap-1 px-4 py-2 text-sm"
              >
                Next <ChevronRight size={15} aria-hidden="true" />
              </Link>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  )
}
