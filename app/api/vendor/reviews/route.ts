import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

// GET /api/vendor/reviews — the logged-in vendor's own reviews + their current
// average. Customer identity is NOT included (vendors see reviews as anonymous,
// same as the public page). Vendor only.
export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'vendor') return NextResponse.json({ error: 'Vendor only' }, { status: 403 })

  const db = createSupabaseAdmin()

  const { data: vendor } = await db
    .from('vendors')
    .select('avg_rating, total_ratings')
    .eq('id', session.userId!)
    .single()

  const { data, error } = await db
    .from('ratings')
    .select('id, stars, review, created_at')
    .eq('vendor_id', session.userId!)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[vendor/reviews] query failed:', error.message)
    return NextResponse.json({ reviews: [], avg_rating: 0, total_ratings: 0 })
  }

  return NextResponse.json({
    reviews: data ?? [],
    avg_rating: vendor?.avg_rating ?? 0,
    total_ratings: vendor?.total_ratings ?? 0,
  })
}
