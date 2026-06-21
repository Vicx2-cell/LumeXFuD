import { notFound, redirect } from 'next/navigation'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/session'
import { getFeature } from '@/lib/features'
import { BottomNav } from '@/components/nav-bottom'
import { OrderStatusClient } from './order-status-client'
import { settleOrderIfDue, type SettleableOrder } from '@/lib/order-settle'

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
      pickup_eta_at, collected_at, no_show_at, delivery_photo_url,
      rider_auto_release_at, scheduled_for, pending_since, wallet_amount_kobo, paystack_reference,
      customer_id, guest_phone, vendor_id, rider_id,
      vendors ( shop_name, prep_time_minutes ),
      riders ( full_name, phone, opening_time, closing_time, avatar_url ),
      order_items ( id, name, price, quantity, subtotal, addons )
    `)
    .eq('order_number', orderNumber)
    .single()

  if (!order) notFound()

  // leave_at_gate is from migration 073 — read it SEPARATELY and non-fatally so the
  // order page never breaks on a DB where 073 hasn't been applied yet (the whole
  // page would otherwise fail because one column in the main select is missing).
  let leaveAtGate = false
  {
    const { data: lag } = await db.from('orders').select('leave_at_gate').eq('id', (order as { id: string }).id).maybeSingle()
    leaveAtGate = !!(lag as { leave_at_gate?: boolean } | null)?.leave_at_gate
  }
  ;(order as { leave_at_gate?: boolean }).leave_at_gate = leaveAtGate

  // Self-healing: if this is a paid order the vendor never accepted in time,
  // cancel + refund it now (doesn't wait on the auto-cancel cron). Reflect the
  // new status in what we render.
  const settledStatus = await settleOrderIfDue(order as unknown as SettleableOrder)
  if (settledStatus) {
    ;(order as { status: string; payment_status: string }).status = settledStatus
    ;(order as { payment_status: string }).payment_status = 'REFUNDED'
  }

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

  // Rating prompt: only the order's customer can rate, and only once. Fetch both
  // the feature flag and whether a review already exists so the client can show
  // the prompt without an extra round-trip.
  const reviewsEnabled = await getFeature('reviews')
  let alreadyRated = false
  if (reviewsEnabled && session.role === 'customer') {
    const { data: existingRating } = await db
      .from('ratings')
      .select('id')
      .eq('order_id', order.id)
      .maybeSingle()
    alreadyRated = !!existingRating
  }
  const canRate = reviewsEnabled && session.role === 'customer'

  // Is the assigned rider fully KYC-verified? (one tiny marker check)
  let riderVerified = false
  if (order.rider_id) {
    try {
      const { data: mk } = await db.storage.from('kyc-faces').createSignedUrl(`complete/${order.rider_id}`, 60)
      riderVerified = !!mk
    } catch { /* not verified */ }
  }

  // Pickup forfeit window (minutes) so the client can render the READY countdown
  // from the server's value. Read the setting directly (avoids importing the heavy
  // pickup lib chain); defaults to 85 (1h25m).
  let pickupHoldMinutes = 85
  if ((order as { delivery_type?: string }).delivery_type === 'PICKUP') {
    const { data: s } = await db.from('settings').select('value').eq('id', 'pickup_hold_minutes').maybeSingle()
    const m = Number((s as { value?: { minutes?: number } } | null)?.value?.minutes)
    if (Number.isFinite(m) && m > 0) pickupHoldMinutes = m
  }

  return (
    <main className="lx-page pb-24 overflow-hidden">
      <OrderStatusClient
        order={order as unknown as OrderDetail}
        canRate={canRate}
        alreadyRated={alreadyRated}
        riderVerified={riderVerified}
        pickupHoldMinutes={pickupHoldMinutes}
      />
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
  pickup_eta_at: string | null
  leave_at_gate: boolean | null
  delivery_photo_url: string | null
  collected_at: string | null
  no_show_at: string | null
  created_at: string
  rider_auto_release_at: string | null
  scheduled_for: string | null
  customer_id: string | null
  guest_phone: string | null
  vendor_id: string
  rider_id: string | null
  vendors: { shop_name: string; prep_time_minutes: number } | null
  riders: { full_name: string; phone: string; opening_time: string | null; closing_time: string | null; avatar_url: string | null } | null
  order_items: Array<{ id: string; name: string; price: number; quantity: number; subtotal: number; addons?: { name: string; price_kobo: number }[] }>
}
