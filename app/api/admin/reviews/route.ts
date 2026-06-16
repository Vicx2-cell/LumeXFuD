import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// GET /api/admin/reviews — recent vendor reviews WITH the account behind each
// (name + phone), so an admin can read a review publicly shown as "Anonymous"
// and still trace/flag the customer who wrote it. Admin + super_admin only.
//
// Optional ?lowOnly=1 returns just 1–2 star reviews (the ones worth screening).
export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const lowOnly = req.nextUrl.searchParams.get('lowOnly') === '1'

  const db = createSupabaseAdmin()
  let q = db
    .from('ratings')
    .select(`
      id, stars, review, reviewer_name, created_at, customer_id,
      rider_stars, rider_review,
      vendors ( shop_name ),
      riders ( full_name ),
      customers ( name, phone ),
      orders ( order_number )
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (lowOnly) q = q.or('stars.lte.2,rider_stars.lte.2')

  const { data, error } = await q
  if (error) {
    // Degrades to empty if migration 043 hasn't run on this environment yet.
    console.error('[admin/reviews] query failed:', error.message)
    return NextResponse.json({ reviews: [] })
  }

  return NextResponse.json({ reviews: data ?? [] })
}
