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
      order_items ( id, name, price, quantity, subtotal ),
      ratings ( id )
    `)
    .eq('order_number', orderNumber)
    .single()

  if (!order) notFound()

  // BOLA check: customer must own this order (or admin)
  if (session) {
    if (session.role === 'customer') {
      const { data: customer } = await db
        .from('customers')
        .select('id')
        .eq('phone', session.phone)
        .single()
      if (!customer || customer.id !== order.customer_id) {
        redirect('/')
      }
    }
  } else if (!order.guest_phone) {
    redirect(`/auth?next=/order/${orderNumber}`)
  }

  return (
    <main className="min-h-dvh pb-24" style={{ background: '#0A0A0B' }}>
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
  order_items: Array<{ id: string; name: string; price: number; quantity: number; subtotal: number }>
  ratings: Array<{ id: string }> | null
}
