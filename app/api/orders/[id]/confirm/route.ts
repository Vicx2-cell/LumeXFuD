import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'
import { rateLimitGeneric } from '@/lib/rate-limit'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Customer only' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`order-confirm:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()

  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, customer_id, rider_id, rider_delivery_cut')
    .eq('id', id)
    .eq('customer_id', customer.id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'DELIVERED') {
    return NextResponse.json({ error: 'Order must be in DELIVERED status to confirm' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { data: completedRows } = await db
    .from('orders')
    .update({
      status: 'COMPLETED',
      completed_at: now,
      rider_payment_status: 'HELD',
      rider_auto_release_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'DELIVERED') // optimistic lock — ignore a concurrent double-confirm
    .select('id')

  if (!completedRows || completedRows.length === 0) {
    return NextResponse.json({ success: true }) // already completed concurrently
  }

  // Notify rider
  if (order.rider_id) {
    const { data: rider } = await db
      .from('riders')
      .select('phone')
      .eq('id', order.rider_id)
      .single()

    if (rider) {
      void sendWhatsAppWithFallback({
        to: rider.phone as string,
        message: renderTemplate('COMPLETED', {
          amount: Math.round((order.rider_delivery_cut as number) / 100),
          order_number: order.order_number as string,
          hours: 24,
        }),
      }).catch(() => {})
    }
  }

  return NextResponse.json({ success: true })
}
