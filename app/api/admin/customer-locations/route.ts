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
  const { data } = await db
    .from('customer_locations')
    .select(`
      id, customer_id, label, latitude, longitude, delivery_note, city_id, zone_id, is_active, created_at, updated_at,
      customers ( name, phone )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  return NextResponse.json({ locations: data ?? [] })
}
