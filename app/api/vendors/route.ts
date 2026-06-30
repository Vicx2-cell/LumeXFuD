import { NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notCurrentlySuspendedOr } from '@/lib/vendor-visibility'

export async function GET() {
  try {
    const db = createSupabaseAdmin()

    const { data: vendors, error } = await db
      .from('vendors')
      .select(`
        id, shop_name, owner_name, logo_url, shop_photo_url,
        prep_time_minutes, status, paused_until, category, description,
        avg_rating, total_ratings, is_active, subscription_paid_until,
        vendor_scores ( composite_score, visibility_tier )
      `)
      .eq('is_active', true)
      .is('deleted_at', null)
      .or(notCurrentlySuspendedOr()) // hide suspended vendors from the public list
      .in('status', ['OPEN', 'BUSY'])
      .order('composite_score', { referencedTable: 'vendor_scores', ascending: false })

    if (error) {
      return NextResponse.json({ error: 'Failed to load vendors' }, { status: 500 })
    }

    const { data: trending } = await db
      .from('trending_data')
      .select('orders_last_hour, top_item_name, top_item_count, top_vendor_name, new_vendor_name')
      .eq('id', 1)
      .single()

    return NextResponse.json({ vendors: vendors ?? [], trending: trending ?? null })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
