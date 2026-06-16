import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

// DELETE /api/admin/reviews/[id] — remove an abusive / fake review. The DB
// trigger (migration 043) recalculates the vendor's avg_rating / total_ratings
// automatically on delete, so the public average self-corrects. Admin +
// super_admin only; the removed review is preserved in the audit log.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`review-delete:${session.phone}`, 30, 300)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const db = createSupabaseAdmin()

  // Snapshot the row for the audit trail before it's gone.
  const { data: review } = await db
    .from('ratings')
    .select('id, order_id, customer_id, vendor_id, stars, review')
    .eq('id', id)
    .single()

  if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 })

  const { error: delErr } = await db.from('ratings').delete().eq('id', id)
  if (delErr) {
    console.error('[admin/reviews] delete failed:', delErr.message)
    return NextResponse.json({ error: 'Could not delete the review. Please try again.' }, { status: 500 })
  }

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'review_deleted',
    target_table: 'ratings',
    target_id: id,
    old_value: {
      order_id:    review.order_id,
      customer_id: review.customer_id,
      vendor_id:   review.vendor_id,
      stars:       review.stars,
      review:      review.review,
    },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
