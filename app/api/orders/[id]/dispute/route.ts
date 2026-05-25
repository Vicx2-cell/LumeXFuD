import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { disputeInput } from '@/lib/validators'
import { audit } from '@/lib/audit'
import { sendWhatsAppWithFallback } from '@/lib/termii/whatsapp'
import { renderTemplate } from '@/lib/termii/templates'

const DISPUTE_WINDOW_MS = 15 * 60 * 1000

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Customer only' }, { status: 403 })
  }

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
    .select('id, phone')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: order, error } = await db
    .from('orders')
    .select('id, order_number, status, customer_id, delivered_at, vendor_id, dispute_count')
    .eq('id', id)
    .eq('customer_id', customer.id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'DELIVERED') return NextResponse.json({ error: 'Order must be in DELIVERED status to dispute' }, { status: 400 })

  // Check 15-minute window
  const deliveredAt = new Date(order.delivered_at as string).getTime()
  if (Date.now() - deliveredAt > DISPUTE_WINDOW_MS) {
    return NextResponse.json({ error: 'Dispute window has closed (15 minutes after delivery)' }, { status: 400 })
  }

  await db.from('orders').update({ status: 'DISPUTED', updated_at: new Date().toISOString() }).eq('id', id)

  await db.from('disputes').insert({
    order_id: order.id,
    customer_id: customer.id,
    reason: parsed.data.reason,
    description: parsed.data.description ?? null,
    status: 'OPEN',
  })

  // Increment dispute count
  await db.from('customers').update({ dispute_count: ((order.dispute_count as number) ?? 0) + 1 }).eq('id', customer.id)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
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

  return NextResponse.json({ success: true })
}
