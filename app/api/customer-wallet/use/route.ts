import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { spendCustomerWallet, formatPrice } from '@/lib/customer-wallet'
import { z } from 'zod'
import crypto from 'crypto'

// POST /api/customer-wallet/use
// Called internally during checkout to deduct wallet balance for an order.
// Body: { order_id, order_number, amount_kobo }
// Returns: { success, new_balance_kobo, new_balance_formatted }

const schema = z.object({
  order_id:     z.string().uuid(),
  order_number: z.string(),
  amount_kobo:  z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'customer') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
  }

  const { order_id, order_number, amount_kobo } = parsed.data
  const db = createSupabaseAdmin()

  // Resolve customer UUID
  const { data: cust } = await db
    .from('customers')
    .select('id')
    .eq('phone', session.phone)
    .maybeSingle()
  const customerId = (cust as { id: string } | null)?.id
  if (!customerId) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  // Verify order belongs to this customer (BOLA prevention)
  const { data: ord } = await db
    .from('orders')
    .select('id, customer_id, status')
    .eq('id', order_id)
    .maybeSingle()
  const order = ord as { id: string; customer_id: string; status: string } | null

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (order.customer_id !== customerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (order.status !== 'PENDING') {
    return NextResponse.json({ error: 'Order is not in PENDING state' }, { status: 400 })
  }

  const reference = `CWUSE-${order_id.slice(0, 8)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`

  const result = await spendCustomerWallet({
    customerId,
    amountKobo: amount_kobo,
    orderId:    order_id,
    orderNumber: order_number,
    reference,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.errorMsg ?? 'Wallet deduction failed' }, { status: 400 })
  }

  return NextResponse.json({
    success:                true,
    new_balance_kobo:       result.newBalance,
    new_balance_formatted:  formatPrice(result.newBalance),
  })
}
