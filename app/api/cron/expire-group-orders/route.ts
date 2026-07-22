import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { verifyCronSecret, withCronHealth } from '@/lib/cron-health'

async function handler(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = createSupabaseAdmin()
  const now = new Date().toISOString()
  const { data: expired, error } = await db.from('group_orders')
    .update({ status: 'EXPIRED' })
    .in('status', ['DRAFT', 'OPEN', 'LOCKED', 'VALIDATING', 'FAILED'])
    .lt('expires_at', now)
    .select('id')
  if (error) return NextResponse.json({ error: 'Could not expire group orders.' }, { status: 500 })
  const ids = (expired ?? []).map((row) => (row as { id: string }).id)
  if (ids.length > 0) {
    await db.from('group_order_participants').update({ status: 'EXPIRED', updated_at: now }).in('group_order_id', ids).in('status', ['JOINED', 'EDITING', 'READY'])
    await db.from('group_order_events').insert(ids.map((groupId) => ({ group_order_id: groupId, event_type: 'group_expired' })))
  }
  return NextResponse.json({ expired: ids.length })
}

export async function GET(req: NextRequest) {
  return withCronHealth('expire-group-orders', () => handler(req))
}
