import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { ratingInput } from '@/lib/validators'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { getFeature } from '@/lib/features'

// POST /api/orders/[id]/rate
// Customer rates the vendor after their order, with an optional public review.
// One rating per order; immutable once submitted. A DB trigger keeps the
// vendor's denormalized avg_rating / total_ratings in sync (see migration 043).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!(await getFeature('reviews'))) {
    return NextResponse.json({ error: 'Reviews are currently turned off' }, { status: 403 })
  }

  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') {
    return NextResponse.json({ error: 'Customer only' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`order-rate:${session.userId ?? session.phone}`, 30, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = ratingInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const db = createSupabaseAdmin()

  // Bind the rating to THIS customer (BOLA prevention) and snapshot their first
  // name for public display.
  const { data: customer } = await db
    .from('customers')
    .select('id, name')
    .eq('phone', session.phone)
    .single()

  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const { data: order, error } = await db
    .from('orders')
    .select('id, status, vendor_id, rider_id, customer_id')
    .eq('id', id)
    .eq('customer_id', customer.id)
    .single()

  if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // You can only rate an order whose food actually arrived. DELIVERED and the
  // auto-completed COMPLETED both qualify; an open dispute hides the prompt.
  if (order.status !== 'DELIVERED' && order.status !== 'COMPLETED') {
    return NextResponse.json({ error: 'You can only rate an order after it is delivered' }, { status: 400 })
  }

  // Idempotency: one rating per order, no edits.
  const { data: existing } = await db
    .from('ratings')
    .select('id')
    .eq('order_id', order.id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'You have already reviewed this order' }, { status: 409 })
  }

  const review = parsed.data.review && parsed.data.review.length > 0 ? parsed.data.review : null
  const firstName = ((customer.name as string | null) ?? '').trim().split(/\s+/)[0] || null

  // Rider rating is only recorded if the order actually had a rider AND the
  // customer rated them. Otherwise both rider fields stay null.
  const hasRider = !!order.rider_id
  const riderStars = hasRider && parsed.data.rider_stars ? parsed.data.rider_stars : null
  const riderReview = riderStars && parsed.data.rider_review && parsed.data.rider_review.length > 0
    ? parsed.data.rider_review
    : null

  const { error: insErr } = await db.from('ratings').insert({
    order_id:      order.id,
    customer_id:   customer.id,
    vendor_id:     order.vendor_id,
    stars:         parsed.data.stars,
    review,
    reviewer_name: firstName,
    rider_id:      riderStars ? order.rider_id : null,
    rider_stars:   riderStars,
    rider_review:  riderReview,
  })

  if (insErr) {
    // Unique violation = a concurrent submit landed first; treat as already done.
    if (insErr.code === '23505') {
      return NextResponse.json({ error: 'You have already reviewed this order' }, { status: 409 })
    }
    console.error('[order/rate] insert failed:', insErr.message)
    return NextResponse.json({ error: 'Could not save your review. Please try again.' }, { status: 500 })
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'vendor_rated',
    target_table: 'ratings',
    target_id: order.id,
    new_value: { stars: parsed.data.stars, has_review: review !== null, rider_stars: riderStars, has_rider_review: riderReview !== null },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
