import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const db = createSupabaseAdmin()

    const { data: vendor, error } = await db
      .from('vendors')
      .select(`
        id, shop_name, owner_name, logo_url, shop_photo_url,
        prep_time_minutes, status, paused_until, category, description,
        avg_rating, total_ratings, is_active, opening_time, closing_time
      `)
      .eq('id', id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .single()

    if (error || !vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    const { data: menu } = await db
      .from('menu_items')
      .select('id, name, description, price_kobo, image_url, category, is_available, prep_time_minutes, daily_limit, sold_today, display_order')
      .eq('vendor_id', id)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })

    return NextResponse.json({ vendor, menu: menu ?? [] })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
