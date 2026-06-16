import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// GET /api/rider/reviews — the logged-in rider's own ratings + average. Only
// rows where the customer actually rated the rider. Customer identity is NOT
// included (anonymous to the rider). Rider only.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'rider') return NextResponse.json({ error: 'Rider only' }, { status: 403 })

  const db = createSupabaseAdmin()

  const { data: rider } = await db
    .from('riders')
    .select('avg_rating, total_ratings')
    .eq('id', session.userId!)
    .single()

  const { data, error } = await db
    .from('ratings')
    .select('id, rider_stars, rider_review, created_at')
    .eq('rider_id', session.userId!)
    .not('rider_stars', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[rider/reviews] query failed:', error.message)
    return NextResponse.json({ reviews: [], avg_rating: 0, total_ratings: 0 })
  }

  return NextResponse.json({
    reviews: data ?? [],
    avg_rating: rider?.avg_rating ?? 0,
    total_ratings: rider?.total_ratings ?? 0,
  })
}
