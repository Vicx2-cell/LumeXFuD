import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { affordableItems, getAffordableThresholdsKobo } from '@/lib/commerce-discovery'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ceiling = Number(req.nextUrl.searchParams.get('max_kobo'))
  const db = createSupabaseAdmin()
  const thresholds = await getAffordableThresholdsKobo(db)
  const allowed = thresholds.includes(ceiling) ? ceiling : thresholds[0]
  const { data } = await db.from('menu_items')
    .select('id, vendor_id, name, category, price_kobo, image_url, vendors!inner(id, slug, shop_name, is_active, approval_state, status)')
    .eq('is_available', true).is('deleted_at', null)
    .eq('vendors.is_active', true).eq('vendors.approval_state', 'approved').in('vendors.status', ['OPEN', 'BUSY'])
    .lte('price_kobo', allowed).limit(60)
  const items = affordableItems((data ?? []).map((row) => ({ id: String(row.id), vendorId: String(row.vendor_id), category: row.category as string | null, priceKobo: Number(row.price_kobo), isAvailable: true })), allowed)
  return NextResponse.json({ ceiling_kobo: allowed, items, thresholds_kobo: thresholds }, { headers: { 'Cache-Control': 'no-store' } })
}
