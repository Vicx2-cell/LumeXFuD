import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const db = createSupabaseAdmin()
  const { data: logs } = await db
    .from('audit_logs')
    .select('id, actor_id, actor_role, action, target_table, target_id, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  return NextResponse.json({ logs: logs ?? [], page })
}
