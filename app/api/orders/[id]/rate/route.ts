import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { ratingInput } from '@/lib/validators'
import { awardXP } from '@/lib/gamification'
import { audit } from '@/lib/audit'

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

  const parsed = ratingInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid rating data', details: parsed.error.flatten() }, { status: 400 })
  }

  const db = createSupabaseAdmin()

  const { data: customer } = await db
    .from('customers')
    .select('id')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: order, error } = await db
    .from('orders')
    .select('id, status, customer_id, vendor_id, rider_id')
    .eq('id', id)
    .eq('customer_id', customer.id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status !== 'COMPLETED') return NextResponse.json({ error: 'Order must be COMPLETED to rate' }, { status: 400 })

  // Idempotency: reject if already rated
  const { data: existing } = await db
    .from('ratings')
    .select('id')
    .eq('order_id', id)
    .single()

  if (existing) return NextResponse.json({ error: 'Order already rated' }, { status: 400 })

  const { vendor_rating, vendor_review, rider_rating, rider_review, would_order_again } = parsed.data
  const flagged = vendor_rating < 3 || (order.rider_id && rider_rating < 3)

  await db.from('ratings').insert({
    order_id: id,
    customer_id: customer.id,
    vendor_id: order.vendor_id,
    rider_id: order.rider_id ?? null,
    vendor_rating,
    vendor_review: vendor_review ?? null,
    rider_rating: order.rider_id ? rider_rating : null,
    rider_review: order.rider_id ? (rider_review ?? null) : null,
    would_order_again: would_order_again ?? null,
    flagged_for_review: !!flagged,
  })

  // Recalculate vendor average
  const { data: vendorRatings } = await db
    .from('ratings')
    .select('vendor_rating')
    .eq('vendor_id', order.vendor_id as string)

  if (vendorRatings && vendorRatings.length > 0) {
    const total = vendorRatings.length
    const sum = vendorRatings.reduce((a: number, r: { vendor_rating: number }) => a + r.vendor_rating, 0)
    await db
      .from('vendors')
      .update({ avg_rating: parseFloat((sum / total).toFixed(1)), total_ratings: total, updated_at: new Date().toISOString() })
      .eq('id', order.vendor_id)
  }

  // Recalculate rider average if applicable
  if (order.rider_id && rider_rating) {
    const { data: riderRatings } = await db
      .from('ratings')
      .select('rider_rating')
      .eq('rider_id', order.rider_id as string)
      .not('rider_rating', 'is', null)

    if (riderRatings && riderRatings.length > 0) {
      const total = riderRatings.length
      const sum = riderRatings.reduce((a: number, r: { rider_rating: number }) => a + r.rider_rating, 0)
      await db
        .from('riders')
        .update({ avg_rating: parseFloat((sum / total).toFixed(1)), total_ratings: total, updated_at: new Date().toISOString() })
        .eq('id', order.rider_id)
    }
  }

  // Award XP for rating
  void awardXP(customer.id as string, 'RATING_SUBMITTED').catch(() => {})

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'rating_submitted',
    target_table: 'orders',
    target_id: id,
    new_value: { vendor_rating, rider_rating: order.rider_id ? rider_rating : null, flagged },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
