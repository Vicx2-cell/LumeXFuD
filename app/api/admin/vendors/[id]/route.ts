import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'

const updateInput = z.object({
  action: z.enum(['approve', 'reject', 'suspend', 'unsuspend']),
  reason: z.string().max(500).optional(),
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

  const rl = await rateLimitGeneric(`admin-vendor-update:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = updateInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, is_active, approval_state')
    .eq('id', id)
    .single()
  if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updated_at: now }

  if (parsed.data.action === 'approve') {
    updates.is_active = true
    updates.approval_state = 'approved'
    updates.id_verified = true
    updates.site_inspected = true
    updates.approved_at = now
    updates.approved_by = session.phone
  } else if (parsed.data.action === 'reject') {
    updates.is_active = false
    updates.status = 'CLOSED'
    updates.approval_state = 'rejected'
  } else if (parsed.data.action === 'suspend') {
    updates.is_active = false
    updates.status = 'CLOSED'
  } else {
    if (vendor.approval_state !== 'approved') {
      return NextResponse.json({ error: 'Approve this vendor before unsuspending.' }, { status: 409 })
    }
    updates.is_active = true
    updates.status = 'OPEN'
  }

  await db.from('vendors').update(updates).eq('id', id)

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: `vendor_${parsed.data.action}`,
    target_table: 'vendors',
    target_id: id,
    old_value: { is_active: vendor.is_active },
    new_value: updates,
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}

// Soft-delete (remove) a vendor. We never hard-delete — orders, wallet rows and
// audit history must remain intact — so this sets deleted_at, which hides the
// vendor everywhere (listings, login, menus all filter `deleted_at IS NULL`).
const ACTIVE_ORDER_STATUSES = [
  'PENDING', 'VENDOR_ACCEPTED', 'PREPARING', 'READY',
  'RIDER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'DISPUTED',
]

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

  const rl = await rateLimitGeneric(`admin-vendor-delete:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  const db = createSupabaseAdmin()
  const { data: vendor } = await db
    .from('vendors')
    .select('id, shop_name, is_active, deleted_at')
    .eq('id', id)
    .single()
  if (!vendor || vendor.deleted_at) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }

  // Don't strand customers mid-order.
  const { count } = await db
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('vendor_id', id)
    .in('status', ACTIVE_ORDER_STATUSES)
  if (count && count > 0) {
    return NextResponse.json(
      { error: `Can't remove — this vendor has ${count} order(s) in progress. Resolve them first.` },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  await db.from('vendors').update({
    deleted_at: now,
    is_active: false,
    status: 'CLOSED',
    updated_at: now,
  }).eq('id', id)

  await audit({
    actor_id: session.phone,
    actor_role: session.role,
    action: 'vendor_remove',
    target_table: 'vendors',
    target_id: id,
    old_value: { is_active: vendor.is_active, deleted_at: null },
    new_value: { deleted_at: now },
    ip_address: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ success: true })
}
