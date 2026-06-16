import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { disputeInput } from '@/lib/validators'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getFeature } from '@/lib/features'
import { runConcierge } from '@/lib/ai/dispute-concierge'
import { lockOrderHolds } from '@/lib/order-payout'

// Customers can report a problem up to 24h after delivery — this deliberately
// covers orders that have already auto-COMPLETED (the old 15-min window meant a
// student who looked an hour later had no recourse). 24h tracks the rider's
// fund-hold, so a refund decision is still financially recoverable.
const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Customer only' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`order-dispute:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = disputeInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const db = createSupabaseAdmin()

  const { data: customer } = await db
    .from('customers')
    .select('id, phone, dispute_count')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, customer_id, delivered_at, vendor_id')
    .eq('id', id)
    .eq('customer_id', customer.id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Allow reports on DELIVERED orders and on ones that have already auto-COMPLETED.
  if (order.status !== 'DELIVERED' && order.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'You can only report a problem on a delivered order' }, { status: 400 })
  }
  if (!order.delivered_at) {
    return NextResponse.json({ error: 'This order has no delivery time on record yet' }, { status: 400 })
  }

  // Window runs from the delivery moment, not from completion.
  const deliveredAt = new Date(order.delivered_at as string).getTime()
  if (Date.now() - deliveredAt > DISPUTE_WINDOW_MS) {
    return NextResponse.json({ error: 'The window to report a problem has closed (24 hours after delivery)' }, { status: 400 })
  }

  await db.from('orders').update({ status: 'DISPUTED', updated_at: new Date().toISOString() }).eq('id', id)

  // Lock any still-held earnings for this order so they can't auto-release while
  // the dispute is open — if it's resolved as a refund, the money is right there
  // to claw back. Already-released funds are covered by freeze + clawback.
  await lockOrderHolds(id).catch(() => {})

  await db.from('disputes').insert({
    order_id: order.id,
    customer_id: customer.id,
    reason: parsed.data.reason,
    description: parsed.data.description ?? null,
    status: 'OPEN',
  })

  // Increment the CUSTOMER's dispute count (was incorrectly read off the order row)
  await db.from('customers').update({
    dispute_count: ((customer.dispute_count as number) ?? 0) + 1,
    last_dispute_at: new Date().toISOString(),
  }).eq('id', customer.id)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lumexfud.com.ng'
  const { data: vendor } = await db.from('vendors').select('shop_name').eq('id', order.vendor_id).single()
  const adminPhone = process.env.ADMIN_PHONE

  if (adminPhone) {
    void sendWhatsAppWithFallback({
      to: adminPhone,
      message: renderTemplate('DISPUTED', {
        order_number: order.order_number as string,
        dispute_reason: parsed.data.reason,
        customer_phone: session.phone.slice(-4).padStart(session.phone.length, '*'),
        vendor_name: (vendor?.shop_name as string) ?? 'Unknown',
        admin_url: `${appUrl}/admin`,
      }),
    }).catch(() => {})
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'dispute_created',
    target_table: 'orders',
    target_id: id,
    new_value: { reason: parsed.data.reason },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  // AI dispute concierge — Lumi replies to the student empathetically and pre-
  // triages the case for the admin (stored on the dispute row). ADVISORY ONLY:
  // this never moves money or changes the order state. Fully degradable — any
  // failure just leaves the customer with the default "we're on it" message.
  let conciergeReply: string | null = null
  if (await getFeature('dispute_concierge')) {
    try {
      const result = await runConcierge(db, order.id as string)
      if (result) {
        conciergeReply = result.customerReply
        await db.from('disputes').update({
          ai_customer_reply: result.customerReply,
          ai_triage: result.brief,
          ai_triaged_at: new Date().toISOString(),
        }).eq('order_id', order.id as string)
      }
    } catch (err) {
      console.error('[dispute] concierge failed:', err)
    }
  }

  return NextResponse.json({ success: true, concierge_reply: conciergeReply })
}
