import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { notifyGroupCancelled } from '@/lib/group-order'
import { rateLimitGeneric } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/group-order/[code]/cancel — the host calls off the group. Status →
// CANCELLED so the link stops working (adds/checkout refused, view returns 410),
// and every other participant is notified. Host only.
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getCurrentUser()
  if (!session || session.role !== 'customer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rl = await rateLimitGeneric(`group-cancel:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  const { code } = await params
  const db = createSupabaseAdmin()
  const { data: gRow } = await db.from('group_orders').select('id, host_customer_id, status').eq('code', code.toUpperCase()).maybeSingle()
  const g = gRow as { id: string; host_customer_id: string; status: string } | null
  if (!g) return NextResponse.json({ error: 'Group order not found' }, { status: 404 })

  const { data: meRow } = await db.from('customers').select('id').eq('phone', session.phone).maybeSingle()
  if ((meRow as { id: string } | null)?.id !== g.host_customer_id) {
    return NextResponse.json({ error: 'Only the host can cancel this group.' }, { status: 403 })
  }
  if (g.status !== 'OPEN') return NextResponse.json({ error: 'This group is already closed.' }, { status: 409 })

  const { error } = await db.from('group_orders').update({ status: 'CANCELLED' }).eq('id', g.id).eq('status', 'OPEN')
  if (error) return NextResponse.json({ error: 'Could not cancel.' }, { status: 500 })

  await notifyGroupCancelled(db, g.id)
  return NextResponse.json({ success: true })
}
