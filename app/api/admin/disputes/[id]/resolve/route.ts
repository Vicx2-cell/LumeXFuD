import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { resolveDisputeInput } from '@/lib/validators'
import { refundOrderPayments } from '@/lib/order-refund'
import { completeOrderPayout, unlockOrderHolds } from '@/lib/order-payout'
import { reverseOrderPayout } from '@/lib/wallet'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { requireStepUpForAmount } from '@/lib/step-up'
import { audit } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`dispute-resolve:${session.phone}`, 20, 300)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = resolveDisputeInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, order_number, status, total_amount, payment_status, paystack_reference, customer_id, wallet_amount_kobo, rider_id, vendor_id, subtotal, rider_delivery_cut, tip_amount')
    .eq('id', id)
    .single()

  if (!order || order.status !== 'DISPUTED') {
    return NextResponse.json({ error: 'Order not found or not in DISPUTED state' }, { status: 404 })
  }

  // Rule #28: resolving in the customer's favour moves real money (refund +
  // payout reversal). Require fresh-PIN re-auth on the refund branch — same
  // control as paystack/refund and wallet-adjust.
  if (parsed.data.resolution === 'REFUND') {
    const reauthPin = (body as Record<string, unknown> | null)?.reauth_pin
    const stepUp = await requireStepUpForAmount(session, order.total_amount as number, reauthPin)
    if (!stepUp.ok) {
      return NextResponse.json({ error: stepUp.error, reauth_required: true }, { status: stepUp.status })
    }
  }

  const newStatus = parsed.data.resolution === 'REFUND' ? 'REFUNDED' : 'COMPLETED'
  const now = new Date().toISOString()

  // Resolving in the customer's favour must actually move money — refund both
  // sources the order was paid from (wallet portion to wallet, card portion via
  // Paystack), not just flip the status.
  if (parsed.data.resolution === 'REFUND' && order.payment_status === 'PAID') {
    await refundOrderPayments({
      order: {
        id:                 order.id as string,
        order_number:       order.order_number as string,
        customer_id:        order.customer_id as string | null,
        total_amount:       order.total_amount as number,
        wallet_amount_kobo: (order.wallet_amount_kobo as number) ?? 0,
        paystack_reference: order.paystack_reference as string | null,
      },
      reason:      `Dispute resolved for customer${parsed.data.notes ? `: ${parsed.data.notes}` : ''}`,
      triggeredBy: session.phone,
    })
  }

  // A refund must also reverse what the rider/vendor were paid for this order —
  // otherwise the customer is refunded AND the rider/vendor keep the money (the
  // platform pays twice). Pulls it back from held funds first, then available;
  // anything already withdrawn becomes a debt repaid by their future earnings.
  // Safe even if the order was never credited (no-op). Runs for REFUND only.
  if (parsed.data.resolution === 'REFUND') {
    await reverseOrderPayout(order.id as string)
  }

  await db.from('orders').update({
    status:         newStatus,
    payment_status: parsed.data.resolution === 'REFUND' ? 'REFUNDED' : undefined,
    updated_at:     now,
  }).eq('id', id)

  await db.from('disputes').update({
    status:      parsed.data.resolution === 'REFUND' ? 'RESOLVED_REFUND' : 'RESOLVED_NO_ACTION',
    resolved_by: session.phone,
    resolved_at: now,
  }).eq('order_id', id)

  // A disputed order never hits the normal COMPLETED → payout path, so the rider
  // was left stuck BUSY (active_order_id was never cleared) — this is the
  // "rider still shows busy after a refund" bug. Resolve it here:
  //  - NO_ACTION (vendor favour → COMPLETED): pay vendor + rider AND free the rider
  //  - REFUND (customer favour → REFUNDED): free the rider, but no payout
  if (parsed.data.resolution === 'NO_ACTION') {
    await completeOrderPayout({
      id:                 order.id as string,
      order_number:       order.order_number as string,
      vendor_id:          (order.vendor_id as string | null) ?? null,
      rider_id:           (order.rider_id as string | null) ?? null,
      subtotal:           Number(order.subtotal) || 0,
      rider_delivery_cut: Number(order.rider_delivery_cut) || 0,
      tip_amount:         Number(order.tip_amount) || 0,
    })
    // If the order had already been credited before the dispute, its holds were
    // locked (release_at pushed out) when the problem was reported — release them
    // now that it's resolved in the vendor/rider's favour.
    await unlockOrderHolds(order.id as string).catch(() => {})
  } else if (order.rider_id) {
    await db.from('riders')
      .update({ active_order_id: null, status: 'ONLINE', last_status_update_at: now })
      .eq('id', order.rider_id as string)
      .eq('active_order_id', order.id as string)
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: `dispute_resolved_${parsed.data.resolution.toLowerCase()}`,
    target_table: 'orders',
    target_id: id,
    old_value: { status: 'DISPUTED' },
    new_value: { status: newStatus, notes: parsed.data.notes },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, new_status: newStatus })
}
