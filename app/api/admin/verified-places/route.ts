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
    .from('verified_places')
    .select('id, name, canonical_latitude, canonical_longitude, city, status, confidence_count, created_at, updated_at')
    .order('confidence_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  return NextResponse.json({ places: data ?? [] })
}
