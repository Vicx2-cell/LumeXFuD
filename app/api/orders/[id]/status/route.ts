import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { orderStatusInput } from '@/lib/validators'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'
import { recordOrderCompletedEarnings } from '@/lib/platform-earnings'
import type { OrderStatus } from '@/types'

// Whitelist: [from, to, allowed roles]
const TRANSITIONS: Array<[OrderStatus, OrderStatus, string[]]> = [
  ['PENDING', 'VENDOR_ACCEPTED', ['vendor', 'admin', 'super_admin']],
  ['VENDOR_ACCEPTED', 'PREPARING', ['vendor', 'admin', 'super_admin']],
  ['PREPARING', 'READY', ['vendor', 'admin', 'super_admin']],
  ['READY', 'RIDER_ASSIGNED', ['rider', 'admin', 'super_admin']],
  ['RIDER_ASSIGNED', 'PICKED_UP', ['rider', 'admin', 'super_admin']],
  ['PICKED_UP', 'DELIVERED', ['rider', 'admin', 'super_admin']],
  ['DELIVERED', 'COMPLETED', ['customer', 'admin', 'super_admin']],
  ['PENDING', 'CANCELLED', ['vendor', 'admin', 'super_admin']],
  ['VENDOR_ACCEPTED', 'CANCELLED', ['vendor', 'admin', 'super_admin']],
  ['DISPUTED', 'REFUNDED', ['admin', 'super_admin']],
  ['DISPUTED', 'COMPLETED', ['admin', 'super_admin']],
]

function isTransitionAllowed(from: OrderStatus, to: OrderStatus, role: string): boolean {
  return TRANSITIONS.some(([f, t, roles]) => f === from && t === to && roles.includes(role))
}

const TIMESTAMP_FIELDS: Partial<Record<OrderStatus, string>> = {
  VENDOR_ACCEPTED: 'vendor_accepted_at',
  PREPARING: 'preparing_at',
  READY: 'ready_at',
  RIDER_ASSIGNED: 'rider_assigned_at',
  PICKED_UP: 'picked_up_at',
  DELIVERED: 'delivered_at',
  COMPLETED: 'completed_at',
  CANCELLED: 'cancelled_at',
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = orderStatusInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid status', details: parsed.error.flatten() }, { status: 400 })
  }

  const newStatus = parsed.data.status as OrderStatus
  const db = createSupabaseAdmin()

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, vendor_id, customer_id, rider_id, guest_phone, total_amount, rider_delivery_cut, platform_markup, platform_delivery_cut')
    .eq('id', id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Ownership (BOLA prevention): the transition whitelist gates by ROLE, but a
  // role alone doesn't bind the actor to THIS order — without this, any vendor
  // could accept/cancel another vendor's order, any rider could mark a stranger's
  // order PICKED_UP, and any customer could COMPLETE any DELIVERED order (early
  // rider payout). Admins/super admins are exempt (they act on all orders).
  // Riders reach RIDER_ASSIGNED via the race-safe /accept route, so by the time
  // they hit /status their rider_id is already bound to the row.
  if (session.role !== 'admin' && session.role !== 'super_admin') {
    const ownerId =
      session.role === 'vendor' ? order.vendor_id
      : session.role === 'rider' ? order.rider_id
      : order.customer_id
    if (!ownerId || ownerId !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const currentStatus = order.status as OrderStatus

  if (!isTransitionAllowed(currentStatus, newStatus, session.role)) {
    return NextResponse.json(
      { error: `Transition from ${currentStatus} to ${newStatus} is not allowed for role ${session.role}` },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const timestampField = TIMESTAMP_FIELDS[newStatus]
  const updateData: Record<string, unknown> = {
    status: newStatus,
    updated_at: now,
  }
  if (timestampField) updateData[timestampField] = now

  // When DELIVERED: set 15-min auto-complete window
  if (newStatus === 'DELIVERED') {
    const autoComplete = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    updateData.rider_auto_release_at = autoComplete
  }

  // When COMPLETED: mark rider payment as HELD (will be released by cron after 24h)
  if (newStatus === 'COMPLETED') {
    updateData.rider_payment_status = 'HELD'
  }

  await db.from('orders').update(updateData).eq('id', id)

  // Record platform earnings when order completes (fire-and-forget)
  if (newStatus === 'COMPLETED') {
    void recordOrderCompletedEarnings({
      order_id:             id,
      platform_markup_kobo: (order.platform_markup as number) ?? 0,
      delivery_cut_kobo:    (order.platform_delivery_cut as number) ?? 0,
      order_number:         order.order_number as string,
    })
  }

  // Notifications
  void sendNotificationForStatus(newStatus, order, db).catch(() => {})

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: `order_status_${newStatus.toLowerCase()}`,
    target_table: 'orders',
    target_id: id,
    old_value: { status: currentStatus },
    new_value: { status: newStatus },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, status: newStatus })
}

async function sendNotificationForStatus(
  status: OrderStatus,
  order: Record<string, unknown>,
  db: ReturnType<typeof createSupabaseAdmin>
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const orderNumber = order.order_number as string

  const getCustomerPhone = async (): Promise<string | null> => {
    if (order.guest_phone) return order.guest_phone as string
    if (!order.customer_id) return null
    const { data } = await db.from('customers').select('phone').eq('id', order.customer_id).single()
    return (data?.phone as string) ?? null
  }

  const getVendor = async () => {
    const { data } = await db.from('vendors').select('phone, shop_name, prep_time_minutes').eq('id', order.vendor_id).single()
    return data
  }

  const getRider = async () => {
    if (!order.rider_id) return null
    const { data } = await db.from('riders').select('phone, full_name').eq('id', order.rider_id).single()
    return data
  }

  switch (status) {
    case 'VENDOR_ACCEPTED': {
      const phone = await getCustomerPhone()
      const vendor = await getVendor()
      if (phone && vendor) {
        const eta = new Date(Date.now() + (vendor.prep_time_minutes as number) * 60_000 + 10 * 60_000)
        const etaStr = eta.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('VENDOR_ACCEPTED', {
            vendor_name: vendor.shop_name as string,
            arrival_time: etaStr,
            tracking_url: `${appUrl}/order/${orderNumber}`,
          }),
        })
      }
      break
    }
    case 'RIDER_ASSIGNED': {
      const phone = await getCustomerPhone()
      const rider = await getRider()
      if (phone && rider) {
        const eta = new Date(Date.now() + 15 * 60_000)
        const etaStr = eta.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('RIDER_ASSIGNED', {
            rider_first_name: (rider.full_name as string).split(' ')[0],
            arrival_time: etaStr,
            tracking_url: `${appUrl}/order/${orderNumber}`,
          }),
        })
      }
      break
    }
    case 'PICKED_UP': {
      const phone = await getCustomerPhone()
      const rider = await getRider()
      if (phone && rider) {
        const eta = new Date(Date.now() + 8 * 60_000)
        const etaStr = eta.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('PICKED_UP', {
            rider_first_name: (rider.full_name as string).split(' ')[0],
            arrival_time: etaStr,
            rider_phone: rider.phone as string,
          }),
        })
      }
      break
    }
    case 'DELIVERED': {
      const phone = await getCustomerPhone()
      if (phone) {
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('DELIVERED', {
            confirm_url: `${appUrl}/order/${orderNumber}`,
          }),
        })
      }
      break
    }
    case 'COMPLETED': {
      const rider = await getRider()
      if (rider && order.rider_delivery_cut) {
        await sendWhatsAppWithFallback({
          to: rider.phone as string,
          message: renderTemplate('COMPLETED', {
            amount: Math.round((order.rider_delivery_cut as number) / 100),
            order_number: orderNumber,
            hours: 24,
          }),
        })
      }
      break
    }
    case 'CANCELLED': {
      const phone = await getCustomerPhone()
      if (phone) {
        await sendWhatsAppWithFallback({
          to: phone,
          message: renderTemplate('CANCELLED', {
            order_number: orderNumber,
            cancellation_reason: 'Your order was cancelled.',
          }),
        })
      }
      break
    }
  }
}
