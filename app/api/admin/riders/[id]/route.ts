import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'

const updateInput = z.object({
  action: z.enum(['approve', 'suspend', 'unsuspend']),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`admin-rider-update:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = updateInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: rider } = await db
    .from('riders')
    .select('id, is_active')
    .eq('id', id)
    .single()
  if (!rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {}

  if (parsed.data.action === 'approve') {
    updates.is_active = true
    updates.approved_at = now
    updates.approved_by = session.phone
  } else if (parsed.data.action === 'suspend') {
    updates.is_active = false
    updates.status = 'OFFLINE'
  } else {
    updates.is_active = true
  }

  await db.from('riders').update(updates).eq('id', id)

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: `rider_${parsed.data.action}`,
    target_table: 'riders',
    target_id: id,
    old_value: { is_active: rider.is_active },
    new_value: updates,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}

// Soft-delete (remove) a rider — never hard-delete (keep delivery history,
// wallet rows, audit trail). Blocked while the rider is mid-delivery.
const ACTIVE_DELIVERY_STATUSES = ['RIDER_ASSIGNED', 'PICKED_UP']

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getCurrentUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'super_admin'].includes(session.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await rateLimitGeneric(`admin-rider-delete:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: rider } = await db
    .from('riders')
    .select('id, is_active, deleted_at')
    .eq('id', id)
    .single()
  if (!rider || rider.deleted_at) {
    return NextResponse.json({ error: 'Rider not found' }, { status: 404 })
  }

  const { count } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('rider_id', id)
    .in('status', ACTIVE_DELIVERY_STATUSES)
  if (count && count > 0) {
    return NextResponse.json(
      { error: `Can't remove — this rider has ${count} active delivery(ies). Wait until they finish.` },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  await db.from('riders').update({
    deleted_at: now,
    is_active: false,
    status: 'OFFLINE',
  }).eq('id', id)

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'rider_remove',
    target_table: 'riders',
    target_id: id,
    old_value: { is_active: rider.is_active, deleted_at: null },
    new_value: { deleted_at: now },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
