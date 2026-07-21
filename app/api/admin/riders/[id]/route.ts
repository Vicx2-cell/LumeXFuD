import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/session'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { rateLimitGeneric } from '@/lib/rate-limit'
import { nextRiderReviewState, riderReadyForApproval } from '@/lib/onboarding'
import { renderApplicationEmail } from '@/lib/email/templates'
import { deliverWorkflowEmail } from '@/lib/email/workflow-email'

const updateInput = z.object({
  action: z.enum(['review', 'verification_failed', 'approve', 'reject', 'suspend', 'unsuspend']),
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

  const rl = await rateLimitGeneric(`admin-rider-update:${session.userId ?? session.phone}`, 20, 60)
  if (!rl.success) return NextResponse.json({ error: 'Too many requests. Slow down.' }, { status: 429 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const parsed = updateInput.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const db = createSupabaseAdmin()
  const { data: rider } = await db
    .from('riders')
    .select('id, is_active, approval_state, nin, id_photo_url, live_selfie_url, guarantor_name, guarantor_phone, vehicle_type')
    .eq('id', id)
    .single()
  if (!rider) return NextResponse.json({ error: 'Rider not found' }, { status: 404 })

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updated_at: now, approval_state: nextRiderReviewState(rider.approval_state, parsed.data.action) }

  if (parsed.data.action === 'review') {
    updates.is_active = false
  } else if (parsed.data.action === 'verification_failed') {
    updates.is_active = false
    updates.approval_state = 'verification_failed'
  } else if (parsed.data.action === 'approve') {
    if (!riderReadyForApproval(rider)) {
      return NextResponse.json(
        { error: 'Complete rider identity, selfie, guarantor, and vehicle checks before approval.' },
        { status: 409 },
      )
    }
    updates.is_active = true
    updates.approval_state = 'approved'
    updates.id_verified = true
    updates.vehicle_inspected = true
    updates.approved_at = now
    updates.approved_by = session.phone
  } else if (parsed.data.action === 'reject') {
    updates.is_active = false
    updates.status = 'OFFLINE'
    updates.approval_state = 'rejected'
    updates.rejection_reason = parsed.data.reason ?? null
  } else if (parsed.data.action === 'suspend') {
    updates.is_active = false
    updates.status = 'OFFLINE'
    updates.approval_state = 'suspended'
  } else {
    if (rider.approval_state !== 'approved') {
      return NextResponse.json({ error: 'Approve this rider before unsuspending.' }, { status: 409 })
    }
    updates.is_active = true
    updates.status = 'ONLINE'
    updates.approval_state = 'approved'
  }

  await db.from('riders').update(updates).eq('id', id)

  if (['review', 'verification_failed', 'approve', 'reject'].includes(parsed.data.action)) {
    const applicationStatus = parsed.data.action === 'approve' ? 'approved' : parsed.data.action === 'reject' ? 'rejected' : parsed.data.action === 'verification_failed' ? 'verification_failed' : 'under_review'
    const { data: application } = await db.from('rider_applications').update({ status: applicationStatus, rejection_reason: parsed.data.action === 'reject' ? parsed.data.reason ?? null : undefined, updated_at: now }).eq('rider_id', id).select('id, email, full_name, reference_number').maybeSingle()
    if (application?.email && application.reference_number && ['approve', 'reject'].includes(parsed.data.action)) {
      const workflow = parsed.data.action === 'approve' ? 'application_approved' : 'application_rejected'
      const template = renderApplicationEmail({ workflow, name: application.full_name, kind: 'rider', reference: application.reference_number, actionUrl: `${process.env.APP_BASE_URL ?? 'https://lumexfud.com.ng'}/auth`, reason: parsed.data.reason })
      const notice = await deliverWorkflowEmail(db, { eventKey: `${workflow}:rider:${application.id}`, eventKind: parsed.data.action === 'approve' ? 'APPLICATION_APPROVED' : 'APPLICATION_REJECTED', workflow, recipient: application.email, initiatedBy: 'admin', ...template })
      if (notice.status === 'sent') await db.from('rider_applications').update({ applicant_notified_at: now }).eq('id', application.id)
      if (parsed.data.action === 'approve') {
        const welcome = renderApplicationEmail({ workflow: 'rider_welcome', name: application.full_name, kind: 'rider', reference: application.reference_number, actionUrl: `${process.env.APP_BASE_URL ?? 'https://lumexfud.com.ng'}/auth` })
        await deliverWorkflowEmail(db, { eventKey: `rider-welcome:${application.id}`, eventKind: 'RIDER_WELCOME', workflow: 'rider_welcome', recipient: application.email, initiatedBy: 'admin', ...welcome })
      }
    }
  }

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
