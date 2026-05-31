import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { resolveDisputeInput } from '@/lib/validators'
import { audit } from '@/lib/audit'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = resolveDisputeInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: order } = await db
    .from('orders')
    .select('id, status, total_amount')
    .eq('id', id)
    .single()

  if (!order || order.status !== 'DISPUTED') {
    return NextResponse.json({ error: 'Order not found or not in DISPUTED state' }, { status: 404 })
  }

  const newStatus = parsed.data.resolution === 'REFUND' ? 'REFUNDED' : 'COMPLETED'
  const now = new Date().toISOString()

  await db.from('orders').update({ status: newStatus, updated_at: now }).eq('id', id)

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: `dispute_resolved_${parsed.data.resolution.toLowerCase()}`,
    target_table: 'orders',
    target_id: id,
    old_value: { status: 'DISPUTED' },
    new_value: { status: newStatus, notes: parsed.data.notes },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true, new_status: newStatus })
}
