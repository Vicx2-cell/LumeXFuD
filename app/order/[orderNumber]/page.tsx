import { notFound, redirect } from 'next/navigation'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { BottomNav } from '@/components/nav-bottom'
import { OrderStatusClient } from './order-status-client'

export const dynamic = 'force-dynamic'

export default async function OrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params
  const session = await getCurrentUser()

  const db = createSupabaseAdmin()

  const { data: order } = await db
    .from('orders')
    .select(`
      id, order_number, status, payment_status, delivery_type, delivery_address,
      subtotal, platform_markup, delivery_fee, tip_amount, total_amount,
      vendor_accepted_at, preparing_at, ready_at, rider_assigned_at,
      picked_up_at, delivered_at, completed_at, cancelled_at, created_at,
      rider_auto_release_at, customer_id, guest_phone, vendor_id, rider_id,
      vendors ( shop_name, prep_time_minutes ),
      riders ( full_name, phone ),
      order_items ( id, name, price, quantity, subtotal, addons )
    `)
    .eq('order_number', orderNumber)
    .single()

  if (!order) notFound()

  // BOLA/IDOR check. Order numbers are sequential (LXF-2026-XXXXXX) and thus
  // enumerable, so this page must bind the viewer to THIS order — not merely
  // require any session. Previously a guest order rendered to anyone, and any
  // vendor/rider session could read any order by number; both are closed here.
  if (!session) {
    // No public view, even for legacy guest orders — log in and prove ownership.
    redirect(`/auth?next=/order/${orderNumber}`)
  }

  let authorized = false
  if (session.role === 'admin' || session.role === 'super_admin') {
    authorized = true // staff act across all orders
  } else if (session.role === 'customer') {
    const { data: customer } = await db
      .from('customers')
      .select('id')
      .eq('phone', session.phone)
      .single()
    authorized = !!customer && customer.id === order.customer_id
  } else if (session.role === 'vendor') {
    authorized = !!session.userId && session.userId === order.vendor_id
  } else if (session.role === 'rider') {
    authorized = !!session.userId && session.userId === order.rider_id
  }

  if (!authorized) redirect('/')

  return (
    <main className="lx-page pb-24 overflow-hidden">
      <OrderStatusClient order={order as unknown as OrderDetail} />
      <BottomNav />
    </main>
  )
}

export interface OrderDetail {
  id: string
  order_number: string
  status: string
  payment_status: string
  delivery_type: string
  delivery_address: string
  subtotal: number
  platform_markup: number
  delivery_fee: number
  tip_amount: number
  total_amount: number
  vendor_accepted_at: string | null
  preparing_at: string | null
  ready_at: string | null
  rider_assigned_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_at: string
  rider_auto_release_at: string | null
  customer_id: string | null
  guest_phone: string | null
  vendor_id: string
  rider_id: string | null
  vendors: { shop_name: string; prep_time_minutes: number } | null
  riders: { full_name: string; phone: string } | null
  order_items: Array<{ id: string; name: string; price: number; quantity: number; subtotal: number; addons?: { name: string; price_kobo: number }[] }>
}
