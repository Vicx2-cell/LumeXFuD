import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { resolveDisputeInput } from '@/lib/validators'
import { refundTransaction } from '@/lib/paystack/transfer'
import { recordPlatformEarning } from '@/lib/platform-earnings'
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

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = resolveDisputeInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, order_number, status, total_amount, payment_status, paystack_reference')
    .eq('id', id)
    .single()

  if (!order || order.status !== 'DISPUTED') {
    return NextResponse.json({ error: 'Order not found or not in DISPUTED state' }, { status: 404 })
  }

  const newStatus = parsed.data.resolution === 'REFUND' ? 'REFUNDED' : 'COMPLETED'
  const now = new Date().toISOString()

  // Resolving in the customer's favour must actually move money — issue the
  // Paystack refund and record a ledger row, not just flip the status.
  if (parsed.data.resolution === 'REFUND' && order.payment_status === 'PAID' && order.paystack_reference) {
    const amountKobo = order.total_amount as number
    let refundOk = true
    try {
      await refundTransaction(order.paystack_reference as string, amountKobo)
    } catch (refundErr) {
      refundOk = false
      console.error(`[disputes/resolve] refund failed for order ${order.id}:`, refundErr)
    }

    await db.from('refunds').insert({
      order_id:                       order.id,
      paystack_transaction_reference: order.paystack_reference,
      amount_kobo:                    amountKobo,
      reason:                         `Dispute resolved for customer${parsed.data.notes ? `: ${parsed.data.notes}` : ''}`,
      status:                         refundOk ? 'PROCESSING' : 'NEEDS_ATTENTION',
      triggered_by:                   session.phone,
    })

    if (refundOk) {
      void recordPlatformEarning({
        type:        'REFUND_COST',
        amount_kobo: -amountKobo,
        order_id:    order.id as string,
        description: `Dispute refund — order ${order.order_number as string}`,
      })
    }
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
