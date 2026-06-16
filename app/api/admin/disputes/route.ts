import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET() {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = createSupabaseAdmin()
  const base = `
      id, order_number, total_amount, delivery_address,
      created_at, delivered_at, customer_id, vendor_id,
      vendors ( shop_name ),
      customers ( name, phone )`

  // Prefer the embed WITH the concierge fields; if migration 039 hasn't been
  // applied yet (columns missing → query errors), fall back to the basic embed
  // so the admin disputes page never goes blank.
  const withTriage = await db
    .from('orders')
    .select(`${base}, disputes ( reason, description, customer_photo_url, ai_triage )`)
    .eq('status', 'DISPUTED')
    .order('delivered_at', { ascending: true })

  if (!withTriage.error) return NextResponse.json({ disputes: withTriage.data ?? [] })

  const fallback = await db
    .from('orders')
    .select(`${base}, disputes ( reason, description )`)
    .eq('status', 'DISPUTED')
    .order('delivered_at', { ascending: true })

  return NextResponse.json({ disputes: fallback.data ?? [] })
}
