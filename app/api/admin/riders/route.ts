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
  const { data: riders } = await db
    .from('riders')
    .select(`
      id, full_name, phone, status, is_active,
      avg_rating, total_ratings, total_deliveries, created_at
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return NextResponse.json({ riders: riders ?? [] })
}
